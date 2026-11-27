import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { unwrapEvent } from 'nostr-tools/nip59';

import {
  FOLIO_CONTROL_TAG,
  parseControlPayload,
  wrapControl,
  wrapControlForRecipients,
  type CircleAcceptPayload,
  type CircleCommentPayload,
  type CircleInvitePayload,
  type CircleMembershipPayload,
  type CircleReactionPayload,
  type PushTokenPayload,
  type PushTokenRequestPayload,
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

function membershipFor(
  ownerPubkey: string,
  memberPubkey: string,
  action: CircleMembershipPayload['action'] = 'join',
  members: string[] = [ownerPubkey, memberPubkey]
): CircleMembershipPayload {
  return {
    v: 1,
    type: 'circle-membership',
    action,
    circleId: 'circle-1',
    ownerPubkey,
    memberPubkey,
    membershipVersion: 3,
    at: 1_700_000_200,
    circle: {
      ...inviteFor(ownerPubkey, members).circle,
    },
  };
}

test('membership receipts round-trip through NIP-59 to the identity itself', () => {
  const owner = generateSecretKey();
  const member = generateSecretKey();
  const ownerPub = getPublicKey(owner);
  const memberPub = getPublicKey(member);
  const receipt = membershipFor(ownerPub, memberPub);

  const { wrap } = wrapControl(receipt, member, memberPub);
  const rumor = unwrapEvent(wrap, member);
  assert.equal(rumor.pubkey, memberPub);
  assert.deepEqual(parseControlPayload(rumor.tags), receipt);
});

test('membership receipts validate the snapshot and owner linkage', () => {
  const owner = generateSecretKey();
  const ownerPub = getPublicKey(owner);
  const memberPub = getPublicKey(generateSecretKey());
  const valid = membershipFor(ownerPub, memberPub);
  const wrapTag = (value: unknown) => [[FOLIO_CONTROL_TAG, JSON.stringify(value)]];

  assert.ok(parseControlPayload(wrapTag(valid)));
  assert.ok(parseControlPayload(wrapTag(membershipFor(ownerPub, memberPub, 'decline'))));
  assert.equal(parseControlPayload(wrapTag({ ...valid, action: 'unknown' })), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, memberPubkey: 'bad' })), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, membershipVersion: 0 })), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, at: 'now' })), null);
  assert.equal(parseControlPayload(wrapTag({ ...valid, circle: undefined })), null);
  assert.equal(
    parseControlPayload(wrapTag({ ...valid, circle: { ...valid.circle, id: 'other' } })),
    null
  );
  assert.equal(
    parseControlPayload(wrapTag({ ...valid, circle: { ...valid.circle, ownerPubkey: getPublicKey(generateSecretKey()) } })),
    null
  );
  assert.equal(
    parseControlPayload(wrapTag({ ...valid, circle: { ...valid.circle, membershipVersion: 4 } })),
    null
  );
  assert.equal(
    parseControlPayload(wrapTag({ ...valid, circle: { ...valid.circle, members: [ownerPub] } })),
    null
  );
});

