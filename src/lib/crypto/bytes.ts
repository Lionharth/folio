const HEX_ALPHABET = '0123456789abcdef';

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX_ALPHABET[(b >> 4) & 0x0f] + HEX_ALPHABET[b & 0x0f];
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex: odd length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('hex: invalid character');
    out[i] = byte;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[\r\n\s]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean.endsWith('==') ? clean.slice(0, -2) : clean.endsWith('=') ? clean.slice(0, -1) : clean;
  if (padded.length % 4 === 1) throw new Error('base64: invalid length');
  const out = new Uint8Array(Math.floor((padded.length * 3) / 4));
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < padded.length; i++) {
    const value = B64.indexOf(padded[i]);
    if (value === -1) throw new Error('base64: invalid character');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, outIndex);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function utf8ToBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function writeU32BE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

export function readU32BE(source: Uint8Array, offset: number): number {
  return (
    ((source[offset] << 24) | (source[offset + 1] << 16) | (source[offset + 2] << 8) | source[offset + 3]) >>> 0
  );
}

export function writeU64BE(target: Uint8Array, offset: number, value: number): void {
  writeU32BE(target, offset, Math.floor(value / 0x100000000));
  writeU32BE(target, offset + 4, value % 0x100000000);
}

export function readU64BE(source: Uint8Array, offset: number): number {
  return readU32BE(source, offset) * 0x100000000 + readU32BE(source, offset + 4);
}
