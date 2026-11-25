import type { MemberStatus } from '../../types/models';
import type { MembershipAction } from './circleControl';

export interface EvidenceOrder {
  membershipVersion: number;
  at: number;
}

export interface EvidenceSummary {
  action: MembershipAction;
  membershipVersion: number;
}

export type InviteOutcome = 'accept-repeat' | 'restore' | 'suppress' | 'pending';

/** Membership changes are ordered by version first, then by wall-clock time. */
export function compareEvidence(a: EvidenceOrder, b: EvidenceOrder): number {
  if (a.membershipVersion !== b.membershipVersion) return a.membershipVersion - b.membershipVersion;
  return a.at - b.at;
}

export function isNewerEvidence(a: EvidenceOrder, b: EvidenceOrder): boolean {
  return compareEvidence(a, b) > 0;
}

/**
 * Decides what a received invitation should do locally:
 * - an active member never sees the prompt again;
 * - a join receipt at the same or newer version restores silently;
 * - a decline/removal at the same or newer version stays suppressed;
 * - anything else is a genuine new invitation.
 */
export function decideInviteOutcome(input: {
  inviteVersion: number;
  selfStatus: MemberStatus | null;
  evidence: EvidenceSummary | null;
}): InviteOutcome {
  if (input.selfStatus === 'active') return 'accept-repeat';
  if (input.evidence && input.evidence.membershipVersion >= input.inviteVersion) {
    return input.evidence.action === 'join' ? 'restore' : 'suppress';
  }
  return 'pending';
}
