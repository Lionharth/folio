import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildInboxNotifications,
  type InboxNotificationEvents,
  type NotificationPreferences,
} from '../src/lib/notifications/copy';
import {
  circlesNotificationUrl,
  commentsNotificationUrl,
  resolveNotificationRoute,
  updatesNotificationUrl,
  vlogNotificationUrl,
} from '../src/lib/notifications/routes';

const preferences: NotificationPreferences = {
  enabled: true,
  posts: true,
  invites: true,
  membership: true,
  activity: true,
};

const names = { alice: 'Alice', bob: 'Bob', carol: 'Carol' };

function events(overrides: Partial<InboxNotificationEvents> = {}): InboxNotificationEvents {
  return { moments: [], invites: [], membership: [], social: [], ...overrides };
}

test('moments are grouped per circle and ordered by circle name', () => {
  const requests = buildInboxNotifications({
    events: events({
      moments: [
        { vlogId: 'w1', circleId: 'c-weekend', circleName: 'Weekend', authorPubkey: 'alice' },
        { vlogId: 'w2', circleId: 'c-weekend', circleName: 'Weekend', authorPubkey: 'bob' },
        { vlogId: 'f1', circleId: 'c-family', circleName: 'Family', authorPubkey: 'bob' },
      ],
    }),
    preferences,
    mutedCircleIds: [],
    names,
    viewerPubkey: 'viewer',
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].title, 'New moment in Family');
  assert.equal(requests[0].body, 'Bob shared a moment.');
  assert.equal(requests[0].data.url, '/vlog/f1');
  assert.equal(requests[1].title, '2 new moments in Weekend');
  assert.equal(requests[1].body, 'From Alice and 1 other.');
  assert.equal(requests[1].data.url, '/updates?circleId=c-weekend');
});

test('grouped copy uses plural others and encodes the circle id', () => {
  const [request] = buildInboxNotifications({
    events: events({
      moments: [
        { vlogId: 'm1', circleId: 'c 1', circleName: 'Studio', authorPubkey: 'alice' },
        { vlogId: 'm2', circleId: 'c 1', circleName: 'Studio', authorPubkey: 'bob' },
        { vlogId: 'm3', circleId: 'c 1', circleName: 'Studio', authorPubkey: 'carol' },
      ],
    }),
    preferences,
    mutedCircleIds: [],
    names,
    viewerPubkey: 'viewer',
  });

  assert.equal(request.title, '3 new moments in Studio');
  assert.equal(request.body, 'From Alice and 2 others.');
  assert.equal(request.data.url, '/updates?circleId=c%201');
});

test('muted circles suppress posts, invitations, and membership', () => {
  const requests = buildInboxNotifications({
    events: events({
      moments: [{ vlogId: 'm1', circleId: 'c1', circleName: 'Muted', authorPubkey: 'alice' }],
      invites: [
        { inviteId: 'i1', circleId: 'c1', circleName: 'Muted', ownerPubkey: 'bob', ownerName: 'Bob' },
      ],
      membership: [
        { circleId: 'c1', circleName: 'Muted', kind: 'accepted', memberPubkey: 'carol', memberName: 'Carol' },
      ],
    }),
    preferences,
    mutedCircleIds: new Set(['c1']),
    names,
    viewerPubkey: 'viewer',
  });

  assert.equal(requests.length, 0);
});

test('self-authored moments are filtered defensively', () => {
  const requests = buildInboxNotifications({
    events: events({
      moments: [{ vlogId: 'm1', circleId: 'c1', circleName: 'Own', authorPubkey: 'viewer' }],
    }),
    preferences,
    mutedCircleIds: [],
    names,
    viewerPubkey: 'viewer',
  });

  assert.equal(requests.length, 0);
});

