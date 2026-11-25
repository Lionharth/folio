import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  getRandomBytes,
  getRandomBytesAsync,
} from 'expo-crypto';

import type { AesGcm, RandomSource } from './chunkedFile';

async function importKey(key: Uint8Array): Promise<AESEncryptionKey> {
  if (key.length !== 32) throw new Error('AES-256-GCM requires a 32-byte key');
  return AESEncryptionKey.import(key);
}

/**
 * AES-256-GCM backed by the platform's native crypto implementation
 * (Android: javax.crypto / Conscrypt, iOS: CryptoKit). Keys never leave native
 * memory except when explicitly exported by the caller.
 */
export const expoAesGcm: AesGcm = {
  async encrypt(key, nonce, plaintext, aad) {
    const cryptoKey = await importKey(key);
    const sealed = await aesEncryptAsync(plaintext, cryptoKey, {
      nonce: { bytes: nonce },
      tagLength: 16,
      additionalData: aad,
    });
    const ciphertext = await sealed.ciphertext({ includeTag: true, encoding: 'bytes' });
    return ciphertext as Uint8Array;
  },

  async decrypt(key, nonce, sealed, aad) {
    const cryptoKey = await importKey(key);
    const data = AESSealedData.fromParts(nonce, sealed, 16);
    const plaintext = await aesDecryptAsync(data, cryptoKey, {
      output: 'bytes',
      additionalData: aad,
    });
    return plaintext as Uint8Array;
  },
};

export const expoRandom: RandomSource = {
  randomBytes(length) {
    return getRandomBytes(length);
  },
};

export async function randomBytesAsync(length: number): Promise<Uint8Array> {
  return getRandomBytesAsync(length);
}

export async function generateMediaKey(): Promise<Uint8Array> {
  const key = await getRandomBytesAsync(32);
  if (key.length !== 32) throw new Error('Failed to generate a 32-byte media key');
  return key;
}
