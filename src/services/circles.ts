import { getPublicKey } from 'nostr-tools/pure';

import { getInvite, setInviteStatus, type CircleInvite } from '../lib/database/invites';
import { listContactNames } from '../lib/database/contacts';
import { enqueueControls, markControlSent } from '../lib/database/outbox';
import {
  addCircleFromInvite,
  addCircleMember,
  getCircle,
  listCircleMembers,
  removeCircleMember,
} from '../lib/database/vlogs';
import {
  wrapControl,
  type CircleControlPayload,
  type CircleMembershipPayload,
} from '../lib/nostr/circleControl';
import { DEFAULT_DM_RELAYS, createPool, publishToRelays, type Pool } from '../lib/nostr/relays';
import { resolveInboxRelays } from '../lib/nostr/dm';
import { isParticipatingStatus } from '../lib/social/rules';
import {
  buildCircleSnapshot,
  publishMembershipControl,
  recordMembershipReceipt,
} from './membership';

export class InviteDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteDeliveryError';
  }
}

async function withPool<T>(secretKey: Uint8Array, work: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = createPool({ secretKey });
  try {
    return await work(pool);
  } finally {
    pool.destroy();
  }
}

async function deliverControl(
  pool: Pool,
  secretKey: Uint8Array,
  recipientPubkey: string,
  payload: CircleControlPayload
): Promise<{ rumorId: string; relays: string[] }> {
  const relays = await resolveInboxRelays(pool, recipientPubkey, DEFAULT_DM_RELAYS);
  const { wrap, rumorId } = wrapControl(payload, secretKey, recipientPubkey);
  const report = await publishToRelays(pool, relays, wrap);
  return { rumorId, relays: report.accepted };
}

/**
 * Sends a private circle invitation, then records the member as `invited`.
 * The invitation is published first: if no relay accepts it, local membership is
 * left unchanged so the UI never claims someone was invited when they were not.
 */
export async function inviteMember(input: {
  secretKey: Uint8Array;
  circleId: string;
  memberPubkey: string;
  ownerName?: string;
}): Promise<{ rumorId: string; relays: string[] }> {
  const circle = await getCircle(input.circleId);
  if (!circle) throw new InviteDeliveryError('This circle no longer exists');
  const senderPubkey = getPublicKey(input.secretKey);
  if (circle.ownerPubkey !== senderPubkey) {
    throw new InviteDeliveryError('Only the circle owner can invite people');
  }

  const members = await listCircleMembers(circle.id);
  const existing = members.find((member) => member.pubkey === input.memberPubkey);
  if (existing && existing.status === 'active') {
    throw new InviteDeliveryError('That person is already in this circle');
  }

  const roster = [
    ...new Set([
      circle.ownerPubkey,
      ...members.filter((member) => member.status !== 'removed').map((member) => member.pubkey),
      input.memberPubkey,
    ]),
  ];

  const knownNames = await listContactNames();
  const names: Record<string, string> = {};
  for (const pubkey of roster) {
    const name = pubkey === circle.ownerPubkey ? input.ownerName?.trim() || knownNames[pubkey] : knownNames[pubkey];
    if (name) names[pubkey] = name;
  }

  const payload: CircleControlPayload = {
    v: 1,
    type: 'circle-invite',
    circle: {
      id: circle.id,
      name: circle.name,
      description: circle.description ?? undefined,
      ownerPubkey: circle.ownerPubkey,
      ownerName: input.ownerName?.trim() || knownNames[circle.ownerPubkey],
      membershipVersion: circle.membershipVersion + 1,
      members: roster,
      names: Object.keys(names).length > 0 ? names : undefined,
    },
    invitedAt: Math.floor(Date.now() / 1000),
  };

  const delivered = await withPool(input.secretKey, (pool) =>
    deliverControl(pool, input.secretKey, input.memberPubkey, payload)
  );
  await addCircleMember(circle.id, input.memberPubkey, 'invited');
  return delivered;
}

