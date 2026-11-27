import { createRumor, createSeal, createWrap } from 'nostr-tools/nip59';
import { getPublicKey, type Event } from 'nostr-tools/pure';

import { isExpoPushToken, type PushPlatform } from '../notifications/push';
import { parseSocialControl, type SocialControlPayload } from './socialControl';

export const KIND_PRIVATE_MESSAGE = 14;
export const FOLIO_CONTROL_TAG = 'folio-control';
export type { CircleCommentPayload, CircleReactionPayload } from './socialControl';

export interface CircleInvitePayload {
  v: 1;
  type: 'circle-invite';
  circle: {
    id: string;
    name: string;
    description?: string;
    ownerPubkey: string;
    ownerName?: string;
    membershipVersion: number;
    /** Owner plus every member the owner currently has in the circle. */
    members: string[];
    /** Display names the owner knows for the roster, kept private in the wrap. */
    names?: Record<string, string>;
  };
  invitedAt: number;
}

export interface CircleAcceptPayload {
  v: 1;
  type: 'circle-accept';
  circleId: string;
  memberPubkey: string;
  memberName?: string;
  at: number;
}

export type MembershipAction = 'join' | 'decline' | 'removed';

export interface PushNotificationPreferences {
  posts: boolean;
  activity: boolean;
  invites: boolean;
}

/**
 * Device push capability shared only with members of one circle. The token is a
 * bearer capability, so it travels inside the same NIP-17 wraps as other
 * control messages and is scoped to a single circle id.
 */
export interface PushTokenPayload {
  v: 1;
  type: 'push-token';
  circleId: string;
  token: string;
  platform: PushPlatform;
  deviceId: string;
  /** False when the device has notifications disabled or permission revoked. */
  enabled: boolean;
  /** Whether the sender wants remote posts and social activity for this circle. */
  preferences: PushNotificationPreferences;
  /** The sender's local mute state for this circle. */
  muted: boolean;
  at: number;
}

/** Asks current members of one circle to send their push tokens back. */
export interface PushTokenRequestPayload {
  v: 1;
  type: 'push-token-request';
  circleId: string;
  at: number;
}

/**
 * Durable membership evidence. Accepted, declined and removed circles publish
 * this to the member's own inbox so a new device can restore or suppress the
 * circle without showing the invitation again.
 */
export interface CircleMembershipPayload {
  v: 1;
  type: 'circle-membership';
  action: MembershipAction;
  circleId: string;
  ownerPubkey: string;
  memberPubkey: string;
  membershipVersion: number;
  at: number;
  /** Required for action=join: lets a new device rebuild the circle without the invite. */
  circle?: CircleInvitePayload['circle'];
}

export type CircleControlPayload =
  | CircleInvitePayload
  | CircleAcceptPayload
  | CircleMembershipPayload
  | PushTokenPayload
  | PushTokenRequestPayload
  | SocialControlPayload;

const HEX64 = /^[0-9a-f]{64}$/;

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value);
}

function isNonEmptyString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0 || cleaned.length > 40) return undefined;
  return cleaned;
}

function parseNames(value: unknown, allowed: string[]): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) return undefined;
  const allowedSet = new Set(allowed);
  const names: Record<string, string> = {};
  for (const [pubkey, raw] of entries) {
    if (!isHex64(pubkey) || !allowedSet.has(pubkey)) return undefined;
    const name = normalizeName(raw);
    if (!name) return undefined;
    names[pubkey] = name;
  }
  return names;
}

function parseInviteCircle(value: unknown): CircleInvitePayload['circle'] | null {
  if (!value || typeof value !== 'object') return null;
  const circle = value as Record<string, unknown>;
  if (!isNonEmptyString(circle.id, 120)) return null;
  if (!isNonEmptyString(circle.name, 80)) return null;
  if (circle.description !== undefined && (typeof circle.description !== 'string' || circle.description.length > 400)) {
    return null;
  }
  if (!isHex64(circle.ownerPubkey)) return null;
  if (!Number.isInteger(circle.membershipVersion) || (circle.membershipVersion as number) < 1) return null;
  if (!Array.isArray(circle.members) || circle.members.length === 0 || circle.members.length > 100) return null;
  if (!circle.members.every(isHex64)) return null;
  const members = [...new Set(circle.members as string[])];
  if (circle.ownerName !== undefined && !normalizeName(circle.ownerName)) return null;
  const names = parseNames(circle.names, members);
  if (circle.names !== undefined && !names) return null;
  return {
    id: circle.id,
    name: circle.name.trim(),
    description: typeof circle.description === 'string' ? circle.description : undefined,
    ownerPubkey: circle.ownerPubkey,
    ownerName: normalizeName(circle.ownerName),
    membershipVersion: circle.membershipVersion as number,
    members,
    names,
  };
}

/**
 * Parses and validates an application control payload from an encrypted NIP-17
 * rumor. Invalid values are rejected instead of coerced.
 */
