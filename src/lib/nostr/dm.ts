import { getPublicKey, finalizeEvent, type Event, type EventTemplate } from 'nostr-tools/pure';
import { createRumor, createSeal, createWrap, unwrapEvent } from 'nostr-tools/nip59';

import { KIND_PRIVATE_MESSAGE, parseControlPayload, type CircleControlPayload } from './circleControl';

import { MAX_THUMBNAIL_BYTES } from '../../constants/media';
import { bytesToBase64, base64ToBytes } from '../crypto/bytes';
import { DEFAULT_DM_RELAYS, publishToRelays, queryRelays, type Pool } from './relays';

export const KIND_FILE_MESSAGE = 15;
export const KIND_DM_RELAY_LIST = 10050;
export const KIND_GIFT_WRAP = 1059;

export const FOLIO_KEY_TAG = 'folio-key';
export const FOLIO_FORMAT_FC1 = 'FOLIOFC1';

/**
 * Application-level media manifest delivered inside a NIP-17 kind-15 file
 * message. The whole rumor is NIP-44 encrypted and gift-wrapped, so the title,
 * description and media key are never visible to relays or storage providers.
 *
 * Compatibility note: NIP-17 defines `decryption-key` for a single aes-gcm
 * nonce. FOLIO-FC1 frames the file into independently authenticated chunks, so
 * there is no single nonce. We keep `decryption-key` meaningful for standard
 * clients and describe the container in `folio-format`. See PROTOCOLS.md.
 */
export interface VlogThumbnailPayload {
  /** Encrypted FC1 blob URL for the JPEG cover. */
  url: string;
  /** AES-256 key for the cover, separate from the video key. */
  keyB64: string;
  sha256: string;
  plaintextSha256?: string;
  size: number;
  plaintextSize?: number;
  mimeType: string;
  width: number;
  height: number;
}

export interface VlogKeyPayload {
  v: 1;
  vlogId: string;
  clipId: string;
  circleId: string;
  authorName?: string;
  title?: string;
  description?: string;
  format: typeof FOLIO_FORMAT_FC1;
  keyB64: string;
  encryptedSha256: string;
  plaintextSha256: string;
  encryptedSize: number;
  plaintextSize: number;
  durationMs: number;
  mimeType: string;
  width?: number;
  height?: number;
  thumbnail?: VlogThumbnailPayload;
  createdAt: number;
  mirrors?: string[];
}

export function buildKeyMessageRumor(
  payload: VlogKeyPayload,
  recipientPubkeys: string[],
  primaryUrl: string
): EventTemplate {
  const tags: string[][] = [];
  for (const recipient of recipientPubkeys) tags.push(['p', recipient]);
  tags.push(['file-type', payload.mimeType]);
  tags.push(['encryption-algorithm', 'aes-256-gcm']);
  tags.push(['decryption-key', payload.keyB64]);
  tags.push(['x', payload.encryptedSha256]);
  tags.push(['size', String(payload.encryptedSize)]);
  tags.push(['folio-format', FOLIO_FORMAT_FC1]);
  tags.push([FOLIO_KEY_TAG, JSON.stringify(payload)]);
  tags.push(['alt', payload.title ? `Private video: ${payload.title}` : 'Private video']);
  return {
    kind: KIND_FILE_MESSAGE,
    created_at: payload.createdAt,
    tags,
    content: primaryUrl,
  };
}

export interface WrapKeyMessageOptions {
  secretKey: Uint8Array;
  recipientPubkeys: string[];
  payload: VlogKeyPayload;
  primaryUrl: string;
}

export interface WrappedKeyMessage {
  rumorId: string;
  wraps: Event[];
}

/**
 * Seal and gift-wrap the key message for every recipient plus the sender, so
 * the sender can re-read their own archive on another device. All copies share
 * one rumor id, which lets receivers deduplicate redeliveries.
 */
export function wrapKeyMessage(options: WrapKeyMessageOptions): WrappedKeyMessage {
  const template = buildKeyMessageRumor(options.payload, options.recipientPubkeys, options.primaryUrl);
  const rumor = createRumor(
    { kind: template.kind, created_at: template.created_at, tags: template.tags, content: template.content },
    options.secretKey
  );
  const senderPubkey = getPublicKey(options.secretKey);
  const targets = [...new Set([...options.recipientPubkeys, senderPubkey])];
  const wraps = targets.map((recipient) => createWrap(createSeal(rumor, options.secretKey, recipient), recipient));
  return { rumorId: rumor.id, wraps };
}

