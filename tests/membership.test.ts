import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideInviteOutcome,
  isNewerEvidence,
  type EvidenceSummary,
} from '../src/lib/nostr/membershipRules';

const join: EvidenceSummary = { action: 'join', membershipVersion: 2 };
const decline: EvidenceSummary = { action: 'decline', membershipVersion: 2 };
const removed: EvidenceSummary = { action: 'removed', membershipVersion: 3 };

test('an active member never sees the invite prompt again', () => {
  assert.equal(
    decideInviteOutcome({ inviteVersion: 5, selfStatus: 'active', evidence: null }),
    'accept-repeat'
  );
});

test('a join receipt at the same or newer version restores silently', () => {
  assert.equal(
    decideInviteOutcome({ inviteVersion: 2, selfStatus: null, evidence: join }),
    'restore'
  );
  assert.equal(
    decideInviteOutcome({ inviteVersion: 1, selfStatus: 'removed', evidence: join }),
    'restore'
  );
});

test('a newer invite after an old join receipt prompts normally', () => {
  assert.equal(
    decideInviteOutcome({ inviteVersion: 4, selfStatus: null, evidence: join }),
    'pending'
  );
});

test('declines and removals suppress only versions they cover', () => {
  assert.equal(decideInviteOutcome({ inviteVersion: 2, selfStatus: null, evidence: decline }), 'suppress');
  assert.equal(decideInviteOutcome({ inviteVersion: 3, selfStatus: null, evidence: removed }), 'suppress');
  assert.equal(decideInviteOutcome({ inviteVersion: 4, selfStatus: null, evidence: removed }), 'pending');
});

test('no evidence means a genuine new invitation', () => {
  assert.equal(decideInviteOutcome({ inviteVersion: 1, selfStatus: null, evidence: null }), 'pending');
});

test('evidence ordering prefers version, then wall-clock time', () => {
  assert.equal(
    isNewerEvidence({ membershipVersion: 3, at: 1 }, { membershipVersion: 2, at: 999 }),
    true
  );
  assert.equal(
    isNewerEvidence({ membershipVersion: 2, at: 100 }, { membershipVersion: 2, at: 50 }),
    true
  );
  assert.equal(
    isNewerEvidence({ membershipVersion: 2, at: 50 }, { membershipVersion: 2, at: 50 }),
    false
  );
});
