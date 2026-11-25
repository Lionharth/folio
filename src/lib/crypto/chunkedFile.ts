/**
 * FOLIO-FC1 — chunked authenticated media container.
 *
 * A video file is split into fixed-size plaintext chunks. Every chunk is sealed
 * independently with AES-256-GCM using a nonce derived from a per-file random
 * 8-byte nonce base and the chunk counter (`nonceBase || u32be counter`).
 *
 * The 28-byte header is authenticated as additional data for every chunk, so a
 * reader cannot be tricked about the chunk size or total chunk count. Each
 * chunk's AAD also includes its index, whether it is the final chunk and its
 * plaintext length. Consequences:
 *
 *  - reordering chunks fails authentication,
 *  - dropping or duplicating a chunk fails authentication (index mismatch),
 *  - truncating the final chunk fails authentication,
 *  - appending chunks after the last one fails (trailing bytes are rejected),
 *  - truncating the file so a non-final chunk becomes final fails (final flag),
 *  - swapping content between two files encrypted under the same key fails
 *    (header is authenticated).
 *
 * The complete encrypted file is hashed with SHA-256 and the hash is pinned in
 * the vlog manifest and in every key-delivery message. See SECURITY.md.
 */

import { concatBytes, readU32BE, writeU32BE, writeU64BE } from './bytes';

export const FC1_MAGIC = 'FOLIOFC1';
export const FC1_VERSION = 1;
export const FC1_HEADER_BYTES = 28;
export const FC1_TAG_BYTES = 16;
export const FC1_NONCE_BYTES = 12;
export const FC1_NONCE_BASE_BYTES = 8;
export const FC1_MIN_CHUNK = 16 * 1024;
export const FC1_MAX_CHUNK = 16 * 1024 * 1024;
export const FC1_DEFAULT_CHUNK = 4 * 1024 * 1024;
export const FC1_MAX_CHUNKS = 0xffffffff;

