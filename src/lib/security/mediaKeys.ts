import * as SecureStore from 'expo-secure-store';

import { base64ToBytes, bytesToBase64 } from '../crypto/bytes';

const PREFIX = 'folio.mediakey.v1.';

/**
 * Media keys are secret key material. They are stored in the platform
 * keystore-backed store, never in SQLite, and are never logged.
 */
export async function saveMediaKey(clipId: string, key: Uint8Array): Promise<void> {
  if (key.length !== 32) throw new Error('Media key must be 32 bytes');
  await SecureStore.setItemAsync(PREFIX + clipId, bytesToBase64(key), { requireAuthentication: false });
}

export async function loadMediaKey(clipId: string): Promise<Uint8Array | null> {
  const encoded = await SecureStore.getItemAsync(PREFIX + clipId);
  if (!encoded) return null;
  const bytes = base64ToBytes(encoded);
  return bytes.length === 32 ? bytes : null;
}

export async function deleteMediaKey(clipId: string): Promise<void> {
  await SecureStore.deleteItemAsync(PREFIX + clipId);
}

export async function hasMediaKey(clipId: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(PREFIX + clipId)) !== null;
}
