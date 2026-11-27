import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { getPublicKey } from 'nostr-tools/pure';

import { createSerialQueue } from '../lib/async/serialQueue';
import {
  EXPO_PUSH_ENDPOINT,
  buildInvitePushMessage,
  buildMomentPushMessage,
  buildSocialPushMessage,
  chunkPushMessages,
  invalidTokensFromResponse,
  isExpoPushToken,
  type ExpoPushMessage,
  type ExpoPushResponse,
  type PushCategory,
  type PushPlatform,
} from '../lib/notifications/push';
import {
  deletePushToken,
  deletePushTokensByToken,
  listPushTokensForOwnerAnyCircle,
  listPushTokensForOwners,
  prunePushTokens,
  upsertPushToken,
} from '../lib/database/pushTokens';
import { getSetting, setSetting } from '../lib/database/settings';
import { enqueueControl, enqueueControls } from '../lib/database/outbox';
import { listCircleMembers, listCirclesForViewer, getCircle } from '../lib/database/vlogs';
import type {
  CircleControlPayload,
  PushTokenPayload,
  PushTokenRequestPayload,
} from '../lib/nostr/circleControl';
import { readSecretKey, type StoredIdentity } from '../lib/nostr/identity';
import { flushControlOutbox } from './membership';
import {
  ensureAndroidChannelsAsync,
  effectiveNotificationsEnabled,
  getNotificationPermissionAsync,
  getNotificationPreferences,
} from './notifications';

const DEVICE_ID_KEY = 'push.deviceId';
const TOKEN_KEY = 'push.token';
const ANNOUNCE_PREFIX = 'push.announced.';
const ERROR_PREFIX = 'push.lastError.';
const ANNOUNCE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_PRUNE_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const PUSH_TIMEOUT_MS = 8_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pushQueue = createSerialQueue();
interface InFlightRegistration {
  promise: Promise<PushRegistrationResult>;
  forceQueued: boolean;
}
const registrationsInFlight = new Map<string, InFlightRegistration>();

export type PushRegistrationStatus = 'active' | 'disabled' | 'blocked' | 'unconfigured' | 'error';

export interface PushRegistrationResult {
  status: PushRegistrationStatus;
  token: string | null;
  message?: string;
}

export class PushSetupError extends Error {
  constructor(
    readonly code: 'unconfigured' | 'platform' | 'token',
    message: string
  ) {
    super(message);
    this.name = 'PushSetupError';
  }
}

interface AnnounceState {
  token: string;
  enabled: boolean;
  at: number;
}

interface PushSendResult {
  accepted: number;
  invalid: string[];
  error?: string;
  ticketIds?: string[];
}

const EXPO_RECEIPTS_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts';

async function fetchPushReceiptErrorsAsync(ticketIds: string[]): Promise<string | null> {
  if (ticketIds.length === 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const response = await fetch(EXPO_RECEIPTS_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ticketIds }),
      signal: controller.signal,
    });
    if (!response.ok) return `Receipt lookup returned HTTP ${response.status}`;
    const body = (await response.json()) as {
      data?: Record<string, { status?: string; message?: string; details?: { error?: string } }>;
    };
    const errors = Object.values(body.data ?? {})
      .filter((receipt) => receipt.status === 'error')
      .map((receipt) => receipt.message ?? receipt.details?.error ?? 'Push delivery failed');
    return errors.length > 0 ? errors.join('; ') : null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Receipt lookup failed';
  } finally {
    clearTimeout(timer);
  }
}

function currentPlatform(): PushPlatform | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveProjectId(): string | null {
  const candidates = [
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    Constants.expoConfig?.extra?.eas?.projectId,
    Constants.easConfig?.projectId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && UUID_PATTERN.test(candidate.trim())) {
      return candidate.trim();
    }
  }
  return null;
}

async function getDeviceId(): Promise<string> {
  const stored = await getSetting(DEVICE_ID_KEY);
  if (stored && /^[A-Za-z0-9._:-]{8,80}$/.test(stored)) return stored;
  const created = randomUUID();
  await setSetting(DEVICE_ID_KEY, created);
  return created;
}

async function getStoredPushToken(): Promise<string | null> {
  const stored = await getSetting(TOKEN_KEY);
  return isExpoPushToken(stored) ? stored : null;
}

