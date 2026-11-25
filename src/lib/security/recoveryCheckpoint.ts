import { getSetting, setSetting } from '../database/settings';
import { shouldResumeRecoveryValue } from './recoveryCheckpointRules';

const RECOVERY_PENDING_KEY = 'onboarding.recoveryPending';

export async function beginRecoveryCheckpoint(): Promise<void> {
  await setSetting(RECOVERY_PENDING_KEY, 'pending');
}

export async function markRecoveryCheckpointIdentity(identityId: string): Promise<void> {
  // If this write fails, the earlier "pending" marker still resumes the active identity.
  await setSetting(RECOVERY_PENDING_KEY, identityId);
}

export async function completeRecoveryCheckpoint(): Promise<void> {
  await setSetting(RECOVERY_PENDING_KEY, '');
}

export async function abortRecoveryCheckpoint(): Promise<void> {
  await setSetting(RECOVERY_PENDING_KEY, '');
}

export async function shouldResumeRecovery(identityId: string): Promise<boolean> {
  return shouldResumeRecoveryValue(await getSetting(RECOVERY_PENDING_KEY), identityId);
}

export async function clearRecoveryCheckpointForIdentity(identityId: string): Promise<void> {
  const value = await getSetting(RECOVERY_PENDING_KEY);
  if (shouldResumeRecoveryValue(value, identityId)) await completeRecoveryCheckpoint();
}
