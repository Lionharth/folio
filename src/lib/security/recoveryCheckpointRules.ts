export function shouldResumeRecoveryValue(value: string | null, identityId: string): boolean {
  return value === 'pending' || value === identityId;
}
