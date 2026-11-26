import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activityCopy } from '../src/lib/inbox/format';
import type { Activity, ActivityKind } from '../src/types/models';
import { toMillis } from '../src/utils/time';

function activity(kind: ActivityKind, overrides: Partial<Activity> = {}): Activity {
  return {
    id: `${kind}:1`,
    viewerPubkey: 'viewer',
    kind,
    actorPubkey: 'actor',
    circleId: 'circle-1',
    circleName: 'Studio',
    remoteVlogId: 'vlog-1',
    localVlogId: 'viewer-vlog-1',
    vlogTitle: 'Dinner',
    createdAt: 1_700_000_000_000,
    receivedAt: 1_700_000_000_000,
    readAt: null,
    ...overrides,
  };
}

test('activity copy describes replies, comments, and reactions', () => {
  assert.deepEqual(activityCopy(activity('reply'), { actorName: 'Alice' }), {
    title: 'Alice replied to you',
    subtitle: 'Dinner · Studio',
  });
  assert.deepEqual(activityCopy(activity('comment'), { actorName: 'Bob' }), {
    title: 'Bob commented on your moment',
    subtitle: 'Dinner · Studio',
  });
  assert.deepEqual(
    activityCopy(activity('reaction', { emoji: '\u2764\ufe0f', targetType: 'comment' }), {
      actorName: 'Carol',
    }),
    {
      title: 'Carol reacted \u2764\ufe0f',
      subtitle: 'your comment · Dinner · Studio',
    }
  );
  assert.deepEqual(
    activityCopy(activity('reaction', { emoji: '\ud83d\udd25', targetType: 'vlog' }), {
      actorName: 'Carol',
    }),
    {
      title: 'Carol reacted \ud83d\udd25',
      subtitle: 'your moment · Dinner · Studio',
    }
  );
});

test('activity copy describes invitations and membership changes', () => {
  assert.deepEqual(activityCopy(activity('invite'), { actorName: 'Alice' }), {
    title: 'Alice invited you to Studio',
    subtitle: 'Invitation',
  });
  assert.deepEqual(activityCopy(activity('member-joined'), { actorName: 'Bob' }), {
    title: 'Bob joined Studio',
    subtitle: 'Membership',
  });
  assert.deepEqual(activityCopy(activity('member-removed'), { actorName: 'Owner' }), {
    title: 'You were removed from Studio',
    subtitle: 'Membership',
  });
});

test('activity copy falls back when names and titles are missing', () => {
  const copy = activityCopy(activity('comment', { circleName: null, vlogTitle: null }), {
    actorName: '',
  });
  assert.deepEqual(copy, {
    title: 'Someone commented on your moment',
    subtitle: 'a moment · a circle',
  });
});

test('timestamps normalize seconds and milliseconds', () => {
  assert.equal(toMillis(1_700_000_000), 1_700_000_000_000);
  assert.equal(toMillis(1_700_000_000_000), 1_700_000_000_000);
});
