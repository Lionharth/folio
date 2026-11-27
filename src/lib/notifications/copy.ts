/**
 * Pure notification copy and routing rules. This module must stay free of Expo,
 * React Native and SQLite imports so the node test harness can load it.
 */
import {
  circlesNotificationUrl,
  commentsNotificationUrl,
  updatesNotificationUrl,
  vlogNotificationUrl,
} from './routes';

export interface NotificationPreferences {
  enabled: boolean;
  posts: boolean;
  invites: boolean;
  membership: boolean;
  activity: boolean;
}

export interface InboxMomentEvent {
  /** Local vlog id, including the viewer prefix used by `/vlog/[id]`. */
  vlogId: string;
  /** Author's remote id; used to suppress a duplicate after a remote push. */
  remoteId?: string;
  circleId: string;
  circleName: string | null;
  authorPubkey: string;
}

export interface InboxInviteEvent {
  inviteId: string;
  circleId: string;
  circleName: string;
  ownerPubkey: string;
  ownerName: string | null;
}

export interface InboxMembershipEvent {
  circleId: string;
  circleName: string;
  kind: 'accepted' | 'removed';
  memberPubkey: string;
  memberName: string | null;
}

export interface InboxSocialEvent {
  vlogId: string;
  remoteId?: string;
  circleId: string;
  circleName: string | null;
  actorPubkey: string;
  kind: 'comment' | 'reply' | 'reaction';
  targetType?: 'vlog' | 'comment';
  emoji?: string | null;
}

export interface InboxNotificationEvents {
  moments: InboxMomentEvent[];
  invites: InboxInviteEvent[];
  membership: InboxMembershipEvent[];
  social: InboxSocialEvent[];
}

export interface NotificationRequest {
  channel: 'moments' | 'circles' | 'social';
  title: string;
  body: string;
  data: { url: string; test?: boolean };
}

export interface BuildInboxNotificationsInput {
  events: InboxNotificationEvents;
  preferences: NotificationPreferences;
  mutedCircleIds: Iterable<string>;
  /** Moment remote ids already covered by a remote push on this device. */
  remoteNotifiedMomentIds?: Iterable<string>;
  /** Thread remote ids covered by a recent remote social push. */
  remoteNotifiedSocialIds?: Iterable<string>;
  /** Circle ids covered by a recent remote invitation push. */
  remoteNotifiedInviteCircleIds?: Iterable<string>;
  names: Record<string, string | undefined>;
  viewerPubkey: string;
}

export const FALLBACK_CIRCLE_NAME = 'a circle';
export const FALLBACK_PERSON_NAME = 'Someone';

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? collapsed : null;
}

function personName(
  pubkey: string,
  provided: string | null | undefined,
  names: Record<string, string | undefined>
): string {
  return clean(provided) ?? clean(names[pubkey]) ?? FALLBACK_PERSON_NAME;
}

