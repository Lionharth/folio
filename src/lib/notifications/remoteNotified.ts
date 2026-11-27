import { getSetting, setSetting } from '../database/settings';

const KEY = 'push.remoteNotified';
const MOMENT_TTL_MS = 6 * 60 * 60 * 1000;
const SOCIAL_TTL_MS = 15 * 60 * 1000;
const INVITE_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;

export type RemoteCategory = 'moment' | 'social' | 'invite';

interface NotifiedEntry {
  at: number;
  category: RemoteCategory;
}

type NotifiedMap = Record<string, NotifiedEntry>;

function isEntry(value: unknown): value is NotifiedEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<NotifiedEntry>;
  return (
    typeof entry.at === 'number' &&
    (entry.category === 'moment' || entry.category === 'social' || entry.category === 'invite')
  );
}

function prune(map: NotifiedMap, now: number): NotifiedMap {
  const kept = Object.entries(map)
    .filter(([remoteId, entry]) => {
      if (!remoteId || remoteId.length > 120 || !isEntry(entry)) return false;
      const ttl =
        entry.category === 'moment'
          ? MOMENT_TTL_MS
          : entry.category === 'invite'
            ? INVITE_TTL_MS
            : SOCIAL_TTL_MS;
      return now - entry.at < ttl;
    })
    .sort((left, right) => right[1].at - left[1].at)
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(kept);
}

async function readMap(): Promise<NotifiedMap> {
  const raw = await getSetting(KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as NotifiedMap;
  } catch {
    return {};
  }
}

/**
 * Records that a remote push already covered this moment or thread, so a later
 * background inbox check does not schedule a duplicate local banner. Moment
 * markers last hours; social markers expire quickly so newer comments still
 * notify normally. This only covers pushes received while JS is running.
 */
export async function markRemoteNotifiedAsync(
  remoteId: string,
  category: RemoteCategory
): Promise<void> {
  if (!remoteId || remoteId.length > 120) return;
  const now = Date.now();
  const map = prune(await readMap(), now);
  map[remoteId] = { at: now, category };
  await setSetting(KEY, JSON.stringify(prune(map, now)));
}

export async function listRemoteNotifiedAsync(): Promise<{
  moments: Set<string>;
  social: Set<string>;
  invites: Set<string>;
}> {
  const map = prune(await readMap(), Date.now());
  const moments = new Set<string>();
  const social = new Set<string>();
  const invites = new Set<string>();
  for (const [remoteId, entry] of Object.entries(map)) {
    if (entry.category === 'moment') moments.add(remoteId);
    else if (entry.category === 'invite') invites.add(remoteId);
    else social.add(remoteId);
  }
  return { moments, social, invites };
}
