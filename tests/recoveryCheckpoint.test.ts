import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldResumeRecoveryValue } from '../src/lib/security/recoveryCheckpointRules';

test('a crash-safe pending marker resumes the active identity', () => {
  assert.equal(shouldResumeRecoveryValue('pending', 'identity-a'), true);
});

test('an identity-specific marker resumes only that identity', () => {
  assert.equal(shouldResumeRecoveryValue('identity-a', 'identity-a'), true);
  assert.equal(shouldResumeRecoveryValue('identity-a', 'identity-b'), false);
});

test('missing, empty, and unrelated markers do not force recovery onboarding', () => {
  assert.equal(shouldResumeRecoveryValue(null, 'identity-a'), false);
  assert.equal(shouldResumeRecoveryValue('', 'identity-a'), false);
  assert.equal(shouldResumeRecoveryValue('identity-b', 'identity-a'), false);
});