/** Re-sends the invitation for a member who is still `invited`. */
export async function resendInvite(input: {
  secretKey: Uint8Array;
  circleId: string;
  memberPubkey: string;
  ownerName?: string;
}): Promise<{ rumorId: string; relays: string[] }> {
  const circle = await getCircle(input.circleId);
  if (!circle) throw new InviteDeliveryError('This circle no longer exists');
  if (circle.ownerPubkey !== getPublicKey(input.secretKey)) {
    throw new InviteDeliveryError('Only the circle owner can invite people');
  }
  const members = await listCircleMembers(circle.id);
  const roster = [
    ...new Set([
      circle.ownerPubkey,
      ...members.filter((member) => member.status !== 'removed').map((member) => member.pubkey),
      input.memberPubkey,
    ]),
  ];
  const knownNames = await listContactNames();
  const names: Record<string, string> = {};
  for (const pubkey of roster) {
    const name = pubkey === circle.ownerPubkey ? input.ownerName?.trim() || knownNames[pubkey] : knownNames[pubkey];
    if (name) names[pubkey] = name;
  }
  const payload: CircleControlPayload = {
    v: 1,
    type: 'circle-invite',
    circle: {
      id: circle.id,
      name: circle.name,
      description: circle.description ?? undefined,
      ownerPubkey: circle.ownerPubkey,
      ownerName: input.ownerName?.trim() || knownNames[circle.ownerPubkey],
      membershipVersion: circle.membershipVersion,
      members: roster,
      names: Object.keys(names).length > 0 ? names : undefined,
    },
    invitedAt: Math.floor(Date.now() / 1000),
  };
  return withPool(input.secretKey, (pool) =>
    deliverControl(pool, input.secretKey, input.memberPubkey, payload)
  );
}

export interface AcceptInviteResult {
  circleName: string;
  ownerNotified: boolean;
}

function snapshotFromInvite(invite: CircleInvite): CircleMembershipPayload['circle'] {
  return {
    id: invite.circleId,
    name: invite.name,
    description: invite.description ?? undefined,
    ownerPubkey: invite.ownerPubkey,
    ownerName: invite.ownerName ?? undefined,
    membershipVersion: invite.membershipVersion,
    members: invite.members,
    names: Object.keys(invite.memberNames).length > 0 ? invite.memberNames : undefined,
  };
}

/**
 * Joins the circle locally and notifies the owner. Notification is best-effort:
 * the owner already invited this member, and future posts are delivered to
 * invited members too, so a lost acceptance cannot lock the member out.
 */
export async function acceptInvite(input: {
  secretKey: Uint8Array;
  inviteId: string;
  memberName?: string;
}): Promise<AcceptInviteResult> {
  const selfPubkey = getPublicKey(input.secretKey);
  const invite = await getInvite(selfPubkey, input.inviteId);
  if (!invite) throw new Error('This invitation is no longer available');
  if (invite.status !== 'pending') throw new Error('This invitation was already handled');

  await addCircleFromInvite({
    id: invite.circleId,
    ownerPubkey: invite.ownerPubkey,
    name: invite.name,
    description: invite.description,
    membershipVersion: invite.membershipVersion,
    members: invite.members,
    selfPubkey,
  });
  await setInviteStatus(selfPubkey, invite.id, 'accepted');

  const receipt: CircleMembershipPayload = {
    v: 1,
    type: 'circle-membership',
    action: 'join',
    circleId: invite.circleId,
    ownerPubkey: invite.ownerPubkey,
    memberPubkey: selfPubkey,
    membershipVersion: invite.membershipVersion,
    at: Math.floor(Date.now() / 1000),
    circle: snapshotFromInvite(invite),
  };
  // Store the restore proof before notifying the owner, so a lost acceptance
  // still lets this identity rejoin on a new device.
  await recordMembershipReceipt({ secretKey: input.secretKey, payload: receipt });

  let ownerNotified = false;
  try {
    await withPool(input.secretKey, (pool) =>
      deliverControl(pool, input.secretKey, invite.ownerPubkey, {
        v: 1,
        type: 'circle-accept',
        circleId: invite.circleId,
        memberPubkey: selfPubkey,
        memberName: input.memberName?.trim() || undefined,
        at: Math.floor(Date.now() / 1000),
      })
    );
    ownerNotified = true;
  } catch {
    ownerNotified = false;
  }

  return { circleName: invite.name, ownerNotified };
}