async function getOrCreateExpoPushTokenAsync(options: { force?: boolean } = {}): Promise<string> {
  const cached = await getStoredPushToken();
  if (cached && !options.force) return cached;

  const projectId = resolveProjectId();
  if (!projectId) {
    if (cached) return cached;
    throw new PushSetupError(
      'unconfigured',
      'Add an EAS project ID before remote push can register this device.'
    );
  }
  if (!currentPlatform()) {
    throw new PushSetupError('platform', 'Expo push is only available on Android and iOS.');
  }

  await ensureAndroidChannelsAsync();
  try {
    const result = await withTimeout(
      Notifications.getExpoPushTokenAsync({ projectId }),
      15_000,
      'Expo push token request timed out'
    );
    if (!isExpoPushToken(result.data)) {
      throw new Error('Expo returned an unexpected push token');
    }
    await setSetting(TOKEN_KEY, result.data);
    return result.data;
  } catch (error) {
    if (cached) return cached;
    throw new PushSetupError(
      'token',
      error instanceof Error ? error.message : 'Expo push token registration failed.'
    );
  }
}

function announceKey(pubkey: string): string {
  return `${ANNOUNCE_PREFIX}${pubkey}`;
}

function errorKey(pubkey: string): string {
  return `${ERROR_PREFIX}${pubkey}`;
}