export interface AesGcm {
  encrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  decrypt(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
}

export interface RandomSource {
  randomBytes(length: number): Uint8Array;
}

export interface ChunkReader {
  /** Reads up to `length` bytes; returns an empty array at end of stream. */
  read(length: number): Promise<Uint8Array>;
}

export interface ChunkWriter {
  write(bytes: Uint8Array): Promise<void>;
}

export interface Fc1Header {
  chunkSize: number;
  chunkCount: number;
  nonceBase: Uint8Array;
}

export interface DecodedFc1Header extends Fc1Header {
  plaintextSize: number;
}

export interface EncryptStreamOptions {
  reader: ChunkReader;
  writer: ChunkWriter;
  key: Uint8Array;
  aes: AesGcm;
  random: RandomSource;
  chunkSize?: number;
  /** Total plaintext size in bytes, when known; enables an exact header. */
  plaintextSize?: number;
  onProgress?: (processedBytes: number) => void;
}

export interface EncryptStreamResult extends Fc1Header {
  plaintextSize: number;
  encryptedSize: number;
}

export interface DecryptStreamOptions {
  reader: ChunkReader;
  writer: ChunkWriter;
  key: Uint8Array;
  aes: AesGcm;
  onProgress?: (processedBytes: number) => void;
  /** Optional hard cap to avoid reading a corrupted chunkCount. */
  maxPlaintextBytes?: number;
}

function buildHeader(chunkSize: number, chunkCount: number, nonceBase: Uint8Array): Uint8Array {
  const header = new Uint8Array(FC1_HEADER_BYTES);
  for (let i = 0; i < FC1_MAGIC.length; i++) header[i] = FC1_MAGIC.charCodeAt(i);
  header[8] = FC1_VERSION;
  header[9] = 0; // flags
  header[10] = 0; // reserved
  header[11] = 0;
  writeU32BE(header, 12, chunkSize);
  writeU32BE(header, 16, chunkCount);
  header.set(nonceBase, 20);
  return header;
}

export function parseFc1Header(header: Uint8Array): Fc1Header {
  if (header.length !== FC1_HEADER_BYTES) {
    throw new Error('FC1: header truncated');
  }
  for (let i = 0; i < FC1_MAGIC.length; i++) {
    if (header[i] !== FC1_MAGIC.charCodeAt(i)) throw new Error('FC1: bad magic');
  }
  if (header[8] !== FC1_VERSION) throw new Error(`FC1: unsupported version ${header[8]}`);
  if (header[9] !== 0 || header[10] !== 0 || header[11] !== 0) throw new Error('FC1: unsupported flags');

  const chunkSize = readU32BE(header, 12);
  const chunkCount = readU32BE(header, 16);
  if (!Number.isInteger(chunkSize) || chunkSize < FC1_MIN_CHUNK || chunkSize > FC1_MAX_CHUNK) {
    throw new Error('FC1: invalid chunk size');
  }
  return {
    chunkSize,
    chunkCount,
    nonceBase: header.slice(20, 28),
  };
}

function chunkAad(header: Uint8Array, index: number, isFinal: boolean, plaintextLength: number): Uint8Array {
  const aad = new Uint8Array(FC1_HEADER_BYTES + 8 + 1 + 4);
  aad.set(header, 0);
  writeU64BE(aad, FC1_HEADER_BYTES, index);
  aad[FC1_HEADER_BYTES + 8] = isFinal ? 1 : 0;
  writeU32BE(aad, FC1_HEADER_BYTES + 9, plaintextLength);
  return aad;
}

function chunkNonce(nonceBase: Uint8Array, index: number): Uint8Array {
  const nonce = new Uint8Array(FC1_NONCE_BYTES);
  nonce.set(nonceBase, 0);
  writeU32BE(nonce, FC1_NONCE_BASE_BYTES, index);
  return nonce;
}

async function readExactly(reader: ChunkReader, length: number): Promise<Uint8Array> {
  const first = await reader.read(length);
  if (first.length === length) return first;
  const parts = [first];
  let got = first.length;
  while (got < length) {
    const next = await reader.read(length - got);
    if (next.length === 0) break;
    parts.push(next);
    got += next.length;
  }
  return concatBytes(...parts);
}

/**
 * Writes the container. The writer must be positioned at the start of an empty
 * destination. Chunk count must be known before writing the header, so callers
 * pass `plaintextSize` for local files.
 */
export async function encryptStreamToFc1(options: EncryptStreamOptions): Promise<EncryptStreamResult> {
  const { reader, writer, key, aes, random, onProgress } = options;
  const chunkSize = options.chunkSize ?? FC1_DEFAULT_CHUNK;
  if (chunkSize < FC1_MIN_CHUNK || chunkSize > FC1_MAX_CHUNK) throw new Error('FC1: invalid chunk size');
  if (key.length !== 32) throw new Error('FC1: key must be 32 bytes');
  if (options.plaintextSize === undefined) {
    throw new Error('FC1: plaintextSize is required for streaming encryption');
  }

  const plaintextSize = options.plaintextSize;
  const chunkCount = Math.ceil(plaintextSize / chunkSize);
  if (chunkCount > FC1_MAX_CHUNKS) throw new Error('FC1: too many chunks');

  const nonceBase = random.randomBytes(FC1_NONCE_BASE_BYTES);
  if (nonceBase.length !== FC1_NONCE_BASE_BYTES) throw new Error('FC1: bad random source');

  const header = buildHeader(chunkSize, chunkCount, nonceBase);
  await writer.write(header);

  let processed = 0;
  let encryptedSize = header.length;
  for (let index = 0; index < chunkCount; index++) {
    const expected = Math.min(chunkSize, plaintextSize - index * chunkSize);
    const plaintext = await readExactly(reader, expected);
    if (plaintext.length !== expected) throw new Error('FC1: source ended early');

    const isFinal = index === chunkCount - 1;
    const aad = chunkAad(header, index, isFinal, plaintext.length);
    const sealed = await aes.encrypt(key, chunkNonce(nonceBase, index), plaintext, aad);
    if (sealed.length !== plaintext.length + FC1_TAG_BYTES) throw new Error('FC1: unexpected ciphertext length');

    const lengthPrefix = new Uint8Array(4);
    writeU32BE(lengthPrefix, 0, plaintext.length);
    await writer.write(lengthPrefix);
    await writer.write(sealed);

    processed += plaintext.length;
    encryptedSize += 4 + sealed.length;
    onProgress?.(processed);
  }

  return { chunkSize, chunkCount, nonceBase, plaintextSize, encryptedSize };
}

export async function decryptFc1Stream(options: DecryptStreamOptions): Promise<DecodedFc1Header> {
  const { reader, writer, key, aes, onProgress } = options;
  if (key.length !== 32) throw new Error('FC1: key must be 32 bytes');

  const header = await readExactly(reader, FC1_HEADER_BYTES);
  if (header.length !== FC1_HEADER_BYTES) throw new Error('FC1: header truncated');
  const parsed = parseFc1Header(header);

  if (parsed.chunkCount === 0) return { ...parsed, plaintextSize: 0 };

  const maxPlaintext = options.maxPlaintextBytes ?? parsed.chunkCount * parsed.chunkSize;
  let processed = 0;
  let lastLength = 0;

  for (let index = 0; index < parsed.chunkCount; index++) {
    const lengthBytes = await readExactly(reader, 4);
    if (lengthBytes.length !== 4) throw new Error('FC1: unexpected end of container');
    const plaintextLength = readU32BE(lengthBytes, 0);

    if (plaintextLength <= 0 || plaintextLength > parsed.chunkSize) {
      throw new Error('FC1: invalid chunk length');
    }
    const isFinal = index === parsed.chunkCount - 1;

    const sealed = await readExactly(reader, plaintextLength + FC1_TAG_BYTES);
    if (sealed.length !== plaintextLength + FC1_TAG_BYTES) throw new Error('FC1: unexpected end of container');

    const aad = chunkAad(header, index, isFinal, plaintextLength);
    let plaintext: Uint8Array;
    try {
      plaintext = await aes.decrypt(key, chunkNonce(parsed.nonceBase, index), sealed, aad);
    } catch {
      throw new Error('FC1: authentication failed');
    }
    if (plaintext.length !== plaintextLength) throw new Error('FC1: length mismatch after decryption');

    await writer.write(plaintext);
    processed += plaintext.length;
    if (processed > maxPlaintext) throw new Error('FC1: plaintext exceeds declared size');
    lastLength = plaintextLength;
    onProgress?.(processed);
  }

  const trailing = await reader.read(1);
  if (trailing.length !== 0) throw new Error('FC1: trailing data after container');

  const plaintextSize = (parsed.chunkCount - 1) * parsed.chunkSize + lastLength;
  return { ...parsed, plaintextSize };
}

export function fc1CiphertextLength(plaintextSize: number, chunkSize: number = FC1_DEFAULT_CHUNK): number {
  const chunkCount = Math.ceil(plaintextSize / chunkSize);
  return FC1_HEADER_BYTES + plaintextSize + chunkCount * (4 + FC1_TAG_BYTES);
}

export function readFc1HeaderFromBuffer(buffer: Uint8Array): Fc1Header {
  return parseFc1Header(buffer.subarray(0, FC1_HEADER_BYTES));
}

