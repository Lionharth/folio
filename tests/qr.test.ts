import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npubEncode } from 'nostr-tools/nip19';

import { pubkeyFromQrPayload } from '../src/lib/nostr/format';

const PUBKEY = '0123456789abcdef'.repeat(4);

test('round-trips an npub payload', () => {
  assert.equal(pubkeyFromQrPayload(npubEncode(PUBKEY)), PUBKEY);
});

test('accepts raw hex and uppercase hex', () => {
  assert.equal(pubkeyFromQrPayload(PUBKEY), PUBKEY);
  assert.equal(pubkeyFromQrPayload(PUBKEY.toUpperCase()), PUBKEY);
});

test('accepts NIP-21 prefixed npubs and surrounding whitespace', () => {
  assert.equal(pubkeyFromQrPayload(`  nostr:${npubEncode(PUBKEY)}  `), PUBKEY);
});

test('returns null for non-Folio payloads', () => {
  assert.equal(pubkeyFromQrPayload(''), null);
  assert.equal(pubkeyFromQrPayload('hello world'), null);
  assert.equal(pubkeyFromQrPayload('https://example.com/npub1abc'), null);
  assert.equal(pubkeyFromQrPayload('npub1notarealcode'), null);
  assert.equal(pubkeyFromQrPayload('nsec1notapublickey'), null);
  assert.equal(pubkeyFromQrPayload(PUBKEY.slice(0, 63)), null);
});