export async function declineInvite(input: {
  secretKey: Uint8Array;
  inviteId: string;
}): Promise<void> {
  const selfPubkey = getPublicKey(input.secretKey);
  const invite = await getInvite(selfPubkey, input.inviteId);
  if (!invite) throw new Error('This invitation is no longer available');
  if (invite.status !== 'pending') return;

  await setInviteStatus(selfPubkey, invite.id, 'declined');
  const receipt: CircleMembershipPayload = {
    v: 1,
    type: 'circle-membership',
    action: 'decline',
    circleId: invite.circleId,
    ownerPubkey: invite.ownerPubkey,
    memberPubkey: selfPubkey,
    membershipVersion: invite.membershipVersion,
    at: Math.floor(Date.now() / 1000),
    circle: snapshotFromInvite(invite),
  };
  await recordMembershipReceipt({ secretKey: input.secretKey, payload: receipt });
}

export interface RemoveMemberResult {
  delivered: boolean;
}

/**
 * Removes a member locally and sends the signed roster update to the removed
 * member and the remaining members. Delivery is queued in the control outbox
 * and retried on the next sync, so an offline owner still stops sending future
 * keys immediately.
 */
export async function removeMember(input: {
  secretKey: Uint8Array;
  circleId: string;
  memberPubkey: string;
}): Promise<RemoveMemberResult> {
  const circle = await getCircle(input.circleId);
  if (!circle) throw new InviteDeliveryError('This circle no longer exists');
  const senderPubkey = getPublicKey(input.secretKey);
  if (circle.ownerPubkey !== senderPubkey) {
    throw new InviteDeliveryError('Only the circle owner can remove people');
  }
  if (input.memberPubkey === circle.ownerPubkey) {
    throw new InviteDeliveryError('The owner cannot be removed from their own circle');
  }

  const members = await listCircleMembers(circle.id);
  const existing = members.find((member) => member.pubkey === input.memberPubkey);
  if (!existing) throw new InviteDeliveryError('That person is not in this circle');

  const membershipVersion = circle.membershipVersion + 1;
  const snapshot = await buildCircleSnapshot(circle, members, {
    excludePubkey: input.memberPubkey,
    membershipVersion,
  });
  const payload: CircleMembershipPayload = {
    v: 1,
    type: 'circle-membership',
    action: 'removed',
    circleId: circle.id,
    ownerPubkey: circle.ownerPubkey,
    memberPubkey: input.memberPubkey,
    membershipVersion,
    at: Math.floor(Date.now() / 1000),
    circle: snapshot,
  };

  const recipients = [
    ...new Set([
      senderPubkey,
      input.memberPubkey,
      ...members
        .filter((member) => isParticipatingStatus(member.status))
        .map((member) => member.pubkey),
    ]),
  ];
  const outboxIds = await enqueueControls(
    senderPubkey,
    recipients.map((recipientPubkey) => ({ recipientPubkey, payload }))
  );
  const outboxByRecipient = new Map(
    recipients.map((recipient, index) => [recipient, outboxIds[index]])
  );
  await removeCircleMember(circle.id, input.memberPubkey);

  const pool = createPool({ secretKey: input.secretKey });
  let results: PromiseSettledResult<boolean>[] = [];
  try {
    results = await Promise.allSettled(
      recipients.map(async (recipient) => {
        const accepted = await publishMembershipControl(
          input.secretKey,
          recipient,
          payload,
          pool
        );
        if (accepted.length > 0) {
          const outboxId = outboxByRecipient.get(recipient);
          if (outboxId) await markControlSent(outboxId);
          return recipient === input.memberPubkey;
        }
        return false;
      })
    );
  } finally {
    pool.destroy();
  }

  return {
    delivered: results.some((result) => result.status === 'fulfilled' && result.value),
  };
}