test('a removal snapshot may exclude the removed member', () => {
  const owner = generateSecretKey();
  const ownerPub = getPublicKey(owner);
  const memberPub = getPublicKey(generateSecretKey());
  const receipt = membershipFor(ownerPub, memberPub, 'removed', [ownerPub]);
  const parsed = parseControlPayload([[FOLIO_CONTROL_TAG, JSON.stringify(receipt)]]);
  assert.deepEqual(parsed, receipt);
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

function commentPayload(overrides: Partial<CircleCommentPayload> = {}): CircleCommentPayload {
  return {
    v: 1,
    type: 'circle-comment',
    opId: 'op-1',
    action: 'create',
    commentId: 'comment-1',
    circleId: 'circle-1',
    vlogId: 'vlog-1',
    body: 'A thought',
    at: 1_700_000_300_000,
    ...overrides,
  };
}

function reactionPayload(overrides: Partial<CircleReactionPayload> = {}): CircleReactionPayload {
  return {
    v: 1,
    type: 'circle-reaction',
    opId: 'op-2',
    targetType: 'vlog',
    targetId: 'vlog-1',
    vlogId: 'vlog-1',
    circleId: 'circle-1',
    emoji: '\u2764\ufe0f',
    active: true,
    at: 1_700_000_300_001,
    ...overrides,
  };
}

test('one social rumor is wrapped for every recipient and the sender', () => {
  const sender = generateSecretKey();
  const member = generateSecretKey();
  const outsider = generateSecretKey();
  const senderPub = getPublicKey(sender);
  const memberPub = getPublicKey(member);
  const payload = commentPayload({ authorName: 'Leon' });

  const { rumorId, wraps } = wrapControlForRecipients(payload, sender, [memberPub]);
  assert.equal(wraps.length, 2);
  assert.deepEqual(
    wraps.map((wrap) => wrap.tags.find((tag) => tag[0] === 'p')?.[1]).sort(),
    [memberPub, senderPub].sort()
  );

  const wrapFor = (pubkey: string) =>
    wraps.find((wrap) => wrap.tags.some((tag) => tag[0] === 'p' && tag[1] === pubkey))!;
  const memberRumor = unwrapEvent(wrapFor(memberPub), member);
  const senderRumor = unwrapEvent(wrapFor(senderPub), sender);
  assert.equal(memberRumor.id, rumorId);
  assert.equal(senderRumor.id, rumorId);
  assert.deepEqual(parseControlPayload(memberRumor.tags), payload);
  assert.throws(() => unwrapEvent(wrapFor(memberPub), outsider));
});

test('social comment payloads validate action-specific fields', () => {
  const wrapTag = (value: unknown) => [[FOLIO_CONTROL_TAG, JSON.stringify(value)]];
  assert.deepEqual(
    parseControlPayload(wrapTag(commentPayload({ replyToId: 'comment-0' }))),
    commentPayload({ replyToId: 'comment-0' })
  );
  assert.deepEqual(parseControlPayload(wrapTag(commentPayload({ action: 'edit' }))), commentPayload({ action: 'edit' }));
  assert.deepEqual(parseControlPayload(wrapTag(commentPayload({ action: 'delete', body: undefined }))), {
    v: 1,
    type: 'circle-comment',
    opId: 'op-1',
    action: 'delete',
    commentId: 'comment-1',
    circleId: 'circle-1',
    vlogId: 'vlog-1',
    at: 1_700_000_300_000,
  });

  assert.equal(parseControlPayload(wrapTag(commentPayload({ action: 'delete', body: 'leftover' }))), null);
  assert.equal(parseControlPayload(wrapTag(commentPayload({ body: '' }))), null);
  assert.equal(parseControlPayload(wrapTag(commentPayload({ body: 'x'.repeat(1001) }))), null);
  assert.equal(parseControlPayload(wrapTag(commentPayload({ action: 'edit', replyToId: 'comment-0' }))), null);
  assert.equal(parseControlPayload(wrapTag(commentPayload({ action: 'edit', authorName: 'Sam' }))), null);
  assert.equal(parseControlPayload(wrapTag(commentPayload({ replyToId: 'comment-1' }))), null);
  assert.equal(parseControlPayload(wrapTag(commentPayload({ action: 'unknown' as never }))), null);
  assert.equal(parseControlPayload(wrapTag(commentPayload({ at: 1.5 }))), null);
  assert.equal(parseControlPayload(wrapTag(commentPayload({ opId: ' op ' }))), null);
  assert.equal(parseControlPayload(wrapTag(commentPayload({ authorName: 'x'.repeat(41) }))), null);
});

test('social reaction payloads validate targets and emoji', () => {
  const wrapTag = (value: unknown) => [[FOLIO_CONTROL_TAG, JSON.stringify(value)]];
  assert.deepEqual(parseControlPayload(wrapTag(reactionPayload())), reactionPayload());
  assert.deepEqual(
    parseControlPayload(wrapTag(reactionPayload({ targetType: 'comment', targetId: 'comment-1' }))),
    reactionPayload({ targetType: 'comment', targetId: 'comment-1' })
  );
  assert.deepEqual(
    parseControlPayload(wrapTag(reactionPayload({ active: false, authorName: 'Sam' }))),
    reactionPayload({ active: false, authorName: 'Sam' })
  );

  assert.equal(parseControlPayload(wrapTag(reactionPayload({ targetId: 'another-vlog' }))), null);
  assert.equal(parseControlPayload(wrapTag(reactionPayload({ targetType: 'message' as never }))), null);
  assert.equal(parseControlPayload(wrapTag(reactionPayload({ active: 'yes' as never }))), null);
  assert.equal(parseControlPayload(wrapTag(reactionPayload({ emoji: 'hello' }))), null);
  assert.equal(parseControlPayload(wrapTag(reactionPayload({ emoji: '\u2764\ufe0f \u2764\ufe0f' }))), null);
  assert.equal(parseControlPayload(wrapTag(reactionPayload({ authorName: 'x'.repeat(41) }))), null);
  assert.equal(parseControlPayload(wrapTag(reactionPayload({ at: -1 }))), null);
});

function pushTokenPayload(overrides: Partial<PushTokenPayload> = {}): PushTokenPayload {
  return {
    v: 1,
    type: 'push-token',
    circleId: 'circle-1',
    token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    platform: 'android',
    deviceId: 'device-12345678',
    enabled: true,
    preferences: { posts: true, activity: true, invites: true },
    muted: false,
    at: 1_700_000_400_000,
    ...overrides,
  };
}

test('push token controls round-trip and validate', () => {
  const sender = generateSecretKey();
  const recipient = generateSecretKey();
  const senderPub = getPublicKey(sender);
  const recipientPub = getPublicKey(recipient);
  const payload = pushTokenPayload();
  const request: PushTokenRequestPayload = {
    v: 1,
    type: 'push-token-request',
    circleId: 'circle-1',
    at: 1_700_000_400_001,
  };

  const tokenWrap = wrapControl(payload, sender, recipientPub).wrap;
  const tokenRumor = unwrapEvent(tokenWrap, recipient);
  assert.equal(tokenRumor.pubkey, senderPub);
  assert.deepEqual(parseControlPayload(tokenRumor.tags), payload);

  const requestWrap = wrapControl(request, sender, recipientPub).wrap;
  assert.deepEqual(parseControlPayload(unwrapEvent(requestWrap, recipient).tags), request);
});

test('push token controls reject unsafe values', () => {
  const wrapTag = (value: unknown) => [[FOLIO_CONTROL_TAG, JSON.stringify(value)]];
  assert.ok(parseControlPayload(wrapTag(pushTokenPayload())));
  assert.ok(parseControlPayload(wrapTag(pushTokenPayload({ enabled: false }))));
  assert.deepEqual(
    parseControlPayload(wrapTag({ ...pushTokenPayload(), preferences: undefined, muted: undefined })),
    pushTokenPayload({ preferences: { posts: true, activity: true, invites: true }, muted: false })
  );
  assert.deepEqual(
    parseControlPayload(
      wrapTag(
        pushTokenPayload({
          preferences: { posts: false, activity: true, invites: false },
          muted: true,
        })
      )
    ),
    pushTokenPayload({
      preferences: { posts: false, activity: true, invites: false },
      muted: true,
    })
  );
  assert.equal(
    parseControlPayload(wrapTag(pushTokenPayload({ preferences: 'none' as never }))),
    null
  );
  assert.equal(
    parseControlPayload(
      wrapTag(pushTokenPayload({ preferences: { posts: true, activity: true, invites: 'yes' as never } }))
    ),
    null
  );
  assert.equal(parseControlPayload(wrapTag(pushTokenPayload({ muted: 'yes' as never }))), null);
  assert.equal(parseControlPayload(wrapTag(pushTokenPayload({ token: 'not-a-token' }))), null);
  assert.equal(parseControlPayload(wrapTag(pushTokenPayload({ platform: 'web' as never }))), null);
  assert.equal(parseControlPayload(wrapTag(pushTokenPayload({ deviceId: 'short' }))), null);
  assert.equal(parseControlPayload(wrapTag(pushTokenPayload({ circleId: '' }))), null);
  assert.equal(parseControlPayload(wrapTag(pushTokenPayload({ at: 0 }))), null);
  assert.equal(parseControlPayload(wrapTag({ ...pushTokenPayload(), enabled: undefined })), null);
  assert.equal(
    parseControlPayload(wrapTag({ v: 1, type: 'push-token-request', circleId: '', at: 1 })),
    null
  );
});
