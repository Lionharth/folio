import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildInvitePushMessage,
  buildMomentPushMessage,
  buildSocialPushMessage,
  chunkPushMessages,
  invalidTokensFromResponse,
  isExpoPushToken,
  uniquePushTokens,
} from '../src/lib/notifications/push';
import {
  remoteVlogNotificationUrl,
  resolveNotificationRoute,
} from '../src/lib/notifications/routes';

const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

test('Expo push tokens are validated strictly', () => {
  assert.equal(isExpoPushToken(TOKEN), true);
  assert.equal(isExpoPushToken('ExpoPushToken[abc-123_456]'), true);
  assert.equal(isExpoPushToken('FCM[abc]'), false);
  assert.equal(isExpoPushToken('ExponentPushToken[]'), false);
  assert.equal(isExpoPushToken(`ExponentPushToken[${'x'.repeat(300)}]`), false);
  assert.equal(isExpoPushToken(null), false);
  assert.equal(isExpoPushToken(''), false);
});

test('push messages are batched at the Expo limit', () => {
  assert.deepEqual(chunkPushMessages([1, 2, 3], 2), [[1, 2], [3]]);
  const chunks = chunkPushMessages(Array.from({ length: 205 }, (_, index) => index));
  assert.deepEqual(chunks.map((chunk) => chunk.length), [100, 100, 5]);
  assert.throws(() => chunkPushMessages([1], 0));
});

test('moment pushes carry only generic copy and a remote route', () => {
  const message = buildMomentPushMessage(TOKEN, { remoteId: 'remote-1', circleId: 'circle-1', viewerPubkey: 'viewer' });
  assert.equal(message.title, 'New moment');
  assert.equal(message.body, 'A moment was shared in one of your circles.');
  assert.equal(message.data.url, '/open?remoteId=remote-1');
  assert.equal(message.data.remoteId, 'remote-1');
  assert.equal(message.data.circleId, 'circle-1');
  assert.equal(message.data.category, 'moment');
  assert.equal(message.data.viewerPubkey, 'viewer');
  assert.equal(message.channelId, 'moments');
  assert.equal(message.sound, 'default');
});

test('social pushes route to the expanded conversation without content', () => {
  const reply = buildSocialPushMessage(TOKEN, {
    remoteId: 'remote 1',
    circleId: 'circle-1',
    category: 'reply',
    viewerPubkey: 'viewer',
  });
  assert.equal(reply.title, 'New reply');
  assert.equal(reply.data.url, '/open?remoteId=remote%201&comments=1');
  assert.equal(reply.channelId, 'social');
  assert.equal(reply.collapseId, 'social-remote 1');
  assert.equal(reply.threadId, 'moment-remote 1');

  const reaction = buildSocialPushMessage(TOKEN, {
    remoteId: 'remote-1',
    circleId: 'circle-1',
    category: 'reaction',
    targetType: 'comment',
    viewerPubkey: 'viewer',
  });
  assert.equal(reaction.body, 'Someone reacted to your comment.');
});

test('invite pushes are generic and route to Circles', () => {
  const message = buildInvitePushMessage(TOKEN, {
    circleId: 'circle-1',
    viewerPubkey: 'viewer',
  });
  assert.equal(message.title, 'New invitation');
  assert.equal(message.body, 'Someone invited you to a circle.');
  assert.equal(message.data.url, '/circles');
  assert.equal(message.data.remoteId, undefined);
  assert.equal(message.data.circleId, 'circle-1');
  assert.equal(message.data.category, 'invite');
  assert.equal(message.data.viewerPubkey, 'viewer');
  assert.equal(message.channelId, 'circles');
});

test('multi-identity pushes carry every eligible viewer', () => {
  const message = buildMomentPushMessage(TOKEN, {
    remoteId: 'remote-1',
    circleId: 'circle-1',
    viewerPubkey: 'viewer-a',
    viewerPubkeys: ['viewer-a', 'viewer-b'],
  });
  assert.equal(message.data.viewerPubkey, 'viewer-a');
  assert.deepEqual(message.data.viewerPubkeys, ['viewer-a', 'viewer-b']);

  const single = buildMomentPushMessage(TOKEN, {
    remoteId: 'remote-1',
    circleId: 'circle-1',
    viewerPubkey: 'viewer-a',
  });
  assert.equal(single.data.viewerPubkeys, undefined);
});

test('only DeviceNotRegistered tickets invalidate their matching token', () => {
  const other = 'ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyy]';
  const invalid = invalidTokensFromResponse(
    {
      data: [
        { status: 'ok', id: 'ticket-1' },
        {
          status: 'error',
          message: 'not registered',
          details: { error: 'DeviceNotRegistered' },
        },
        { status: 'error', details: { error: 'MessageTooBig' } },
      ],
    },
    [TOKEN, other, 'ExpoPushToken[zzzzzzzzzzzzzzzzzzzzzz]']
  );
  assert.deepEqual(invalid, [other]);
  assert.deepEqual(invalidTokensFromResponse({}, [TOKEN]), []);
});

test('duplicate and invalid tokens are removed before sending', () => {
  assert.deepEqual(uniquePushTokens([TOKEN, TOKEN, 'bad', 'ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyy]']), [
    TOKEN,
    'ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyy]',
  ]);
});

test('remote notification URLs resolve to the remote-vlog route', () => {
  const viewer = `abcdef0123${'0'.repeat(54)}`;
  assert.deepEqual(resolveNotificationRoute(remoteVlogNotificationUrl('remote 1', true), viewer), {
    kind: 'remote-vlog',
    remoteId: 'remote 1',
    comments: true,
  });
  assert.deepEqual(resolveNotificationRoute(remoteVlogNotificationUrl('remote-1'), viewer), {
    kind: 'remote-vlog',
    remoteId: 'remote-1',
    comments: false,
  });
  assert.equal(resolveNotificationRoute('/open', viewer), null);
  assert.equal(resolveNotificationRoute('/open?remoteId=', viewer), null);
  assert.equal(resolveNotificationRoute('/open?remoteId=a%00b', viewer), null);
});
