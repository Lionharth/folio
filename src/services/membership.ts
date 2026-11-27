import { getPublicKey } from 'nostr-tools/pure';

import { listContactNames } from '../lib/database/contacts';
import { setInvitesStatusThroughVersion } from '../lib/database/invites';
import {
  listMembershipEvidence,
  listReceiptsToPublish,
  markReceiptPublished,
  upsertMembershipEvidence,
  type MembershipEvidence,
} from '../lib/database/memberships';
import { listPendingControls, markControlSent } from '../lib/database/outbox';
import {
  addCircleFromInvite,
  getCircle,
  getCircleMember,
  listCircleMembers,
  listCirclesForViewer,
  markCircleMemberRemoved,
} from '../lib/database/vlogs';
import {
  wrapControl,
  type CircleAcceptPayload,
  type CircleControlPayload,
  type CircleInvitePayload,
  type CircleMembershipPayload,
} from '../lib/nostr/circleControl';
import { resolveInboxRelays } from '../lib/nostr/dm';
import { createPool, DEFAULT_DM_RELAYS, publishToRelays, type Pool } from '../lib/nostr/relays';
import { isParticipatingStatus } from '../lib/social/rules';
import type { Circle, CircleMember } from '../types/models';

const RECEIPT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

function evidenceKey(circleId: string, ownerPubkey: string): string {
  return `${circleId}:${ownerPubkey}`;
}

async function withOptionalPool<T>(
  secretKey: Uint8Array,
  pool: Pool | undefined,
  work: (pool: Pool) => Promise<T>
): Promise<T> {
  if (pool) return work(pool);
  const own = createPool({ secretKey });
  try {
    return await work(own);
  } finally {
    own.destroy();
  }
}

async function publishControl(
  pool: Pool,
  secretKey: Uint8Array,
  recipientPubkey: string,
  payload: CircleControlPayload
): Promise<string[]> {
  const relays = await resolveInboxRelays(pool, recipientPubkey, DEFAULT_DM_RELAYS);
  const { wrap } = wrapControl(payload, secretKey, recipientPubkey);
  const report = await publishToRelays(pool, relays, wrap);
  return report.accepted;
}

export function snapshotFromInvite(
  invite: CircleInvitePayload['circle'] | undefined
): CircleInvitePayload['circle'] | null {
  if (!invite) return null;
  return {
    id: invite.id,
    name: invite.name,
    description: invite.description,
    ownerPubkey: invite.ownerPubkey,
    ownerName: invite.ownerName,
    membershipVersion: invite.membershipVersion,
    members: [...invite.members],
    names: invite.names ? { ...invite.names } : undefined,
  };
}

export async function buildCircleSnapshot(
  circle: Circle,
  members: CircleMember[],
  options: {
    excludePubkey?: string;
    membershipVersion?: number;
    ownerName?: string;
    names?: Record<string, string>;
  } = {}
): Promise<CircleInvitePayload['circle']> {
  const knownNames = options.names ?? (await listContactNames());
  const roster = [
    ...new Set([
      circle.ownerPubkey,
      ...members
        .filter((member) => member.status !== 'removed' && member.pubkey !== options.excludePubkey)
        .map((member) => member.pubkey),
    ]),
  ];
  const names: Record<string, string> = {};
  for (const pubkey of roster) {
    const name = knownNames[pubkey];
    if (name) names[pubkey] = name;
  }
  return {
    id: circle.id,
    name: circle.name,
    description: circle.description ?? undefined,
    ownerPubkey: circle.ownerPubkey,
    ownerName: options.ownerName ?? knownNames[circle.ownerPubkey],
    membershipVersion: options.membershipVersion ?? circle.membershipVersion,
    members: roster,
    names: Object.keys(names).length > 0 ? names : undefined,
  };
}

export async function sendCircleAccept(input: {
  pool: Pool;
  secretKey: Uint8Array;
  ownerPubkey: string;
  circleId: string;
  memberName?: string;
}): Promise<string[]> {
  const payload: CircleAcceptPayload = {
    v: 1,
    type: 'circle-accept',
    circleId: input.circleId,
    memberPubkey: getPublicKey(input.secretKey),
    memberName: input.memberName?.trim() || undefined,
    at: Math.floor(Date.now() / 1000),
  };
  return publishControl(input.pool, input.secretKey, input.ownerPubkey, payload);
}

/**
 * Stores durable membership evidence and tries to publish it to the identity's
 * own inbox. Relay failures leave `published_at` NULL so the next sync retries.
 */