export function parseControlPayload(tags: string[][]): CircleControlPayload | null {
  const tag = tags.find((entry) => entry[0] === FOLIO_CONTROL_TAG);
  if (!tag?.[1]) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(tag[1]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as Record<string, unknown>;
  if (value.v !== 1) return null;

  if (value.type === 'circle-invite') {
    const circle = parseInviteCircle(value.circle);
    if (!circle) return null;
    if (typeof value.invitedAt !== 'number' || !Number.isFinite(value.invitedAt)) return null;
    return {
      v: 1,
      type: 'circle-invite',
      circle,
      invitedAt: value.invitedAt,
    };
  }

  if (value.type === 'circle-membership') {
    if (value.action !== 'join' && value.action !== 'decline' && value.action !== 'removed') return null;
    if (!isNonEmptyString(value.circleId, 120)) return null;
    if (!isHex64(value.ownerPubkey)) return null;
    if (!isHex64(value.memberPubkey)) return null;
    if (!Number.isInteger(value.membershipVersion) || (value.membershipVersion as number) < 1) return null;
    if (typeof value.at !== 'number' || !Number.isFinite(value.at)) return null;
    let circle: CircleInvitePayload['circle'] | undefined;
    if (value.circle !== undefined) {
      const parsedCircle = parseInviteCircle(value.circle);
      if (!parsedCircle) return null;
      if (parsedCircle.id !== value.circleId) return null;
      if (parsedCircle.ownerPubkey !== value.ownerPubkey) return null;
      if (parsedCircle.membershipVersion !== value.membershipVersion) return null;
      if (value.action !== 'removed' && !parsedCircle.members.includes(value.memberPubkey)) {
        return null;
      }
      circle = parsedCircle;
    }
    if (value.action === 'join' && !circle) return null;
    return {
      v: 1,
      type: 'circle-membership',
      action: value.action,
      circleId: value.circleId,
      ownerPubkey: value.ownerPubkey,
      memberPubkey: value.memberPubkey,
      membershipVersion: value.membershipVersion as number,
      at: value.at,
      circle,
    };
  }

  if (value.type === 'circle-accept') {
    if (!isNonEmptyString(value.circleId, 120)) return null;
    if (!isHex64(value.memberPubkey)) return null;
    if (value.memberName !== undefined && !normalizeName(value.memberName)) return null;
    if (typeof value.at !== 'number' || !Number.isFinite(value.at)) return null;
    return {
      v: 1,
      type: 'circle-accept',
      circleId: value.circleId,
      memberPubkey: value.memberPubkey,
      memberName: normalizeName(value.memberName),
      at: value.at,
    };
  }

  if (value.type === 'push-token') {
    if (!isNonEmptyString(value.circleId, 120)) return null;
    if (!isExpoPushToken(value.token)) return null;
    if (value.platform !== 'android' && value.platform !== 'ios') return null;
    if (typeof value.deviceId !== 'string' || !/^[A-Za-z0-9._:-]{8,80}$/.test(value.deviceId)) return null;
    if (typeof value.enabled !== 'boolean') return null;
    if (typeof value.at !== 'number' || !Number.isFinite(value.at) || value.at <= 0) return null;

    let muted = false;
    if (value.muted !== undefined) {
      if (typeof value.muted !== 'boolean') return null;
      muted = value.muted;
    }
    let preferences: PushNotificationPreferences = { posts: true, activity: true, invites: true };
    if (value.preferences !== undefined) {
      if (!value.preferences || typeof value.preferences !== 'object' || Array.isArray(value.preferences)) {
        return null;
      }
      const raw = value.preferences as Record<string, unknown>;
      if (raw.posts !== undefined && typeof raw.posts !== 'boolean') return null;
      if (raw.activity !== undefined && typeof raw.activity !== 'boolean') return null;
      if (raw.invites !== undefined && typeof raw.invites !== 'boolean') return null;
      preferences = {
        posts: raw.posts !== false,
        activity: raw.activity !== false,
        invites: raw.invites !== false,
      };
    }

    return {
      v: 1,
      type: 'push-token',
      circleId: value.circleId,
      token: value.token,
      platform: value.platform,
      deviceId: value.deviceId,
      enabled: value.enabled,
      preferences,
      muted,
      at: value.at,
    };
  }

  if (value.type === 'push-token-request') {
    if (!isNonEmptyString(value.circleId, 120)) return null;
    if (typeof value.at !== 'number' || !Number.isFinite(value.at) || value.at <= 0) return null;
    return {
      v: 1,
      type: 'push-token-request',
      circleId: value.circleId,
      at: value.at,
    };
  }

  if (value.type === 'circle-comment' || value.type === 'circle-reaction') {
    return parseSocialControl(value);
  }

  return null;
}

/** Builds an unsigned kind-14 control rumor for one recipient. */
export function buildControlRumor(payload: CircleControlPayload, senderSecret: Uint8Array, recipientPubkey: string) {
  return createRumor(
    {
      kind: KIND_PRIVATE_MESSAGE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', recipientPubkey],
        [FOLIO_CONTROL_TAG, JSON.stringify(payload)],
      ],
      content: '',
    },
    senderSecret
  );
}

export interface WrappedControl {
  rumorId: string;
  wrap: Event;
}

/** Seals and gift-wraps a control message for one recipient. */
export function wrapControl(
  payload: CircleControlPayload,
  senderSecret: Uint8Array,
  recipientPubkey: string
): WrappedControl {
  const rumor = buildControlRumor(payload, senderSecret, recipientPubkey);
  const seal = createSeal(rumor, senderSecret, recipientPubkey);
  const wrap = createWrap(seal, recipientPubkey);
  return { rumorId: rumor.id, wrap };
}

export interface WrappedControlFanout {
  rumorId: string;
  wraps: Event[];
}

export function wrapControlForRecipients(
  payload: CircleControlPayload,
  senderSecret: Uint8Array,
  recipientPubkeys: string[]
): WrappedControlFanout {
  const senderPubkey = getPublicKey(senderSecret);
  const targets = [...new Set([...recipientPubkeys, senderPubkey])];
  const rumor = createRumor(
    {
      kind: KIND_PRIVATE_MESSAGE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ...targets.map((pubkey) => ['p', pubkey]),
        [FOLIO_CONTROL_TAG, JSON.stringify(payload)],
      ],
      content: '',
    },
    senderSecret
  );
  const wraps = targets.map((recipient) =>
    createWrap(createSeal(rumor, senderSecret, recipient), recipient)
  );
  return { rumorId: rumor.id, wraps };
}
