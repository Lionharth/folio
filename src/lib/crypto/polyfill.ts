/**
 * Must be imported before any @noble / nostr-tools code executes.
 * React Native (Hermes) has no WebCrypto global; expo-crypto provides a
 * hardware-backed CSPRNG through getRandomValues.
 */
import { getRandomValues } from 'expo-crypto';

type CryptoLike = { getRandomValues?: <T extends ArrayBufferView>(array: T) => T; randomUUID?: () => string };

const globalCrypto = globalThis as unknown as { crypto?: CryptoLike };

if (!globalCrypto.crypto) {
  globalCrypto.crypto = {};
}

if (typeof globalCrypto.crypto.getRandomValues !== 'function') {
  globalCrypto.crypto.getRandomValues = getRandomValues as CryptoLike['getRandomValues'];
}

export {};