export async function recordMembershipReceipt(input: {
  secretKey: Uint8Array;
  payload: CircleMembershipPayload;
  pool?: Pool;
}): Promise<{ evidence: MembershipEvidence; published: boolean }> {
  const recipientPubkey = getPublicKey(input.secretKey);
  const { stored, evidence } = await upsertMembershipEvidence({
    recipientPubkey,
    payload: input.payload,
  });
  const stale =
    !evidence.publishedAt || Date.now() - evidence.publishedAt > RECEIPT_REFRESH_MS;
  if (!stored && !stale) return { evidence, published: false };

  // Republish the newest stored evidence, not a stale payload that lost the
  // version/at comparison.
  const toPublish = stored ? input.payload : evidence.payload;
  try {
    const accepted = await withOptionalPool(input.secretKey, input.pool, (pool) =>
      publishControl(pool, input.secretKey, recipientPubkey, toPublish)
    );
    if (accepted.length > 0) {
      const publishedAt = Date.now();
      await markReceiptPublished({
        recipientPubkey,
        circleId: toPublish.circleId,
        ownerPubkey: toPublish.ownerPubkey,
        membershipVersion: toPublish.membershipVersion,
        publishedAt,
      });
      return { evidence: { ...evidence, publishedAt }, published: true };
    }
  } catch {
    // Offline: the receipt stays queued for the next inbox sync.
  }
  return { evidence, published: false };
}

/** Re-publishes receipts that were never delivered or are older than a week. */
export async function flushMembershipReceipts(
  secretKey: Uint8Array,
  pool?: Pool,
  timeBudgetMs = 8_000
): Promise<number> {
  const recipientPubkey = getPublicKey(secretKey);
  const staleBefore = Date.now() - RECEIPT_REFRESH_MS;
  const rows = await listReceiptsToPublish(recipientPubkey, staleBefore);
  if (rows.length === 0) return 0;
  return withOptionalPool(secretKey, pool, async (activePool) => {
    let published = 0;
    const startedAt = Date.now();
    for (const row of rows) {
      if (Date.now() - startedAt > timeBudgetMs) break;
      try {
        const accepted = await publishControl(activePool, secretKey, recipientPubkey, row.payload);
        if (accepted.length > 0) {
          await markReceiptPublished({
            recipientPubkey,
            circleId: row.circleId,
            ownerPubkey: row.ownerPubkey,
            membershipVersion: row.membershipVersion,
            publishedAt: Date.now(),
          });
          published += 1;
        }
      } catch {
        // Retried on the next sync.
      }
    }
    return published;
  });
}

const controlFlushes = new Map<string, Promise<number>>();

/** Retries owner-to-member controls such as removal notices. */
export function flushControlOutbox(
  secretKey: Uint8Array,
  pool?: Pool,
  timeBudgetMs = 8_000
): Promise<number> {
  const senderPubkey = getPublicKey(secretKey);
  const existing = controlFlushes.get(senderPubkey);
  if (existing) return existing;
  const run = runControlFlush(secretKey, senderPubkey, pool, timeBudgetMs).finally(() => {
    controlFlushes.delete(senderPubkey);
  });
  controlFlushes.set(senderPubkey, run);
  return run;
}

async function runControlFlush(
  secretKey: Uint8Array,
  senderPubkey: string,
  pool: Pool | undefined,
  timeBudgetMs: number
): Promise<number> {
  const pending = await listPendingControls(senderPubkey);
  if (pending.length === 0) return 0;
  return withOptionalPool(secretKey, pool, async (activePool) => {
    let sent = 0;
    const startedAt = Date.now();
    for (const control of pending) {
      if (Date.now() - startedAt > timeBudgetMs) break;
      try {
        if (control.payload.type === 'circle-comment' || control.payload.type === 'circle-reaction') {
          const senderMember = await getCircleMember(control.payload.circleId, senderPubkey);
          if (!isParticipatingStatus(senderMember?.status)) {
            await markControlSent(control.id);
            sent += 1;
            continue;
          }
          if (control.recipientPubkey !== senderPubkey) {
            const member = await getCircleMember(control.payload.circleId, control.recipientPubkey);
            if (!isParticipatingStatus(member?.status)) {
              await markControlSent(control.id);
              sent += 1;
              continue;
            }
          }
        }
        if (control.payload.type === 'push-token' || control.payload.type === 'push-token-request') {
          // A removed or still-invited member must not receive a device token.
          const senderMember = await getCircleMember(control.payload.circleId, senderPubkey);
          if (senderMember?.status !== 'active') {
            await markControlSent(control.id);
            sent += 1;
            continue;
          }
          if (control.recipientPubkey !== senderPubkey) {
            const member = await getCircleMember(control.payload.circleId, control.recipientPubkey);
            if (member?.status !== 'active') {
              await markControlSent(control.id);
              sent += 1;
              continue;
            }
          }
        }
        const accepted = await publishControl(
          activePool,
          secretKey,
          control.recipientPubkey,
          control.payload
        );
        if (accepted.length > 0) {
          await markControlSent(control.id);
          sent += 1;
        }
      } catch {
        // Retried on the next sync.
      }
    }
    return sent;
  });
}

