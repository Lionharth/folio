import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { createRumor, createSeal, createWrap, unwrapEvent } from 'nostr-tools/nip59';

import {
  FOLIO_FORMAT_FC1,
  parseKeyPayload,
  sanitizeMirrorUrls,
  wrapKeyMessage,
  type VlogKeyPayload,
} from '../src/lib/nostr/dm';
import { bytesToBase64 } from '../src/lib/crypto/bytes';

function makePayload(overrides: Partial<VlogKeyPayload> = {}): VlogKeyPayload {
  return {
    v: 1,
    vlogId: 'vlog-1',
    clipId: 'clip-1',
    circleId: 'circle-1',
    authorName: 'Leon',
    title: 'Sunday morning',
    description: 'Coffee and the park',
    format: FOLIO_FORMAT_FC1,
    keyB64: bytesToBase64(new Uint8Array(32).fill(9)),
    encryptedSha256: 'a'.repeat(64),
    plaintextSha256: 'b'.repeat(64),
    encryptedSize: 12345,
    plaintextSize: 12000,
    durationMs: 4200,
    mimeType: 'video/mp4',
    createdAt: 1_700_000_000,
    ...overrides,
  };
}

test('two independent identities can exchange a wrapped key message', () => {
  const alice = generateSecretKey();
  const bob = generateSecretKey();
  const alicePub = getPublicKey(alice);
  const bobPub = getPublicKey(bob);
  assert.notEqual(alicePub, bobPub);

  const payload = makePayload();
  const message = wrapKeyMessage({
    secretKey: alice,
    recipientPubkeys: [bobPub],
    payload,
    primaryUrl: 'https://blossom.example/abc.mp4',
  });

  assert.equal(message.wraps.length, 2, 'one wrap per recipient plus the sender copy');
  for (const wrap of message.wraps) {
    assert.equal(wrap.kind, 1059);
    assert.ok(verifyEvent(wrap), 'gift wrap signature must verify');
    assert.equal(wrap.pubkey.includes(alicePub), false, 'gift wrap must use a random key');
  }

  const forBob = message.wraps.find((wrap) => wrap.tags.some((tag) => tag[0] === 'p' && tag[1] === bobPub));
  assert.ok(forBob);
  const rumor = unwrapEvent(forBob!, bob);
  assert.equal(rumor.pubkey, alicePub);
  assert.equal(rumor.kind, 15);
  assert.equal(rumor.content, 'https://blossom.example/abc.mp4');
  assert.equal(rumor.id, message.rumorId);

  const parsed = parseKeyPayload(rumor.tags);
  assert.deepEqual(parsed, payload);

  const forAlice = message.wraps.find((wrap) => wrap.tags.some((tag) => tag[0] === 'p' && tag[1] === alicePub));
  const ownCopy = unwrapEvent(forAlice!, alice);
  assert.equal(ownCopy.id, message.rumorId, 'sender copy shares the rumor id');
});

test('every wrap shares one rumor id so receivers can deduplicate', () => {
  const alice = generateSecretKey();
  const bob = generateSecretKey();
  const carol = generateSecretKey();
  const message = wrapKeyMessage({
    secretKey: alice,
    recipientPubkeys: [getPublicKey(bob), getPublicKey(carol)],
    payload: makePayload(),
    primaryUrl: 'https://blossom.example/abc.mp4',
  });
  assert.equal(message.wraps.length, 3);
  const ids = new Set(
    [bob, carol].map((key) => {
      const wrap = message.wraps.find((candidate) => candidate.tags.some((tag) => tag[1] === getPublicKey(key)));
      return unwrapEvent(wrap!, key).id;
    })
  );
  assert.equal(ids.size, 1);
  assert.equal([...ids][0], message.rumorId);
});

