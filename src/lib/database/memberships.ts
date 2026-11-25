import type { CircleMembershipPayload, MembershipAction } from '../nostr/circleControl';
import { isNewerEvidence } from '../nostr/membershipRules';
import { getDatabase } from './db';

export interface MembershipEvidence {
  recipientPubkey: string;
  circleId: string;
  ownerPubkey: string;
  membershipVersion: number;
  action: MembershipAction;
  at: number;
  payload: CircleMembershipPayload;
  publishedAt: number | null;
  createdAt: number;
}

interface MembershipRow {
  recipient_pubkey: string;
  circle_id: string;
  owner_pubkey: string;
  membership_version: number;
  action: string;
  at: number;
  payload: string;
  published_at: number | null;
  created_at: number;
}

function mapEvidence(row: MembershipRow): MembershipEvidence {
  return {
    recipientPubkey: row.recipient_pubkey,
    circleId: row.circle_id,
    ownerPubkey: row.owner_pubkey,
    membershipVersion: row.membership_version,
    action: row.action as MembershipAction,
    at: row.at,
    payload: JSON.parse(row.payload) as CircleMembershipPayload,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

export async function getMembershipEvidence(
  recipientPubkey: string,
  circleId: string,
  ownerPubkey: string
): Promise<MembershipEvidence | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<MembershipRow>(
    'SELECT * FROM circle_memberships WHERE recipient_pubkey = ? AND circle_id = ? AND owner_pubkey = ?',
    recipientPubkey,
    circleId,
    ownerPubkey
  );
  return row ? mapEvidence(row) : null;
}

export async function listMembershipEvidence(recipientPubkey: string): Promise<MembershipEvidence[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<MembershipRow>(
    'SELECT * FROM circle_memberships WHERE recipient_pubkey = ?',
    recipientPubkey
  );
  return rows.map(mapEvidence);
}

/**
 * Stores the newest evidence for a circle. Older receipts never overwrite a
 * newer join/decline/removal.
 */
export async function upsertMembershipEvidence(input: {
  recipientPubkey: string;
  payload: CircleMembershipPayload;
}): Promise<{ stored: boolean; evidence: MembershipEvidence }> {
  const { payload, recipientPubkey } = input;
  if (payload.memberPubkey !== recipientPubkey) {
    throw new Error('Membership evidence belongs to another identity');
  }
  const db = await getDatabase();
  const existing = await getMembershipEvidence(recipientPubkey, payload.circleId, payload.ownerPubkey);
  if (
    existing &&
    !isNewerEvidence(
      { membershipVersion: payload.membershipVersion, at: payload.at },
      { membershipVersion: existing.membershipVersion, at: existing.at }
    )
  ) {
    return { stored: false, evidence: existing };
  }
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO circle_memberships
       (recipient_pubkey, circle_id, owner_pubkey, membership_version, action, at, payload, published_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(recipient_pubkey, circle_id, owner_pubkey) DO UPDATE SET
       membership_version = excluded.membership_version,
       action = excluded.action,
       at = excluded.at,
       payload = excluded.payload,
       published_at = NULL`,
    recipientPubkey,
    payload.circleId,
    payload.ownerPubkey,
    payload.membershipVersion,
    payload.action,
    payload.at,
    JSON.stringify(payload),
    now
  );
  const evidence = await getMembershipEvidence(recipientPubkey, payload.circleId, payload.ownerPubkey);
  if (!evidence) throw new Error('Membership evidence was not stored');
  return { stored: true, evidence };
}

export async function listReceiptsToPublish(
  recipientPubkey: string,
  staleBefore: number
): Promise<MembershipEvidence[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<MembershipRow>(
    `SELECT * FROM circle_memberships
     WHERE recipient_pubkey = ? AND (published_at IS NULL OR published_at < ?)
     ORDER BY created_at ASC`,
    recipientPubkey,
    staleBefore
  );
  return rows.map(mapEvidence);
}

export async function markReceiptPublished(input: {
  recipientPubkey: string;
  circleId: string;
  ownerPubkey: string;
  membershipVersion: number;
  publishedAt: number;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE circle_memberships SET published_at = ?
     WHERE recipient_pubkey = ? AND circle_id = ? AND owner_pubkey = ? AND membership_version = ?`,
    input.publishedAt,
    input.recipientPubkey,
    input.circleId,
    input.ownerPubkey,
    input.membershipVersion
  );
}