export async function publishMembershipControl(
  secretKey: Uint8Array,
  recipientPubkey: string,
  payload: CircleControlPayload,
  pool?: Pool
): Promise<string[]> {
  return withOptionalPool(secretKey, pool, (activePool) =>
    publishControl(activePool, secretKey, recipientPubkey, payload)
  );
}

export interface RestoreResult {
  created: boolean;
  circleName: string;
}

/** Rebuilds a circle from a self-authored join receipt. */
export async function restoreCircleFromReceipt(input: {
  payload: CircleMembershipPayload;
  selfPubkey: string;
  secretKey?: Uint8Array;
  pool?: Pool;
  memberName?: string;
}): Promise<RestoreResult | null> {
  const { payload, selfPubkey } = input;
  if (payload.action !== 'join') return null;
  const snapshot = snapshotFromInvite(payload.circle);
  if (!snapshot) return null;

  const existingMember = await getCircleMember(payload.circleId, selfPubkey);
  const wasActive = existingMember?.status === 'active';
  const existingCircle = await getCircle(snapshot.id);
  let applied = false;
  if (!existingCircle || existingCircle.membershipVersion <= snapshot.membershipVersion) {
    await addCircleFromInvite({
      id: snapshot.id,
      ownerPubkey: snapshot.ownerPubkey,
      name: snapshot.name,
      description: snapshot.description ?? null,
      membershipVersion: snapshot.membershipVersion,
      members: snapshot.members,
      selfPubkey,
    });
    applied = true;
  }
  await setInvitesStatusThroughVersion({
    recipientPubkey: selfPubkey,
    circleId: snapshot.id,
    ownerPubkey: snapshot.ownerPubkey,
    membershipVersion: snapshot.membershipVersion,
    status: 'accepted',
  });

  const secretKey = input.secretKey;
  if (!wasActive && secretKey && snapshot.ownerPubkey !== selfPubkey) {
    try {
      await withOptionalPool(secretKey, input.pool, (pool) =>
        sendCircleAccept({
          pool,
          secretKey,
          ownerPubkey: snapshot.ownerPubkey,
          circleId: snapshot.id,
          memberName: input.memberName,
        })
      );
    } catch {
      // The owner already authorized this member; acceptance is best-effort.
    }
  }

  return { created: applied && !wasActive, circleName: snapshot.name };
}

/** Applies a decline/removal receipt so the circle stays gone across restores. */
export async function suppressCircleFromReceipt(input: {
  payload: CircleMembershipPayload;
  selfPubkey: string;
}): Promise<boolean> {
  const { payload, selfPubkey } = input;
  if (payload.action === 'join') return false;
  await setInvitesStatusThroughVersion({
    recipientPubkey: selfPubkey,
    circleId: payload.circleId,
    ownerPubkey: payload.ownerPubkey,
    membershipVersion: payload.membershipVersion,
    status: 'declined',
  });
  const circle = await getCircle(payload.circleId);
  if (circle && circle.ownerPubkey === payload.ownerPubkey) {
    await markCircleMemberRemoved(payload.circleId, selfPubkey);
  }
  return true;
}

/**
 * Backfills join receipts for circles accepted before durable receipts existed.
 * Runs on sync so memberships accepted by older builds become restorable.
 */
export async function seedMembershipReceipts(
  secretKey: Uint8Array,
  pool?: Pool
): Promise<number> {
  const selfPubkey = getPublicKey(secretKey);
  const circles = await listCirclesForViewer(selfPubkey);
  if (circles.length === 0) return 0;
  const known = new Set(
    (await listMembershipEvidence(selfPubkey)).map((row) => evidenceKey(row.circleId, row.ownerPubkey))
  );
  const missing = circles.filter((circle) => !known.has(evidenceKey(circle.id, circle.ownerPubkey)));
  if (missing.length === 0) return 0;

  const names = await listContactNames();
  let seeded = 0;
  for (const circle of missing) {
    const members = await listCircleMembers(circle.id);
    const snapshot = await buildCircleSnapshot(circle, members, { names });
    const payload: CircleMembershipPayload = {
      v: 1,
      type: 'circle-membership',
      action: 'join',
      circleId: circle.id,
      ownerPubkey: circle.ownerPubkey,
      memberPubkey: selfPubkey,
      membershipVersion: circle.membershipVersion,
      at: Math.floor(Date.now() / 1000),
      circle: snapshot,
    };
    const result = await recordMembershipReceipt({ secretKey, payload, pool });
    if (result.evidence) seeded += 1;
  }
  return seeded;
}
