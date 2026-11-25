import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { unwrapEvent } from 'nostr-tools/nip59';

import {
  FOLIO_CONTROL_TAG,
  parseControlPayload,
  wrapControl,
  type CircleAcceptPayload,
  type CircleInvitePayload,
} from '../src/lib/nostr/circleControl';

function inviteFor(ownerPubkey: string, members: string[]): CircleInvitePayload {
  return {
    v: 1,
    type: 'circle-invite',
    circle: {
      id: 'circle-1',
      name: 'Close friends',
      description: 'Sunday walks',
      ownerPubkey,
      ownerName: 'Leon',
      membershipVersion: 3,
      members,
      names: { [ownerPubkey]: 'Leon', ...(members[1] ? { [members[1]]: 'Sam' } : {}) },
    },
    invitedAt: 1_700_000_000,
  };
}

test('an invitation round-trips through NIP-59 to the invited member', () => {
  const owner = generateSecretKey();
  const member = generateSecretKey();
  const ownerPub = getPublicKey(owner);
  const memberPub = getPublicKey(member);

  const { wrap, rumorId } = wrapControl(inviteFor(ownerPub, [ownerPub, memberPub]), owner, memberPub);
  assert.equal(wrap.kind, 1059);
  assert.ok(verifyEvent(wrap));

  const rumor = unwrapEvent(wrap, member);
  assert.equal(rumor.kind, 14);
  assert.equal(rumor.pubkey, ownerPub);
  assert.equal(rumor.id, rumorId);
  const parsed = parseControlPayload(rumor.tags);
  assert.deepEqual(parsed, inviteFor(ownerPub, [ownerPub, memberPub]));
});

test('an outsider cannot read or forge an invitation', () => {
  const owner = generateSecretKey();
  const member = generateSecretKey();
  const outsider = generateSecretKey();
  const ownerPub = getPublicKey(owner);
  const memberPub = getPublicKey(member);
  const { wrap } = wrapControl(inviteFor(ownerPub, [ownerPub, memberPub]), owner, memberPub);
  assert.throws(() => unwrapEvent(wrap, outsider));

  const forged = { ...wrap, content: wrap.content.slice(0, -4) + 'AAAA' };
  assert.throws(() => unwrapEvent(forged, member));
});

test('acceptance messages parse and validate', () => {
  const member = generateSecretKey();
  const memberPub = getPublicKey(member);
  const accept: CircleAcceptPayload = {
    v: 1,
    type: 'circle-accept',
    circleId: 'circle-1',
    memberPubkey: memberPub,
    memberName: 'Sam',
    at: 1_700_000_100,
  };
  const { wrap } = wrapControl(accept, member, memberPub);
  const parsed = parseControlPayload(unwrapEvent(wrap, member).tags);
  assert.deepEqual(parsed, accept);
});

test('control payload validation rejects malformed or unsafe values', () => {
  const owner = generateSecretKey();
  const ownerPub = getPublicKey(owner);
  const memberPub = getPublicKey(generateSecretKey());
  const valid = inviteFor(ownerPub, [ownerPub, memberPub]);

  const wrapTag = (value: unknown) => [[FOLIO_CONTROL_TAG, JSON.stringify(value)]];

  assert.ok(parseControlPayload(wrapTag(valid)));
  assert.equal(parseControlPayload([]), null);
  assert.equal(parseControlPayload([[FOLIO_CONTROL_TAG, 'not json']]), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, v: 2 })), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, type: 'unknown' })), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, circle: { ...valid.circle, name: '' } })), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, circle: { ...valid.circle, name: 'x'.repeat(81) } })), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, circle: { ...valid.circle, ownerPubkey: 'nope' } })), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, circle: { ...valid.circle, membershipVersion: 0 } })), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, circle: { ...valid.circle, members: [] } })), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, circle: { ...valid.circle, members: ['bad'] } })), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, invitedAt: 'now' })), null);
  assert.equal(
    parseControlPayload(wrapTag({ ...valid, circle: { ...valid.circle, ownerName: 'x'.repeat(41) } })),
    null
  );
  assert.equal(
    parseControlPayload(
      wrapTag({ ...valid, circle: { ...valid.circle, names: { [getPublicKey(generateSecretKey())]: 'Eve' } } })
    ),
    null
  );
  assert.equal(
    parseControlPayload(
      wrapTag({ ...valid, circle: { ...valid.circle, names: { [memberPub]: 'x'.repeat(41) } } })
    ),
    null
  );
  assert.equal(
    parseControlPayload(wrapTag({ v: 1, type: 'circle-accept', circleId: 'c', memberPubkey: 'bad', at: 1 })),
    null
  );
});

test('duplicate roster entries are collapsed', () => {
  const owner = generateSecretKey();
  const ownerPub = getPublicKey(owner);
  const memberPub = getPublicKey(generateSecretKey());
  const parsed = parseControlPayload([
    [FOLIO_CONTROL_TAG, JSON.stringify(inviteFor(ownerPub, [ownerPub, memberPub, ownerPub]))],
  ]);
  assert.ok(parsed && parsed.type === 'circle-invite');
  assert.deepEqual(parsed.circle.members, [ownerPub, memberPub]);
});