test('a third party cannot unwrap a message addressed to someone else', () => {
  const alice = generateSecretKey();
  const bob = generateSecretKey();
  const eve = generateSecretKey();
  const message = wrapKeyMessage({
    secretKey: alice,
    recipientPubkeys: [getPublicKey(bob)],
    payload: makePayload(),
    primaryUrl: 'https://blossom.example/abc.mp4',
  });
  const forBob = message.wraps.find((wrap) => wrap.tags.some((tag) => tag[0] === 'p' && tag[1] === getPublicKey(bob)));
  assert.throws(() => unwrapEvent(forBob!, eve));
});

test('tampering with the gift wrap is detected', () => {
  const alice = generateSecretKey();
  const bob = generateSecretKey();
  const message = wrapKeyMessage({
    secretKey: alice,
    recipientPubkeys: [getPublicKey(bob)],
    payload: makePayload(),
    primaryUrl: 'https://blossom.example/abc.mp4',
  });
  const wrap = message.wraps[0];
  const tampered = { ...wrap, content: wrap.content.slice(0, -4) + 'AAAA' };
  assert.throws(() => unwrapEvent(tampered, bob));
});

test('a seal that impersonates the rumor author is rejected', () => {
  const alice = generateSecretKey();
  const bob = generateSecretKey();
  const mallory = generateSecretKey();

  const rumor = createRumor(
    { kind: 15, created_at: 1_700_000_000, tags: [['p', getPublicKey(bob)]], content: 'https://x' },
    alice
  );
  const seal = createSeal(rumor, mallory, getPublicKey(bob));
  const wrap = createWrap(seal, getPublicKey(bob));
  assert.throws(() => unwrapEvent(wrap, bob), /does not match/);
});

test('payload parsing rejects malformed or unsafe values', () => {
  const good = makePayload();
  assert.ok(parseKeyPayload([['folio-key', JSON.stringify(good)]]));

  assert.equal(parseKeyPayload([]), null);
  assert.equal(parseKeyPayload([['folio-key', 'not json']]), null);
  assert.equal(parseKeyPayload([['folio-key', JSON.stringify({ ...good, keyB64: bytesToBase64(new Uint8Array(16)) })]]), null);
  assert.equal(parseKeyPayload([['folio-key', JSON.stringify({ ...good, encryptedSha256: '' })]]), null);
  assert.equal(
    parseKeyPayload([['folio-key', JSON.stringify({ ...good, encryptedSha256: 'a'.repeat(63) + '/' })]]),
    null
  );
  assert.equal(parseKeyPayload([['folio-key', JSON.stringify({ ...good, format: 'other' })]]), null);
  assert.equal(parseKeyPayload([['folio-key', JSON.stringify({ ...good, v: 2 })]]), null);
  assert.equal(parseKeyPayload([['other-tag', JSON.stringify(good)]]), null);
  assert.equal(parseKeyPayload([['folio-key', JSON.stringify({ ...good, authorName: 'x'.repeat(41) })]]), null);
  assert.equal(parseKeyPayload([['folio-key', JSON.stringify({ ...good, authorName: '' })]]), null);
});

test('a valid encrypted thumbnail travels with the payload', () => {
  const payload = makePayload({
    thumbnail: {
      url: 'https://blossom.example/thumb.jpg',
      keyB64: bytesToBase64(new Uint8Array(32).fill(7)),
      sha256: 'c'.repeat(64),
      plaintextSha256: 'd'.repeat(64),
      size: 4096,
      plaintextSize: 4000,
      mimeType: 'image/jpeg',
      width: 720,
      height: 405,
    },
  });

  const parsed = parseKeyPayload([['folio-key', JSON.stringify(payload)]]);
  assert.deepEqual(parsed, payload);
});