async function readAnnounceState(pubkey: string): Promise<AnnounceState | null> {
  const raw = await getSetting(announceKey(pubkey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AnnounceState>;
    if (
      typeof parsed.token === 'string' &&
      typeof parsed.enabled === 'boolean' &&
      typeof parsed.at === 'number'
    ) {
      return { token: parsed.token, enabled: parsed.enabled, at: parsed.at };
    }
  } catch {
    // Fall through and treat a corrupt cache as absent.
  }
  return null;
}

async function writeAnnounceState(pubkey: string, state: AnnounceState): Promise<void> {
  await setSetting(announceKey(pubkey), JSON.stringify(state));
}

async function recordPushError(pubkey: string, message: string): Promise<void> {
  await setSetting(errorKey(pubkey), message.slice(0, 300));
}

async function clearPushError(pubkey: string): Promise<void> {
  await setSetting(errorKey(pubkey), '');
}

async function enqueuePushAnnouncements(input: {
  secretKey: Uint8Array;
  token: string;
  enabled: boolean;
  circleIds?: string[];
  request?: boolean;
}): Promise<number> {
  const platform = currentPlatform();
  if (!platform) return 0;
  const selfPubkey = getPublicKey(input.secretKey);
  const deviceId = await getDeviceId();
  const at = Date.now();
  const preferences = await getNotificationPreferences();
  const circles = await listCirclesForViewer(selfPubkey);
  const allowed = input.circleIds ? new Set(input.circleIds) : null;

  const controls: { recipientPubkey: string; payload: CircleControlPayload }[] = [];
  for (const circle of circles) {
    if (allowed && !allowed.has(circle.id)) continue;
    const members = await listCircleMembers(circle.id);
    const payload: PushTokenPayload = {
      v: 1,
      type: 'push-token',
      circleId: circle.id,
      token: input.token,
      platform,
      deviceId,
      enabled: input.enabled,
      preferences: {
        posts: preferences.posts,
        activity: preferences.activity,
        invites: preferences.invites,
      },
      muted: circle.muted,
      at,
    };
    const request: PushTokenRequestPayload = {
      v: 1,
      type: 'push-token-request',
      circleId: circle.id,
      at,
    };
    for (const member of members) {
      if (member.status !== 'active' || member.pubkey === selfPubkey) continue;
      controls.push({ recipientPubkey: member.pubkey, payload });
      if (input.request) controls.push({ recipientPubkey: member.pubkey, payload: request });
    }
  }
  if (controls.length === 0) return 0;

  await enqueueControls(selfPubkey, controls);
  return controls.length;
}

/**
 * Registers this device with Expo (when notifications are effective) and
 * announces the token to every active circle member through encrypted control
 * messages. A disabled state is announced too, so peers delete the token.
 */
export function syncPushRegistrationAsync(
  identity: StoredIdentity,
  options: { force?: boolean } = {}
): Promise<PushRegistrationResult> {
  const existing = registrationsInFlight.get(identity.id);
  if (existing) {
    if (options.force) existing.forceQueued = true;
    return existing.promise;
  }

  const entry = { forceQueued: false } as InFlightRegistration;
  entry.promise = pushQueue
    .run(async () => {
      let result = await runPushRegistration(identity, options);
      while (entry.forceQueued) {
        entry.forceQueued = false;
        result = await runPushRegistration(identity, { force: true });
      }
      return result;
    })
    .finally(() => {
      registrationsInFlight.delete(identity.id);
    });
  registrationsInFlight.set(identity.id, entry);
  return entry.promise;
}

async function runPushRegistration(
  identity: StoredIdentity,
  options: { force?: boolean }
): Promise<PushRegistrationResult> {
  const preferences = await getNotificationPreferences();
  const permission = await getNotificationPermissionAsync();
  const enabled = preferences.enabled && permission;

  let token = await getStoredPushToken();
  let status: PushRegistrationStatus = enabled ? 'active' : preferences.enabled ? 'blocked' : 'disabled';

  if (enabled) {
    try {
      token = await getOrCreateExpoPushTokenAsync({ force: options.force });
    } catch (error) {
      const pushError = error instanceof PushSetupError ? error : null;
      const message = error instanceof Error ? error.message : 'Push registration failed.';
      await recordPushError(identity.pubkey, message);
      return {
        status: pushError?.code === 'unconfigured' ? 'unconfigured' : 'error',
        token,
        message,
      };
    }
  }

  if (!token) return { status, token: null };

  try {
    const announced = await readAnnounceState(identity.pubkey);
    const stale =
      !announced ||
      announced.token !== token ||
      announced.enabled !== enabled ||
      Date.now() - announced.at > ANNOUNCE_REFRESH_MS;
    if (options.force || stale) {
      const secretKey = await readSecretKey(identity.id);
      await enqueuePushAnnouncements({ secretKey, token, enabled, request: enabled });
      await writeAnnounceState(identity.pubkey, { token, enabled, at: Date.now() });
      await flushControlOutbox(secretKey, undefined, 4_000).catch(() => 0);
    }
    await clearPushError(identity.pubkey);
    await prunePushTokens(Date.now() - TOKEN_PRUNE_AGE_MS);
    return { status, token };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Push registration failed.';
    await recordPushError(identity.pubkey, message);
    return { status: 'error', token, message };
  }
}

/** Announces the current token for one circle, used after accepting an invite. */
export function announcePushTokenToCircleAsync(
  secretKey: Uint8Array,
  circleId: string
): Promise<number> {
  return pushQueue.run(async () => {
    const token = await getStoredPushToken();
    if (!token) return 0;
    const enabled = await effectiveNotificationsEnabled(await getNotificationPreferences());
    const count = await enqueuePushAnnouncements({
      secretKey,
      token,
      enabled,
      circleIds: [circleId],
      request: enabled,
    });
    if (count > 0) {
      await flushControlOutbox(secretKey, undefined, 4_000).catch(() => 0);
    }
    return count;
  });
}

/** Replies to one token request; the sync that received it flushes the outbox. */
export async function respondWithPushTokenAsync(
  secretKey: Uint8Array,
  recipientPubkey: string,
  circleId: string,
  requestId?: string
): Promise<boolean> {
  const selfPubkey = getPublicKey(secretKey);
  if (requestId && (await hasAnsweredPushTokenRequest(selfPubkey, requestId))) return false;

  const token = await getStoredPushToken();
  if (!token) return false;
  const preferences = await getNotificationPreferences();
  const enabled = preferences.enabled && (await getNotificationPermissionAsync());
  if (!enabled) return false;
  const platform = currentPlatform();
  if (!platform) return false;

  const circle = await getCircle(circleId);
  const payload: PushTokenPayload = {
    v: 1,
    type: 'push-token',
    circleId,
    token,
    platform,
    deviceId: await getDeviceId(),
    enabled,
    preferences: {
      posts: preferences.posts,
      activity: preferences.activity,
      invites: preferences.invites,
    },
    muted: circle?.muted ?? false,
    at: Date.now(),
  };
  await enqueueControl({ senderPubkey: selfPubkey, recipientPubkey, payload });
  if (requestId) await markAnsweredPushTokenRequest(selfPubkey, requestId);
  return true;
}

const ANSWERED_REQUESTS_PREFIX = 'push.answeredRequests.';

function answeredRequestsKey(pubkey: string): string {
  return `${ANSWERED_REQUESTS_PREFIX}${pubkey}`;
}

async function readAnsweredRequests(pubkey: string): Promise<string[]> {
  const raw = await getSetting(answeredRequestsKey(pubkey));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function hasAnsweredPushTokenRequest(pubkey: string, requestId: string): Promise<boolean> {
  return (await readAnsweredRequests(pubkey)).includes(requestId);
}

async function markAnsweredPushTokenRequest(pubkey: string, requestId: string): Promise<void> {
  const answered = await readAnsweredRequests(pubkey);
  if (answered.includes(requestId)) return;
  answered.push(requestId);
  await setSetting(answeredRequestsKey(pubkey), JSON.stringify(answered.slice(-200)));
}

/** Applies a received token control for a circle the sender actively belongs to. */
export async function applyPushTokenControl(input: {
  viewerPubkey: string;
  senderPubkey: string;
  payload: PushTokenPayload;
}): Promise<void> {
  const { viewerPubkey, senderPubkey, payload } = input;
  if (viewerPubkey === senderPubkey) return;
  if (payload.enabled) {
    await upsertPushToken({
      viewerPubkey,
      ownerPubkey: senderPubkey,
      circleId: payload.circleId,
      deviceId: payload.deviceId,
      token: payload.token,
      platform: payload.platform,
      allowPosts: payload.preferences.posts,
      allowActivity: payload.preferences.activity,
      allowInvites: payload.preferences.invites,
      muted: payload.muted,
      updatedAt: payload.at,
    });
  } else {
    await deletePushToken({
      viewerPubkey,
      ownerPubkey: senderPubkey,
      circleId: payload.circleId,
      deviceId: payload.deviceId,
      at: payload.at,
    });
  }
}

async function sendPushMessagesAsync(messages: ExpoPushMessage[]): Promise<PushSendResult> {
  const result: PushSendResult = { accepted: 0, invalid: [] };
  for (const batch of chunkPushMessages(messages)) {
    const tokens = batch.map((message) => message.to);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
        signal: controller.signal,
      });
      if (!response.ok) {
        result.error = `Expo push returned HTTP ${response.status}`;
        continue;
      }
      const body = (await response.json()) as ExpoPushResponse;
      const invalid = invalidTokensFromResponse(body, tokens);
      if (invalid.length > 0) {
        await deletePushTokensByToken(invalid);
        result.invalid.push(...invalid);
      }
      const tickets = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
      result.accepted += tickets.filter((ticket) => ticket.status === 'ok').length;
      for (const ticket of tickets) {
        if (ticket.status === 'ok' && ticket.id) {
          result.ticketIds = [...(result.ticketIds ?? []), ticket.id];
        }
      }
      const ticketErrors = tickets
        .filter((ticket) => ticket.status === 'error' && ticket.message)
        .map((ticket) => ticket.message as string);
      if (ticketErrors.length > 0) {
        result.error = ticketErrors.join('; ');
      }
      if (body.errors?.length) {
        result.error = body.errors.map((error) => error.message ?? error.code ?? 'Push error').join('; ');
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Expo push request failed.';
    } finally {
      clearTimeout(timer);
    }
  }
  result.invalid = [...new Set(result.invalid)];
  return result;
}

