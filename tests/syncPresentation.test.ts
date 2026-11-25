import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { InboxRefreshResult } from '../src/services/inbox';
import { presentInboxSync } from '../src/services/syncPresentation';

function result(overrides: Partial<InboxRefreshResult> = {}): InboxRefreshResult {
  return {
    received: 0,
    added: 0,
    invites: 0,
    accepted: 0,
    restored: 0,
    suppressed: 0,
    scanned: 0,
    anyRelaySucceeded: true,
    allRelaysComplete: true,
    completedAt: 1,
    ...overrides,
  };
}

test('an unreachable inbox never reports up to date', () => {
  const presentation = presentInboxSync(result({ anyRelaySucceeded: false, allRelaysComplete: false }), 'updates');
  assert.equal(presentation.tone, 'error');
  assert.match(presentation.message, /Couldn't refresh/);
  assert.doesNotMatch(presentation.message, /up to date/);
});

test('complete empty sync reports a calm caught-up state', () => {
  assert.equal(presentInboxSync(result(), 'updates').message, "You're up to date");
});

test('partial sync remains visibly incomplete even with no additions', () => {
  const presentation = presentInboxSync(result({ allRelaysComplete: false }), 'updates');
  assert.equal(presentation.tone, 'warning');
  assert.match(presentation.message, /Partly refreshed/);
});

test('new moments use singular and plural copy', () => {
  assert.match(presentInboxSync(result({ added: 1 }), 'updates').message, /1 new moment$/);
  assert.match(presentInboxSync(result({ added: 2 }), 'updates').message, /2 new moments$/);
});

test('circle sync prioritizes restored memberships and invitations', () => {
  assert.match(presentInboxSync(result({ restored: 1 }), 'circles').message, /1 circle restored/);
  assert.match(presentInboxSync(result({ invites: 2 }), 'circles').message, /2 invitations/);
});