function circleName(value: string | null | undefined): string {
  return clean(value) ?? FALLBACK_CIRCLE_NAME;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

export function buildInboxNotifications({
  events,
  preferences,
  mutedCircleIds,
  remoteNotifiedMomentIds,
  remoteNotifiedSocialIds,
  remoteNotifiedInviteCircleIds,
  names,
  viewerPubkey,
}: BuildInboxNotificationsInput): NotificationRequest[] {
  const muted = new Set(mutedCircleIds);
  const remoteMoments = new Set(remoteNotifiedMomentIds);
  const remoteSocial = new Set(remoteNotifiedSocialIds);
  const remoteInvites = new Set(remoteNotifiedInviteCircleIds);
  const requests: NotificationRequest[] = [];

  if (preferences.posts) {
    const groups = new Map<string, InboxMomentEvent[]>();
    for (const event of events.moments) {
      if (event.authorPubkey === viewerPubkey) continue;
      if (muted.has(event.circleId)) continue;
      if (event.remoteId && remoteMoments.has(event.remoteId)) continue;
      const list = groups.get(event.circleId) ?? [];
      list.push(event);
      groups.set(event.circleId, list);
    }

    const ordered = [...groups.entries()].sort((left, right) => {
      const leftName = circleName(left[1][0]?.circleName);
      const rightName = circleName(right[1][0]?.circleName);
      if (leftName !== rightName) return leftName.localeCompare(rightName);
      return left[0].localeCompare(right[0]);
    });

    for (const [circleId, moments] of ordered) {
      const name = circleName(moments[0]?.circleName);
      const firstAuthor = personName(moments[0].authorPubkey, null, names);
      if (moments.length === 1) {
        requests.push({
          channel: 'moments',
          title: `New moment in ${name}`,
          body: `${firstAuthor} shared a moment.`,
          data: { url: vlogNotificationUrl(moments[0].vlogId) },
        });
        continue;
      }
      const others = moments.length - 1;
      requests.push({
        channel: 'moments',
        title: `${moments.length} new moments in ${name}`,
        body: `From ${firstAuthor} and ${others} ${plural(others, 'other', 'others')}.`,
        data: { url: updatesNotificationUrl(circleId) },
      });
    }
  }

  if (preferences.invites) {
    for (const event of events.invites) {
      if (muted.has(event.circleId)) continue;
      if (remoteInvites.has(event.circleId)) continue;
      const name = circleName(event.circleName);
      const owner = personName(event.ownerPubkey, event.ownerName, names);
      requests.push({
        channel: 'circles',
        title: `Invitation to ${name}`,
        body: `${owner} invited you.`,
        data: { url: circlesNotificationUrl() },
      });
    }
  }

  if (preferences.membership) {
    for (const event of events.membership) {
      if (muted.has(event.circleId)) continue;
      const name = circleName(event.circleName);
      const member = personName(event.memberPubkey, event.memberName, names);
      requests.push(
        event.kind === 'accepted'
          ? {
              channel: 'circles',
              title: `${member} joined ${name}`,
              body: 'Your circle has a new member.',
              data: { url: circlesNotificationUrl() },
            }
          : {
              channel: 'circles',
              title: `Removed from ${name}`,
              body: 'You are no longer a member.',
              data: { url: circlesNotificationUrl() },
            }
      );
    }
  }

  if (preferences.activity) {
    const groups = new Map<string, InboxSocialEvent[]>();
    for (const event of events.social) {
      if (event.actorPubkey === viewerPubkey) continue;
      if (muted.has(event.circleId)) continue;
      if (event.remoteId && remoteSocial.has(event.remoteId)) continue;
      const list = groups.get(event.vlogId) ?? [];
      list.push(event);
      groups.set(event.vlogId, list);
    }

    const ordered = [...groups.entries()].sort((left, right) => {
      const leftName = circleName(left[1][0]?.circleName);
      const rightName = circleName(right[1][0]?.circleName);
      if (leftName !== rightName) return leftName.localeCompare(rightName);
      return left[0].localeCompare(right[0]);
    });

    for (const [vlogId, responses] of ordered) {
      const name = circleName(responses[0]?.circleName);
      if (responses.length > 1) {
        requests.push({
          channel: 'social',
          title: `${responses.length} new responses`,
          body: `In ${name}.`,
          data: { url: commentsNotificationUrl(vlogId) },
        });
        continue;
      }

      const event = responses[0];
      const actor = personName(event.actorPubkey, null, names);
      if (event.kind === 'reply') {
        requests.push({
          channel: 'social',
          title: `${actor} replied to you`,
          body: `In ${name}.`,
          data: { url: commentsNotificationUrl(vlogId) },
        });
      } else if (event.kind === 'comment') {
        requests.push({
          channel: 'social',
          title: `${actor} commented on your moment`,
          body: `In ${name}.`,
          data: { url: commentsNotificationUrl(vlogId) },
        });
      } else {
        const emoji = clean(event.emoji);
        requests.push({
          channel: 'social',
          title: emoji ? `${actor} reacted ${emoji}` : `${actor} reacted`,
          body:
            event.targetType === 'comment'
              ? `To your comment in ${name}.`
              : `To your moment in ${name}.`,
          data: { url: commentsNotificationUrl(vlogId) },
        });
      }
    }
  }

  return requests;
}