test('preferences gate each event family', () => {
  const source = events({
    moments: [{ vlogId: 'm1', circleId: 'c1', circleName: 'One', authorPubkey: 'alice' }],
    invites: [{ inviteId: 'i1', circleId: 'c2', circleName: 'Two', ownerPubkey: 'bob', ownerName: 'Bob' }],
    membership: [{ circleId: 'c3', circleName: 'Three', kind: 'removed', memberPubkey: 'viewer', memberName: null }],
  });

  assert.equal(
    buildInboxNotifications({
      events: source,
      preferences: { ...preferences, posts: false },
      mutedCircleIds: [],
      names,
      viewerPubkey: 'viewer',
    }).length,
    2
  );
  assert.equal(
    buildInboxNotifications({
      events: source,
      preferences: { ...preferences, invites: false },
      mutedCircleIds: [],
      names,
      viewerPubkey: 'viewer',
    }).length,
    2
  );
  assert.equal(
    buildInboxNotifications({
      events: source,
      preferences: { ...preferences, membership: false },
      mutedCircleIds: [],
      names,
      viewerPubkey: 'viewer',
    }).length,
    2
  );
});

test('invitation and membership copy use provided names and routing', () => {
  const requests = buildInboxNotifications({
    events: events({
      invites: [
        { inviteId: 'i1', circleId: 'c1', circleName: 'Studio', ownerPubkey: 'bob', ownerName: 'Bob' },
      ],
      membership: [
        { circleId: 'c1', circleName: 'Studio', kind: 'accepted', memberPubkey: 'carol', memberName: 'Carol' },
        { circleId: 'c2', circleName: 'Archive', kind: 'removed', memberPubkey: 'viewer', memberName: null },
      ],
    }),
    preferences,
    mutedCircleIds: [],
    names,
    viewerPubkey: 'viewer',
  });

  assert.deepEqual(
    requests.map((request) => [request.title, request.body, request.data.url]),
    [
      ['Invitation to Studio', 'Bob invited you.', '/circles'],
      ['Carol joined Studio', 'Your circle has a new member.', '/circles'],
      ['Removed from Archive', 'You are no longer a member.', '/circles'],
    ]
  );
});

test('notification URLs round-trip through the shared router', () => {
  const viewer = `abcdef0123${'0'.repeat(54)}`;
  const vlogId = `${viewer.slice(0, 10)}-remote-1`;

  assert.deepEqual(resolveNotificationRoute(vlogNotificationUrl(vlogId), viewer), {
    kind: 'vlog',
    vlogId,
    comments: false,
  });
  assert.deepEqual(resolveNotificationRoute(`/vlog/${vlogId}/`, viewer), {
    kind: 'vlog',
    vlogId,
    comments: false,
  });
  assert.deepEqual(resolveNotificationRoute(commentsNotificationUrl(vlogId), viewer), {
    kind: 'vlog',
    vlogId,
    comments: true,
  });
  assert.deepEqual(resolveNotificationRoute(`/vlog/${vlogId}?comments=0`, viewer), {
    kind: 'vlog',
    vlogId,
    comments: false,
  });
  assert.deepEqual(resolveNotificationRoute(updatesNotificationUrl('c 1'), viewer), {
    kind: 'updates',
    circleId: 'c 1',
  });
  assert.deepEqual(resolveNotificationRoute('/updates?circleId=c%201#top', viewer), {
    kind: 'updates',
    circleId: 'c 1',
  });
  assert.deepEqual(resolveNotificationRoute(circlesNotificationUrl(), viewer), { kind: 'circles' });
  assert.equal(resolveNotificationRoute('/vlog/other-prefix-1', viewer), null);
  assert.equal(resolveNotificationRoute('https://example.com/vlog/x', viewer), null);
  assert.equal(resolveNotificationRoute('/unknown', viewer), null);
});