/**
 * Publishes each gift wrap to the recipient's inbox relays (NIP-17 requires
 * sending only to relays listed in the recipient's kind-10050 event). Falls
 * back to the shared relay list when the recipient advertises none.
 */
export async function publishKeyMessage(
  pool: Pool,
  message: WrappedKeyMessage,
  options: {
    relaysForPubkey: (pubkey: string) => string[];
    fallbackRelays: string[];
  }
): Promise<string[]> {
  const accepted = new Set<string>();
  for (const wrap of message.wraps) {
    const recipient = wrap.tags.find((tag) => tag[0] === 'p')?.[1];
    const relays = (recipient ? options.relaysForPubkey(recipient) : null) ?? options.fallbackRelays;
    if (relays.length === 0) continue;
    const report = await publishToRelays(pool, relays, wrap);
    for (const url of report.accepted) accepted.add(url);
  }
  return [...accepted];
}

export interface InboxMessage {
  rumorId: string;
  senderPubkey: string;
  createdAt: number;
  content: string;
  tags: string[][];
  payload: VlogKeyPayload;
  wrapEventId: string;
}

export function parseKeyPayload(tags: string[][]): VlogKeyPayload | null {
  const tag = tags.find((entry) => entry[0] === FOLIO_KEY_TAG);
  if (!tag?.[1]) return null;
  let parsed: VlogKeyPayload;
  try {
    parsed = JSON.parse(tag[1]) as VlogKeyPayload;
  } catch {
    return null;
  }
  if (parsed.v !== 1 || parsed.format !== FOLIO_FORMAT_FC1) return null;
  if (!parsed.keyB64 || !parsed.encryptedSha256 || !parsed.clipId || !parsed.vlogId) return null;
  if (parsed.authorName !== undefined) {
    if (typeof parsed.authorName !== 'string' || parsed.authorName.trim().length === 0) return null;
    if (parsed.authorName.length > 40) return null;
    parsed.authorName = parsed.authorName.trim();
  }
  if (!Number.isFinite(parsed.encryptedSize) || !Number.isFinite(parsed.durationMs)) return null;
  if (base64ToBytes(parsed.keyB64).length !== 32) return null;
  if (parsed.thumbnail !== undefined) {
    const thumbnail = parseThumbnailPayload(parsed.thumbnail);
    if (thumbnail) parsed.thumbnail = thumbnail;
    else delete parsed.thumbnail;
  }
  return parsed;
}

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * Thumbnails are optional and additive, so a malformed cover is dropped instead
 * of rejecting the whole video message.
 */
export function parseThumbnailPayload(value: unknown): VlogThumbnailPayload | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.url !== 'string' || !/^https?:\/\//i.test(candidate.url)) return null;
  if (typeof candidate.keyB64 !== 'string') return null;
  if (typeof candidate.sha256 !== 'string' || !HEX_64.test(candidate.sha256)) return null;
  if (
    candidate.plaintextSha256 !== undefined &&
    (typeof candidate.plaintextSha256 !== 'string' || !HEX_64.test(candidate.plaintextSha256))
  ) {
    return null;
  }
  if (typeof candidate.size !== 'number' || !Number.isFinite(candidate.size) || candidate.size <= 0) return null;
  if (candidate.size > MAX_THUMBNAIL_BYTES) return null;
  if (typeof candidate.mimeType !== 'string' || !candidate.mimeType.startsWith('image/')) return null;
  if (
    typeof candidate.width !== 'number' ||
    !Number.isFinite(candidate.width) ||
    candidate.width <= 0 ||
    candidate.width > 8192 ||
    typeof candidate.height !== 'number' ||
    !Number.isFinite(candidate.height) ||
    candidate.height <= 0 ||
    candidate.height > 8192
  ) {
    return null;
  }
  let keyLength = 0;
  try {
    keyLength = base64ToBytes(candidate.keyB64).length;
  } catch {
    return null;
  }
  if (keyLength !== 32) return null;
  return {
    url: candidate.url,
    keyB64: candidate.keyB64,
    sha256: candidate.sha256,
    plaintextSha256:
      typeof candidate.plaintextSha256 === 'string' ? candidate.plaintextSha256 : undefined,
    size: candidate.size,
    plaintextSize:
      typeof candidate.plaintextSize === 'number' && Number.isFinite(candidate.plaintextSize)
        ? candidate.plaintextSize
        : undefined,
    mimeType: candidate.mimeType,
    width: candidate.width,
    height: candidate.height,
  };
}

