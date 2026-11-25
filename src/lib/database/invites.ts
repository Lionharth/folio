import { getDatabase } from './db';

export type InviteStatus = 'pending' | 'accepted' | 'declined';

export interface CircleInvite {
  id: string;
  recipientPubkey: string;
  circleId: string;
  ownerPubkey: string;
  ownerName?: string | null;
  name: string;
  description?: string | null;
  members: string[];
  memberNames: Record<string, string>;
  membershipVersion: number;
  invitedAt: number;
  receivedAt: number;
  status: InviteStatus;
}

interface InviteRow {
  id: string;
  recipient_pubkey: string;
  circle_id: string;
  owner_pubkey: string;
  owner_name: string | null;
  name: string;
  description: string | null;
  members: string;
  member_names: string | null;
  membership_version: number;
  invited_at: number;
  received_at: number;
  status: string;
}

export function inviteId(
  recipientPubkey: string,
  ownerPubkey: string,
  circleId: string,
  membershipVersion: number
): string {
  return `${recipientPubkey.slice(0, 10)}-${ownerPubkey.slice(0, 10)}-${circleId}-v${membershipVersion}`;
}

function mapInvite(row: InviteRow): CircleInvite {
  let members: string[] = [];
  let memberNames: Record<string, string> = {};
  try {
    members = JSON.parse(row.members) as string[];
  } catch {
    members = [];
  }
  if (row.member_names) {
    try {
      const parsed = JSON.parse(row.member_names) as Record<string, string>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) memberNames = parsed;
    } catch {
      memberNames = {};
    }
  }
  return {
    id: row.id,
    recipientPubkey: row.recipient_pubkey,
    circleId: row.circle_id,
    ownerPubkey: row.owner_pubkey,
    ownerName: row.owner_name,
    name: row.name,
    description: row.description,
    members: Array.isArray(members) ? members : [],
    memberNames,
    membershipVersion: row.membership_version,
    invitedAt: row.invited_at,
    receivedAt: row.received_at,
    status: row.status as InviteStatus,
  };
}

export async function upsertInvite(input: {
  recipientPubkey: string;
  circleId: string;
  ownerPubkey: string;
  ownerName?: string | null;
  name: string;
  description?: string | null;
  members: string[];
  memberNames?: Record<string, string>;
  membershipVersion: number;
  invitedAt: number;
}): Promise<{ invite: CircleInvite; created: boolean }> {
  const db = await getDatabase();
  const id = inviteId(input.recipientPubkey, input.ownerPubkey, input.circleId, input.membershipVersion);
  const existing = await getInvite(input.recipientPubkey, id);
  await db.runAsync(
    `INSERT INTO circle_invites (id, recipient_pubkey, circle_id, owner_pubkey, owner_name, name, description, members, member_names, membership_version, invited_at, received_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
     ON CONFLICT(recipient_pubkey, circle_id, owner_pubkey, membership_version) DO UPDATE SET
       owner_name = COALESCE(excluded.owner_name, circle_invites.owner_name),
       name = excluded.name,
       description = excluded.description,
       members = excluded.members,
       member_names = COALESCE(excluded.member_names, circle_invites.member_names),
       received_at = excluded.received_at`,
    id,
    input.recipientPubkey,
    input.circleId,
    input.ownerPubkey,
    input.ownerName ?? null,
    input.name,
    input.description ?? null,
    JSON.stringify(input.members),
    input.memberNames && Object.keys(input.memberNames).length > 0 ? JSON.stringify(input.memberNames) : null,
    input.membershipVersion,
    input.invitedAt,
    Date.now()
  );
  const invite = await getInvite(input.recipientPubkey, id);
  if (!invite) throw new Error('Invitation was not stored');
  return { invite, created: !existing };
}

export async function getInvite(recipientPubkey: string, id: string): Promise<CircleInvite | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<InviteRow>(
    'SELECT * FROM circle_invites WHERE recipient_pubkey = ? AND id = ?',
    recipientPubkey,
    id
  );
  return row ? mapInvite(row) : null;
}

export async function listPendingInvites(recipientPubkey: string): Promise<CircleInvite[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<InviteRow>(
    "SELECT * FROM circle_invites WHERE recipient_pubkey = ? AND status = 'pending' ORDER BY received_at DESC",
    recipientPubkey
  );
  return rows.map(mapInvite);
}

export async function setInviteStatus(
  recipientPubkey: string,
  id: string,
  status: InviteStatus
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE circle_invites SET status = ? WHERE recipient_pubkey = ? AND id = ?',
    status,
    recipientPubkey,
    id
  );
}

/** Applies a membership outcome to every invitation up to a membership version. */
export async function setInvitesStatusThroughVersion(input: {
  recipientPubkey: string;
  circleId: string;
  ownerPubkey: string;
  membershipVersion: number;
  status: InviteStatus;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE circle_invites SET status = ?
     WHERE recipient_pubkey = ? AND circle_id = ? AND owner_pubkey = ? AND membership_version <= ?`,
    input.status,
    input.recipientPubkey,
    input.circleId,
    input.ownerPubkey,
    input.membershipVersion
  );
}

export async function deleteInvite(recipientPubkey: string, id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM circle_invites WHERE recipient_pubkey = ? AND id = ?', recipientPubkey, id);
}
