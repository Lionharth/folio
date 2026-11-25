import * as SecureStore from 'expo-secure-store';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate, type VerifiedEvent } from 'nostr-tools/pure';
import { decode, nsecEncode, npubEncode } from 'nostr-tools/nip19';

import { bytesToHex, hexToBytes } from '../crypto/bytes';

const REGISTRY_KEY = 'folio.identity.registry.v1';
const SECRET_PREFIX = 'folio.identity.secret.v1.';

export interface StoredIdentity {
  id: string;
  label: string;
  pubkey: string;
  npub: string;
  createdAt: number;
}

interface Registry {
  version: 1;
  activeId: string | null;
  identities: StoredIdentity[];
}

export interface NostrSigner {
  getPublicKey(): Promise<string>;
  signEvent(template: EventTemplate): Promise<VerifiedEvent>;
}

const EMPTY_REGISTRY: Registry = { version: 1, activeId: null, identities: [] };

async function readRegistry(): Promise<Registry> {
  const raw = await SecureStore.getItemAsync(REGISTRY_KEY);
  if (!raw) return { ...EMPTY_REGISTRY, identities: [] };
  try {
    const parsed = JSON.parse(raw) as Registry;
    if (parsed.version !== 1 || !Array.isArray(parsed.identities)) return { ...EMPTY_REGISTRY, identities: [] };
    return parsed;
  } catch {
    return { ...EMPTY_REGISTRY, identities: [] };
  }
}

async function writeRegistry(registry: Registry): Promise<void> {
  await SecureStore.setItemAsync(REGISTRY_KEY, JSON.stringify(registry));
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function listIdentities(): Promise<StoredIdentity[]> {
  return (await readRegistry()).identities;
}

export async function getActiveIdentity(): Promise<StoredIdentity | null> {
  const registry = await readRegistry();
  if (!registry.activeId) return null;
  return registry.identities.find((identity) => identity.id === registry.activeId) ?? null;
}

export async function setActiveIdentity(id: string): Promise<void> {
  const registry = await readRegistry();
  if (!registry.identities.some((identity) => identity.id === id)) {
    throw new Error('Unknown identity');
  }
  registry.activeId = id;
  await writeRegistry(registry);
}

/** Creates a new identity. The secret key is generated in native CSPRNG and only leaves it into SecureStore. */
export async function createIdentity(label: string): Promise<StoredIdentity> {
  const secretKey = generateSecretKey();
  return persistSecretKey(secretKey, label);
}

/** Imports an existing nsec. Accepts bech32 (`nsec1...`) or 64-char hex. */
export async function importIdentity(secret: string, label: string): Promise<StoredIdentity> {
  const trimmed = secret.trim();
  let secretKey: Uint8Array;
  if (trimmed.startsWith('nsec1')) {
    const decoded = decode(trimmed);
    if (decoded.type !== 'nsec') throw new Error('Not an nsec key');
    secretKey = decoded.data as Uint8Array;
  } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    secretKey = hexToBytes(trimmed.toLowerCase());
  } else {
    throw new Error('Unsupported key format');
  }
  return persistSecretKey(secretKey, label);
}

async function persistSecretKey(secretKey: Uint8Array, label: string): Promise<StoredIdentity> {
  const id = randomId();
  const pubkey = getPublicKey(secretKey);
  const identity: StoredIdentity = {
    id,
    label: label.trim() || 'Me',
    pubkey,
    npub: npubEncode(pubkey),
    createdAt: Date.now(),
  };
  await SecureStore.setItemAsync(SECRET_PREFIX + id, bytesToHex(secretKey), {
    requireAuthentication: false,
  });
  const registry = await readRegistry();
  registry.identities.push(identity);
  registry.activeId = id;
  await writeRegistry(registry);
  return identity;
}

export async function readSecretKey(id: string): Promise<Uint8Array> {
  const hex = await SecureStore.getItemAsync(SECRET_PREFIX + id);
  if (!hex) throw new Error('Identity secret is missing from secure storage');
  return hexToBytes(hex);
}

export async function deleteIdentity(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(SECRET_PREFIX + id);
  const registry = await readRegistry();
  registry.identities = registry.identities.filter((identity) => identity.id !== id);
  if (registry.activeId === id) registry.activeId = registry.identities[0]?.id ?? null;
  await writeRegistry(registry);
}

/** Exports the identity for a portable encrypted backup. Returns nsec in bech32 form. */
export async function exportIdentitySecret(id: string): Promise<string> {
  const secretKey = await readSecretKey(id);
  return nsecEncode(secretKey);
}

export async function signerFor(id: string): Promise<NostrSigner> {
  const secretKey = await readSecretKey(id);
  return {
    async getPublicKey() {
      return getPublicKey(secretKey);
    },
    async signEvent(template) {
      return finalizeEvent(template, secretKey);
    },
  };
}
