import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';

import { bytesToBase64, utf8ToBytes } from '../crypto/bytes';

export const BLOSSOM_AUTH_KIND = 24242;

export type BlossomVerb = 'get' | 'upload' | 'list' | 'delete' | 'media';

export interface BlossomAuthInput {
  verb: BlossomVerb;
  server: string;
  sha256?: string;
  lifetimeSeconds?: number;
  content?: string;
}

function base64UrlEncode(input: Uint8Array): string {
  return bytesToBase64(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecodeToString(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * BUD-11 authorization token: a signed kind-24242 event scoped to one verb,
 * one blob hash and one server, valid for a short window.
 */
export function buildBlossomAuthEvent(secretKey: Uint8Array, input: BlossomAuthInput) {
  const host = new URL(input.server).host;
  const now = Math.floor(Date.now() / 1000);
  const tags: string[][] = [
    ['t', input.verb],
    ['expiration', String(now + (input.lifetimeSeconds ?? 300))],
    ['server', host],
  ];
  if (input.sha256) tags.push(['x', input.sha256]);
  return finalizeEvent(
    {
      kind: BLOSSOM_AUTH_KIND,
      created_at: now,
      tags,
      content: input.content ?? '',
    },
    secretKey
  );
}

export function buildBlossomAuthHeader(secretKey: Uint8Array, input: BlossomAuthInput): string {
  const event = buildBlossomAuthEvent(secretKey, input);
  return `Nostr ${base64UrlEncode(utf8ToBytes(JSON.stringify(event)))}`;
}

/** Parses and verifies an `Authorization: Nostr <base64url>` header value. */
export function parseBlossomAuthHeader(header: string) {
  if (!header.startsWith('Nostr ')) throw new Error('Missing Nostr authorization scheme');
  const event = JSON.parse(base64UrlDecodeToString(header.slice(6)));
  if (event.kind !== BLOSSOM_AUTH_KIND) throw new Error('Unexpected authorization event kind');
  if (!verifyEvent(event)) throw new Error('Invalid authorization signature');
  return event as { kind: number; pubkey: string; tags: string[][]; content: string; created_at: number; id: string; sig: string };
}
