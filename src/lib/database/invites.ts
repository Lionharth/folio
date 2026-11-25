import { getDatabase } from './db';

export type InviteStatus = 'pending' | 'accepted' | 'declined';

export interface CircleInvite {
  id: string;
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

export function inviteId(ownerPubkey: string, circleId: string, membershipVersion: number): string {
  return `${ownerPubkey.slice(0, 10)}-${circleId}-v${membershipVersion}`;
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
  const id = inviteId(input.ownerPubkey, input.circleId, input.membershipVersion);
  const existing = await getInvite(id);
  await db.runAsync(
    `INSERT INTO circle_invites (id, circle_id, owner_pubkey, owner_name, name, description, members, member_names, membership_version, invited_at, received_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
     ON CONFLICT(circle_id, owner_pubkey, membership_version) DO UPDATE SET
       owner_name = COALESCE(excluded.owner_name, circle_invites.owner_name),
       name = excluded.name,
       description = excluded.description,
       members = excluded.members,
       member_names = COALESCE(excluded.member_names, circle_invites.member_names),
       received_at = excluded.received_at`,
    id,
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
  const invite = await getInvite(id);
  if (!invite) throw new Error('Invitation was not stored');
  return { invite, created: !existing };
}

export async function getInvite(id: string): Promise<CircleInvite | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<InviteRow>('SELECT * FROM circle_invites WHERE id = ?', id);
  return row ? mapInvite(row) : null;
}

export async function listPendingInvites(): Promise<CircleInvite[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<InviteRow>(
    "SELECT * FROM circle_invites WHERE status = 'pending' ORDER BY received_at DESC"
  );
  return rows.map(mapInvite);
}

export async function setInviteStatus(id: string, status: InviteStatus): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE circle_invites SET status = ? WHERE id = ?', status, id);
}

export async function deleteInvite(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM circle_invites WHERE id = ?', id);
}