test('social activity uses reply, comment, and reaction copy with comment routing', () => {
  const requests = buildInboxNotifications({
    events: events({
      social: [
        {
          vlogId: 'w1',
          circleId: 'c1',
          circleName: 'Studio',
          actorPubkey: 'alice',
          kind: 'reply',
        },
        {
          vlogId: 'w2',
          circleId: 'c1',
          circleName: 'Studio',
          actorPubkey: 'bob',
          kind: 'comment',
        },
        {
          vlogId: 'w3',
          circleId: 'c1',
          circleName: 'Studio',
          actorPubkey: 'carol',
          kind: 'reaction',
          targetType: 'comment',
          emoji: '\u2764\ufe0f',
        },
      ],
    }),
    preferences,
    mutedCircleIds: [],
    names,
    viewerPubkey: 'viewer',
  });

  assert.deepEqual(
    requests.map((request) => [request.channel, request.title, request.body, request.data.url]),
    [
      ['social', 'Alice replied to you', 'In Studio.', '/vlog/w1?comments=1'],
      ['social', 'Bob commented on your moment', 'In Studio.', '/vlog/w2?comments=1'],
      ['social', 'Carol reacted \u2764\ufe0f', 'To your comment in Studio.', '/vlog/w3?comments=1'],
    ]
  );
});

test('multiple social events on one moment are grouped', () => {
  const [request] = buildInboxNotifications({
    events: events({
      social: [
        { vlogId: 'w1', circleId: 'c1', circleName: 'Studio', actorPubkey: 'alice', kind: 'reply' },
        { vlogId: 'w1', circleId: 'c1', circleName: 'Studio', actorPubkey: 'bob', kind: 'comment' },
      ],
    }),
    preferences,
    mutedCircleIds: [],
    names,
    viewerPubkey: 'viewer',
  });

  assert.equal(request.title, '2 new responses');
  assert.equal(request.body, 'In Studio.');
  assert.equal(request.data.url, '/vlog/w1?comments=1');
});

test('full circle mute suppresses every event family', () => {
  const source = events({
    moments: [{ vlogId: 'm1', circleId: 'c1', circleName: 'Muted', authorPubkey: 'alice' }],
    invites: [{ inviteId: 'i1', circleId: 'c1', circleName: 'Muted', ownerPubkey: 'bob', ownerName: 'Bob' }],
    membership: [
      { circleId: 'c1', circleName: 'Muted', kind: 'accepted', memberPubkey: 'carol', memberName: 'Carol' },
    ],
    social: [
      { vlogId: 'w1', circleId: 'c1', circleName: 'Muted', actorPubkey: 'alice', kind: 'reply' },
    ],
  });

  const requests = buildInboxNotifications({
    events: source,
    preferences,
    mutedCircleIds: new Set(['c1']),
    names,
    viewerPubkey: 'viewer',
  });
  assert.equal(requests.length, 0);
});

test('activity preference gates only social events', () => {
  const source = events({
    invites: [{ inviteId: 'i1', circleId: 'c2', circleName: 'Two', ownerPubkey: 'bob', ownerName: 'Bob' }],
    social: [
      { vlogId: 'w1', circleId: 'c1', circleName: 'One', actorPubkey: 'alice', kind: 'reply' },
    ],
  });

  const requests = buildInboxNotifications({
    events: source,
    preferences: { ...preferences, activity: false },
    mutedCircleIds: [],
    names,
    viewerPubkey: 'viewer',
  });

  assert.equal(requests.some((request) => request.channel === 'social'), false);
  assert.equal(requests.some((request) => request.title === 'Invitation to Two'), true);
});

test('missing names and circle names fall back honestly', () => {
  const [invite] = buildInboxNotifications({
    events: events({
      invites: [{ inviteId: 'i1', circleId: 'c1', circleName: '', ownerPubkey: 'unknown', ownerName: null }],
    }),
    preferences,
    mutedCircleIds: [],
    names: {},
    viewerPubkey: 'viewer',
  });
  const [moment] = buildInboxNotifications({
    events: events({
      moments: [{ vlogId: 'm1', circleId: 'c1', circleName: null, authorPubkey: 'unknown' }],
    }),
    preferences,
    mutedCircleIds: [],
    names: {},
    viewerPubkey: 'viewer',
  });

  assert.equal(invite.title, 'Invitation to a circle');
  assert.equal(invite.body, 'Someone invited you.');
  assert.equal(moment.title, 'New moment in a circle');
  assert.equal(moment.body, 'Someone shared a moment.');
});