test('a malformed thumbnail is dropped without losing the video', () => {
  const payload = makePayload({
    thumbnail: {
      url: 'https://blossom.example/thumb.jpg',
      keyB64: bytesToBase64(new Uint8Array(32).fill(7)),
      sha256: 'c'.repeat(64),
      size: 4096,
      mimeType: 'image/jpeg',
      width: 720,
      height: 405,
    },
  });

  const tooLarge = parseKeyPayload([
    ['folio-key', JSON.stringify({ ...payload, thumbnail: { ...payload.thumbnail, size: 99_999_999 } })],
  ]);
  assert.ok(tooLarge);
  assert.equal(tooLarge.thumbnail, undefined);

  const insecure = parseKeyPayload([
    ['folio-key', JSON.stringify({ ...payload, thumbnail: { ...payload.thumbnail, url: 'javascript:alert(1)' } })],
  ]);
  assert.ok(insecure);
  assert.equal(insecure.thumbnail, undefined);

  const badKey = parseKeyPayload([
    ['folio-key', JSON.stringify({ ...payload, thumbnail: { ...payload.thumbnail, keyB64: bytesToBase64(new Uint8Array(16)) } })],
  ]);
  assert.ok(badKey);
  assert.equal(badKey.thumbnail, undefined);
});

test('mirror URLs are sanitized before they reach playback', () => {
  assert.deepEqual(sanitizeMirrorUrls(null), []);
  assert.deepEqual(sanitizeMirrorUrls('https://blossom.example/abc'), []);
  assert.deepEqual(
    sanitizeMirrorUrls([
      'https://nostr.download/abc',
      'https://nostr.download/def',
      'javascript:alert(1)',
      'not a url',
      42,
      ' https://blossom.ditto.pub/xyz/// ',
    ]),
    ['https://nostr.download/abc', 'https://blossom.ditto.pub/xyz']
  );

  const capped = sanitizeMirrorUrls(
    ['https://a.example/1', 'https://b.example/2', 'https://c.example/3', 'https://d.example/4', 'https://e.example/5'],
    2
  );
  assert.deepEqual(capped, ['https://a.example/1', 'https://b.example/2']);
});

test('mirror URLs must be public https blobs', () => {
  assert.deepEqual(
    sanitizeMirrorUrls([
      'http://nostr.download/abc',
      'https://127.0.0.1/abc',
      'https://10.1.2.3/abc',
      'https://172.16.0.9/abc',
      'https://192.168.1.2/abc',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/abc',
      'https://[fd00::1]/abc',
      'https://localhost/abc',
      'https://printer.local/abc',
      'https://user:pass@nostr.download/abc',
      'https://nostr.download/ok',
      'https://8.8.8.8/blob',
    ]),
    ['https://nostr.download/ok', 'https://8.8.8.8/blob']
  );
});

test('payload parsing keeps valid mirrors and drops malformed ones', () => {
  const payload = makePayload({
    mirrors: ['https://nostr.download/abc', 'javascript:alert(1)'],
  });
  const parsed = parseKeyPayload([['folio-key', JSON.stringify(payload)]]);
  assert.ok(parsed);
  assert.deepEqual(parsed.mirrors, ['https://nostr.download/abc']);

  const notAnArray = parseKeyPayload([
    ['folio-key', JSON.stringify({ ...makePayload(), mirrors: 'https://nostr.download/abc' })],
  ]);
  assert.ok(notAnArray);
  assert.equal(notAnArray.mirrors, undefined);

  const nullPayload = parseKeyPayload([['folio-key', 'null']]);
  assert.equal(nullPayload, null);
});

test('thumbnail mirrors survive parsing and bad ones are dropped', () => {
  const payload = makePayload({
    thumbnail: {
      url: 'https://blossom.example/thumb.jpg',
      keyB64: bytesToBase64(new Uint8Array(32).fill(7)),
      sha256: 'c'.repeat(64),
      size: 4096,
      mimeType: 'image/jpeg',
      width: 720,
      height: 405,
      mirrors: ['https://nostr.download/thumb', 'ftp://bad.example/thumb'],
    },
  });

  const parsed = parseKeyPayload([['folio-key', JSON.stringify(payload)]]);
  assert.ok(parsed?.thumbnail);
  assert.deepEqual(parsed.thumbnail.mirrors, ['https://nostr.download/thumb']);
});