export async function notifyMomentPublishedAsync(input: {
  viewerPubkey: string;
  circleId: string;
  remoteId: string;
  recipientPubkeys: string[];
}): Promise<PushSendResult> {
  const recipients = input.recipientPubkeys.filter((pubkey) => pubkey !== input.viewerPubkey);
  if (recipients.length === 0) return { accepted: 0, invalid: [] };
  const rows = await listPushTokensForOwners(input.viewerPubkey, input.circleId, recipients);
  if (rows.length === 0) return { accepted: 0, invalid: [] };

  const ownersByToken = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.muted || !row.allowPosts) continue;
    if (!isExpoPushToken(row.token)) continue;
    const owners = ownersByToken.get(row.token) ?? new Set<string>();
    owners.add(row.ownerPubkey);
    ownersByToken.set(row.token, owners);
  }

  const messages: ExpoPushMessage[] = [];
  for (const [token, owners] of ownersByToken) {
    const viewerPubkeys = [...owners];
    messages.push(
      buildMomentPushMessage(token, {
        remoteId: input.remoteId,
        circleId: input.circleId,
        viewerPubkey: viewerPubkeys[0],
        viewerPubkeys,
      })
    );
  }
  if (messages.length === 0) return { accepted: 0, invalid: [] };
  return sendPushMessagesAsync(messages);
}