export interface ControlInboxMessage {
  rumorId: string;
  senderPubkey: string;
  createdAt: number;
  payload: CircleControlPayload;
  wrapEventId: string;
}

export interface InboxResult {
  files: InboxMessage[];
  controls: ControlInboxMessage[];
}

/**
 * Fetches and unwraps gift wraps addressed to the secret key's public key in a
 * single relay query. Invalid seals, impostor rumors and non-FOLIO messages are
 * skipped. Nothing decrypted is logged.
 */
export async function fetchInboxMessages(
  pool: Pool,
  relays: string[],
  secretKey: Uint8Array,
  options: { since?: number; limit?: number } = {}
): Promise<InboxResult> {
  const pubkey = getPublicKey(secretKey);
  const wraps = await queryRelays(pool, relays, {
    kinds: [KIND_GIFT_WRAP],
    '#p': [pubkey],
    since: options.since,
    limit: options.limit ?? 200,
  });

  const seen = new Set<string>();
  const files: InboxMessage[] = [];
  const controls: ControlInboxMessage[] = [];
  for (const wrap of wraps) {
    let rumor;
    try {
      rumor = unwrapEvent(wrap, secretKey);
    } catch {
      continue;
    }
    if (seen.has(rumor.id)) continue;

    if (rumor.kind === KIND_FILE_MESSAGE) {
      const payload = parseKeyPayload(rumor.tags);
      if (!payload) continue;
      seen.add(rumor.id);
      files.push({
        rumorId: rumor.id,
        senderPubkey: rumor.pubkey,
        createdAt: rumor.created_at,
        content: rumor.content,
        tags: rumor.tags,
        payload,
        wrapEventId: wrap.id,
      });
      continue;
    }

    if (rumor.kind === KIND_PRIVATE_MESSAGE) {
      const payload = parseControlPayload(rumor.tags);
      if (!payload) continue;
      seen.add(rumor.id);
      controls.push({
        rumorId: rumor.id,
        senderPubkey: rumor.pubkey,
        createdAt: rumor.created_at,
        payload,
        wrapEventId: wrap.id,
      });
    }
  }
  files.sort((a, b) => b.createdAt - a.createdAt);
  controls.sort((a, b) => b.createdAt - a.createdAt);
  return { files, controls };
}

/** Publishes the NIP-17 inbox relay list (kind 10050). */
export async function publishInboxRelays(
  pool: Pool,
  secretKey: Uint8Array,
  relays: string[]
): Promise<void> {
  const event = finalizeEvent(
    {
      kind: KIND_DM_RELAY_LIST,
      created_at: Math.floor(Date.now() / 1000),
      tags: relays.map((relay) => ['relay', relay]),
      content: '',
    },
    secretKey
  );
  await publishToRelays(pool, relays, event);
}

export async function resolveInboxRelays(
  pool: Pool,
  pubkey: string,
  fallback: string[] = DEFAULT_DM_RELAYS
): Promise<string[]> {
  const events = await queryRelays(pool, fallback, { kinds: [KIND_DM_RELAY_LIST], authors: [pubkey] }, 5_000);
  const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
  if (!newest) return fallback;
  const relays = newest.tags.filter((tag) => tag[0] === 'relay' && tag[1]).map((tag) => tag[1]);
  const valid = relays.filter((url) => url.startsWith('wss://'));
  return valid.length > 0 ? valid.slice(0, 5) : fallback;
}

export function bytesFromPayload(payload: VlogKeyPayload): Uint8Array {
  return base64ToBytes(payload.keyB64);
}

export function keyToBase64(key: Uint8Array): string {
  return bytesToBase64(key);
}
