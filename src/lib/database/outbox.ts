import { randomUUID } from 'expo-crypto';

import { createSerialQueue } from '../async/serialQueue';
import type { CircleControlPayload } from '../nostr/circleControl';
import { getDatabase } from './db';

const enqueueQueue = createSerialQueue();

export interface PendingControl {
  id: string;
  senderPubkey: string;
  recipientPubkey: string;
  payload: CircleControlPayload;
  createdAt: number;
}

interface OutboxRow {
  id: string;
  sender_pubkey: string;
  recipient_pubkey: string;
  payload: string;
  created_at: number;
  sent_at: number | null;
}

function mapControl(row: OutboxRow): PendingControl {
  return {
    id: row.id,
    senderPubkey: row.sender_pubkey,
    recipientPubkey: row.recipient_pubkey,
    payload: JSON.parse(row.payload) as CircleControlPayload,
    createdAt: row.created_at,
  };
}

export async function enqueueControl(input: {
  senderPubkey: string;
  recipientPubkey: string;
  payload: CircleControlPayload;
}): Promise<string> {
  const [id] = await enqueueControls(input.senderPubkey, [
    { recipientPubkey: input.recipientPubkey, payload: input.payload },
  ]);
  return id;
}

export async function enqueueControls(
  senderPubkey: string,
  recipients: { recipientPubkey: string; payload: CircleControlPayload }[],
  options: { transaction?: boolean } = {}
): Promise<string[]> {
  if (recipients.length === 0) return [];
  const db = await getDatabase();
  const ids = recipients.map(() => randomUUID());
  const now = Date.now();
  const insert = async (runAsync: (typeof db)['runAsync']) => {
    for (let index = 0; index < recipients.length; index += 1) {
      const recipient = recipients[index];
      await runAsync(
        'INSERT INTO control_outbox (id, sender_pubkey, recipient_pubkey, payload, created_at, sent_at) VALUES (?, ?, ?, ?, ?, NULL)',
        ids[index],
        senderPubkey,
        recipient.recipientPubkey,
        JSON.stringify(recipient.payload),
        now
      );
    }
  };
  if (options.transaction === false) {
    await insert(db.runAsync.bind(db));
  } else {
    await enqueueQueue.run(() =>
      db.withExclusiveTransactionAsync(async (transaction) => {
        await insert(transaction.runAsync.bind(transaction));
      })
    );
  }
  return ids;
}

export async function listPendingControls(senderPubkey: string, limit = 100): Promise<PendingControl[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<OutboxRow>(
    `SELECT * FROM control_outbox
     WHERE sender_pubkey = ? AND sent_at IS NULL
     ORDER BY CASE
       WHEN payload LIKE '%"type":"push-token"%' OR payload LIKE '%"type":"push-token-request"%' THEN 2
       WHEN payload LIKE '%"type":"circle-comment"%' OR payload LIKE '%"type":"circle-reaction"%' THEN 1
       ELSE 0
     END ASC, created_at ASC
     LIMIT ?`,
    senderPubkey,
    limit
  );
  return rows.map(mapControl);
}

export async function markControlSent(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE control_outbox SET sent_at = ? WHERE id = ?', Date.now(), id);
}