export async function notifySocialActivityAsync(input: {
  viewerPubkey: string;
  circleId: string;
  remoteId: string;
  recipients: {
    pubkey: string;
    category: Extract<PushCategory, 'comment' | 'reply' | 'reaction'>;
    targetType?: 'vlog' | 'comment';
  }[];
}): Promise<PushSendResult> {
  const byOwner = new Map<string, (typeof input.recipients)[number]>();
  for (const recipient of input.recipients) {
    if (recipient.pubkey === input.viewerPubkey) continue;
    const current = byOwner.get(recipient.pubkey);
    // A reply to the viewer's own comment takes precedence over a general comment.
    if (!current || (recipient.category === 'reply' && current.category !== 'reply')) {
      byOwner.set(recipient.pubkey, recipient);
    }
  }
  if (byOwner.size === 0) return { accepted: 0, invalid: [] };

  const rows = await listPushTokensForOwners(input.viewerPubkey, input.circleId, [...byOwner.keys()]);
  if (rows.length === 0) return { accepted: 0, invalid: [] };

  const byToken = new Map<
    string,
    {
      owners: Set<string>;
      recipient: (typeof input.recipients)[number];
    }
  >();
  for (const row of rows) {
    if (row.muted || !row.allowActivity) continue;
    if (!isExpoPushToken(row.token)) continue;
    const recipient = byOwner.get(row.ownerPubkey);
    if (!recipient) continue;
    const current = byToken.get(row.token);
    if (!current) {
      byToken.set(row.token, { owners: new Set([row.ownerPubkey]), recipient });
      continue;
    }
    current.owners.add(row.ownerPubkey);
    if (recipient.category === 'reply' && current.recipient.category !== 'reply') {
      current.recipient = recipient;
    }
  }

  const messages: ExpoPushMessage[] = [];
  for (const [token, entry] of byToken) {
    const viewerPubkeys = [...entry.owners];
    messages.push(
      buildSocialPushMessage(token, {
        remoteId: input.remoteId,
        circleId: input.circleId,
        category: entry.recipient.category,
        targetType: entry.recipient.targetType,
        viewerPubkey: viewerPubkeys[0],
        viewerPubkeys,
      })
    );
  }
  if (messages.length === 0) return { accepted: 0, invalid: [] };
  return sendPushMessagesAsync(messages);
}

/**
 * Pushes a generic invitation to a contact whose token was learned from another
 * shared circle. Cold invites have no token and remain on the background task.
 */
export async function notifyInviteAsync(input: {
  viewerPubkey: string;
  inviteePubkey: string;
  circleId: string;
}): Promise<PushSendResult> {
  if (input.inviteePubkey === input.viewerPubkey) return { accepted: 0, invalid: [] };
  const rows = await listPushTokensForOwnerAnyCircle(input.viewerPubkey, input.inviteePubkey);
  if (rows.length === 0) return { accepted: 0, invalid: [] };

  const seen = new Set<string>();
  const messages: ExpoPushMessage[] = [];
  for (const row of rows) {
    if (!row.allowInvites) continue;
    if (!isExpoPushToken(row.token)) continue;
    if (seen.has(row.token)) continue;
    seen.add(row.token);
    messages.push(
      buildInvitePushMessage(row.token, {
        circleId: input.circleId,
        viewerPubkey: row.ownerPubkey,
      })
    );
  }
  if (messages.length === 0) return { accepted: 0, invalid: [] };
  return sendPushMessagesAsync(messages);
}

export async function sendRemoteTestPushAsync(identity: StoredIdentity | null): Promise<string> {
  if (!identity) return 'Open an identity first.';
  if (!(await effectiveNotificationsEnabled(await getNotificationPreferences()))) {
    return 'Enable notifications and grant the system permission first.';
  }
  const token = await getOrCreateExpoPushTokenAsync({ force: true });
  const result = await sendPushMessagesAsync([
    {
      to: token,
      title: 'Folio test push',
      body: 'Remote push is working on this device.',
      data: {
        url: '/updates',
        remoteId: 'test',
        circleId: 'test',
        category: 'moment',
        viewerPubkey: identity.pubkey,
        test: true,
      },
      sound: 'default',
      channelId: 'moments',
      priority: 'default',
    },
  ]);
  if (result.accepted > 0) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const receiptError = await fetchPushReceiptErrorsAsync(result.ticketIds ?? []);
    if (receiptError) return `Expo accepted the push but delivery failed: ${receiptError}`;
    return 'Expo accepted and delivered the test push.';
  }
  return result.error ?? 'Expo did not accept the test push.';
}

export async function getPushDebugStateAsync(identity: StoredIdentity | null): Promise<{
  projectConfigured: boolean;
  token: string | null;
  deviceId: string;
  announcedAt: number | null;
  announcedEnabled: boolean | null;
  lastError: string | null;
}> {
  const [token, deviceId, announced, lastError] = await Promise.all([
    getStoredPushToken(),
    getDeviceId(),
    identity ? readAnnounceState(identity.pubkey) : Promise.resolve(null),
    identity ? getSetting(errorKey(identity.pubkey)) : Promise.resolve(null),
  ]);
  return {
    projectConfigured: resolveProjectId() !== null,
    token,
    deviceId,
    announcedAt: announced?.at ?? null,
    announcedEnabled: announced?.enabled ?? null,
    lastError: lastError || null,
  };
}
