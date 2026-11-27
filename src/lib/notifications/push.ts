/**
 * Pure Expo push helpers. This module must stay free of Expo, React Native and
 * SQLite imports so the node test harness can load it.
 */
import { circlesNotificationUrl, remoteVlogNotificationUrl } from './routes';

export const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
export const MAX_PUSH_MESSAGES_PER_REQUEST = 100;
export const MAX_EXPO_TOKEN_LENGTH = 256;

export type PushPlatform = 'android' | 'ios';
export type PushCategory = 'moment' | 'comment' | 'reply' | 'reaction' | 'invite';

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: {
    url: string;
    remoteId?: string;
    circleId?: string;
    category: PushCategory;
    /** Identity that registered this token; the device ignores another identity. */
    viewerPubkey: string;
    /** All identities that registered this token, for multi-identity devices. */
    viewerPubkeys?: string[];
    /** Dev test pushes may display while the app is in the foreground. */
    test?: boolean;
  };
  sound?: 'default' | null;
  channelId?: string;
  collapseId?: string;
  threadId?: string;
  priority?: 'default' | 'normal' | 'high';
}

const EXPO_TOKEN_PATTERN = /^(?:Exponent|Expo)PushToken\[[A-Za-z0-9._~-]{6,256}\]$/;

export function isExpoPushToken(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_EXPO_TOKEN_LENGTH && EXPO_TOKEN_PATTERN.test(value);
}

export function chunkPushMessages<T>(items: T[], size = MAX_PUSH_MESSAGES_PER_REQUEST): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('Push batch size must be a positive integer');
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function remoteVlogUrl(remoteId: string, comments = false): string {
  return remoteVlogNotificationUrl(remoteId, comments);
}

function messageData(
  remoteId: string,
  circleId: string,
  category: PushCategory,
  comments: boolean,
  viewerPubkey: string,
  viewerPubkeys?: string[]
): ExpoPushMessage['data'] {
  return {
    url: remoteVlogUrl(remoteId, comments),
    remoteId,
    circleId,
    category,
    viewerPubkey,
    ...(viewerPubkeys && viewerPubkeys.length > 1 ? { viewerPubkeys } : {}),
  };
}

export function buildInvitePushMessage(
  token: string,
  input: { circleId: string; viewerPubkey: string }
): ExpoPushMessage {
  return {
    to: token,
    title: 'New invitation',
    body: 'Someone invited you to a circle.',
    data: {
      url: circlesNotificationUrl(),
      circleId: input.circleId,
      category: 'invite',
      viewerPubkey: input.viewerPubkey,
    },
    sound: 'default',
    channelId: 'circles',
    collapseId: `invite-${input.circleId}`,
    priority: 'default',
  };
}

export function buildMomentPushMessage(
  token: string,
  input: { remoteId: string; circleId: string; viewerPubkey: string; viewerPubkeys?: string[] }
): ExpoPushMessage {
  return {
    to: token,
    title: 'New moment',
    body: 'A moment was shared in one of your circles.',
    data: messageData(
      input.remoteId,
      input.circleId,
      'moment',
      false,
      input.viewerPubkey,
      input.viewerPubkeys
    ),
    sound: 'default',
    channelId: 'moments',
    priority: 'default',
  };
}

export function buildSocialPushMessage(
  token: string,
  input: {
    remoteId: string;
    circleId: string;
    category: Extract<PushCategory, 'comment' | 'reply' | 'reaction'>;
    targetType?: 'vlog' | 'comment';
    viewerPubkey: string;
    viewerPubkeys?: string[];
  }
): ExpoPushMessage {
  const copy =
    input.category === 'reply'
      ? { title: 'New reply', body: 'Someone replied to you.' }
      : input.category === 'comment'
        ? { title: 'New comment', body: 'Someone commented on your moment.' }
        : {
            title: 'New reaction',
            body:
              input.targetType === 'comment'
                ? 'Someone reacted to your comment.'
                : 'Someone reacted to your moment.',
          };
  return {
    to: token,
    title: copy.title,
    body: copy.body,
    data: messageData(
      input.remoteId,
      input.circleId,
      input.category,
      true,
      input.viewerPubkey,
      input.viewerPubkeys
    ),
    sound: 'default',
    channelId: 'social',
    collapseId: `social-${input.remoteId}`,
    threadId: `moment-${input.remoteId}`,
    priority: 'default',
  };
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface ExpoPushResponse {
  data?: ExpoPushTicket | ExpoPushTicket[];
  errors?: { code?: string; message?: string }[];
}

/** Returns the tokens Expo says are no longer registered. */
export function invalidTokensFromResponse(response: ExpoPushResponse, tokens: string[]): string[] {
  const tickets = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
  const invalid: string[] = [];
  tickets.forEach((ticket, index) => {
    if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      const token = tokens[index];
      if (token) invalid.push(token);
    }
  });
  return [...new Set(invalid)];
}

export function uniquePushTokens(tokens: Iterable<string>): string[] {
  return [...new Set([...tokens].filter(isExpoPushToken))];
}
