import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import {
  decryptFc1Stream,
  encryptStreamToFc1,
  fc1CiphertextLength,
  parseFc1Header,
  FC1_HEADER_BYTES,
  FC1_TAG_BYTES,
  FC1_DEFAULT_CHUNK,
  type AesGcm,
  type ChunkReader,
  type ChunkWriter,
  type RandomSource,
} from '../src/lib/crypto/chunkedFile';
import { concatBytes } from '../src/lib/crypto/bytes';

const nodeAes: AesGcm = {
  async encrypt(key, nonce, plaintext, aad) {
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return new Uint8Array(Buffer.concat([ciphertext, cipher.getAuthTag()]));
  },
  async decrypt(key, nonce, sealed, aad) {
    const tag = sealed.subarray(sealed.length - 16);
    const ciphertext = sealed.subarray(0, sealed.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  },
};

const nodeRandom: RandomSource = { randomBytes: (length) => new Uint8Array(randomBytes(length)) };

function memoryReader(data: Uint8Array): ChunkReader {
  let offset = 0;
  return {
    async read(length) {
      const slice = data.subarray(offset, Math.min(offset + length, data.length));
      offset += slice.length;
      return slice;
    },
  };
}

/** Reader that returns at most `maxRead` bytes per call, exercising readExactly. */
function raggedReader(data: Uint8Array, maxRead: number): ChunkReader {
  let offset = 0;
  return {
    async read(length) {
      const take = Math.min(length, maxRead, data.length - offset);
      const slice = data.subarray(offset, offset + take);
      offset += slice.length;
      return slice;
    },
  };
}

function memoryWriter(): ChunkWriter & { bytes: Uint8Array } {
  const parts: Uint8Array[] = [];
  return {
    bytes: new Uint8Array(),
    async write(chunk) {
      parts.push(chunk.slice());
      this.bytes = concatBytes(...parts);
    },
  };
}

async function seal(plaintext: Uint8Array, chunkSize: number = 16 * 1024) {
  const writer = memoryWriter();
  const result = await encryptStreamToFc1({
    reader: memoryReader(plaintext),
    writer,
    key: new Uint8Array(32).fill(7),
    aes: nodeAes,
    random: nodeRandom,
    chunkSize,
    plaintextSize: plaintext.length,
  });
  return { container: writer.bytes, result };
}

async function open(container: Uint8Array, key = new Uint8Array(32).fill(7)) {
  const writer = memoryWriter();
  const header = await decryptFc1Stream({
    reader: memoryReader(container),
    writer,
    key,
    aes: nodeAes,
  });
  return { plaintext: writer.bytes, header };
}

test('round-trips empty, exact-multiple and ragged payloads', async () => {
  const cases = [new Uint8Array(0), randomBytes(16 * 1024), randomBytes(16 * 1024 * 3), randomBytes(50_000)];
  for (const plaintext of cases) {
    const { container, result } = await seal(new Uint8Array(plaintext));
    assert.equal(container.length, fc1CiphertextLength(plaintext.length, 16 * 1024));
    assert.equal(result.encryptedSize, container.length);
    const opened = await open(container);
    assert.deepEqual(new Uint8Array(opened.plaintext), new Uint8Array(plaintext));
    assert.equal(opened.header.plaintextSize, plaintext.length);
  }
});

test('handles readers that return partial data', async () => {
  const plaintext = new Uint8Array(randomBytes(40_000));
  const { container } = await seal(plaintext);
  const writer = memoryWriter();
  await decryptFc1Stream({ reader: raggedReader(container, 777), writer, key: new Uint8Array(32).fill(7), aes: nodeAes });
  assert.deepEqual(new Uint8Array(writer.bytes), plaintext);
});

test('reports progress monotonically up to the plaintext size', async () => {
  const plaintext = new Uint8Array(randomBytes(45_000));
  const progress: number[] = [];
  const writer = memoryWriter();
  await encryptStreamToFc1({
    reader: memoryReader(plaintext),
    writer,
    key: new Uint8Array(32).fill(7),
    aes: nodeAes,
    random: nodeRandom,
    chunkSize: 16 * 1024,
    plaintextSize: plaintext.length,
    onProgress: (n) => progress.push(n),
  });
  assert.deepEqual(progress, [16 * 1024, 32 * 1024, 45_000]);
});

test('uses a unique nonce for every chunk', async () => {
  const seen = new Set<string>();
  const capturing: AesGcm = {
    async encrypt(key, nonce, plaintext, aad) {
      const id = Buffer.from(nonce).toString('hex');
      assert.ok(!seen.has(id), 'nonce reused');
      seen.add(id);
      return nodeAes.encrypt(key, nonce, plaintext, aad);
    },
    decrypt: nodeAes.decrypt,
  };
  const plaintext = new Uint8Array(randomBytes(16 * 1024 * 5));
  await encryptStreamToFc1({
    reader: memoryReader(plaintext),
    writer: memoryWriter(),
    key: new Uint8Array(32).fill(1),
    aes: capturing,
    random: nodeRandom,
    chunkSize: 16 * 1024,
    plaintextSize: plaintext.length,
  });
  assert.equal(seen.size, 5);
});

test('rejects the wrong key', async () => {
  const { container } = await seal(new Uint8Array(randomBytes(20_000)));
  await assert.rejects(() => open(container, new Uint8Array(32).fill(8)), /authentication failed/);
});

test('detects a flipped ciphertext bit', async () => {
  const { container } = await seal(new Uint8Array(randomBytes(20_000)));
  const tampered = container.slice();
  tampered[FC1_HEADER_BYTES + 4 + 10] ^= 1;
  await assert.rejects(() => open(tampered), /authentication failed/);
});

test('detects a flipped header bit', async () => {
  const { container } = await seal(new Uint8Array(randomBytes(20_000)));
  const tampered = container.slice();
  tampered[16] ^= 1; // chunkCount
  await assert.rejects(() => open(tampered));
});

test('detects reordered chunks', async () => {
  const { container } = await seal(new Uint8Array(randomBytes(16 * 1024 * 3)), 16 * 1024);
  // Two full chunk records: 4 + 16384 + 16 bytes each.
  const record = 4 + 16 * 1024 + 16;
  const start = FC1_HEADER_BYTES;
  const a = container.subarray(start, start + record);
  const b = container.subarray(start + record, start + record * 2);
  const swapped = concatBytes(container.subarray(0, start), b, a, container.subarray(start + record * 2));
  await assert.rejects(() => open(swapped), /authentication failed/);
});

test('detects a dropped final chunk', async () => {
  const { container } = await seal(new Uint8Array(randomBytes(16 * 1024 * 3)), 16 * 1024);
  const record = 4 + 16 * 1024 + 16;
  const truncated = container.subarray(0, FC1_HEADER_BYTES + record * 2);
  await assert.rejects(() => open(truncated));
});

test('detects trailing data', async () => {
  const { container } = await seal(new Uint8Array(randomBytes(5_000)));
  const extended = concatBytes(container, new Uint8Array([1, 2, 3]));
  await assert.rejects(() => open(extended), /trailing data/);
});

test('detects a truncated chunk body', async () => {
  const { container } = await seal(new Uint8Array(randomBytes(5_000)));
  await assert.rejects(() => open(container.subarray(0, container.length - 1)), /unexpected end/);
});

test('rejects a container with an invalid magic or version', async () => {
  const { container } = await seal(new Uint8Array(randomBytes(1_000)));
  const badMagic = container.slice();
  badMagic[0] = 0x58;
  assert.throws(() => parseFc1Header(badMagic.subarray(0, FC1_HEADER_BYTES)), /bad magic/);
  const badVersion = container.slice();
  badVersion[8] = 9;
  assert.throws(() => parseFc1Header(badVersion.subarray(0, FC1_HEADER_BYTES)), /unsupported version/);
});

test('encrypts with the default 4 MiB chunk size', async () => {
  const plaintext = new Uint8Array(randomBytes(FC1_DEFAULT_CHUNK + 100));
  const writer = memoryWriter();
  const result = await encryptStreamToFc1({
    reader: memoryReader(plaintext),
    writer,
    key: new Uint8Array(32).fill(3),
    aes: nodeAes,
    random: nodeRandom,
    plaintextSize: plaintext.length,
  });
  assert.equal(result.chunkCount, 2);
  const opened = await open(writer.bytes, new Uint8Array(32).fill(3));
  assert.deepEqual(new Uint8Array(opened.plaintext), plaintext);
  assert.equal(opened.plaintext.length, plaintext.length);
});

test('ciphertext length helper accounts for framing overhead', () => {
  for (const size of [0, 1, 16 * 1024 - 1, 16 * 1024, 16 * 1024 + 1, 100_000]) {
    const chunks = Math.ceil(size / (16 * 1024));
    assert.equal(fc1CiphertextLength(size, 16 * 1024), FC1_HEADER_BYTES + size + chunks * (4 + FC1_TAG_BYTES));
  }
});
