import type { Activity } from '../../types/models';

export const FALLBACK_ACTOR_NAME = 'Someone';
export const FALLBACK_CIRCLE_NAME = 'a circle';
export const FALLBACK_MOMENT_NAME = 'a moment';

export interface ActivityCopyContext {
  actorName: string;
  circleName?: string | null;
  vlogTitle?: string | null;
}

export interface ActivityCopy {
  title: string;
  subtitle: string;
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? collapsed : null;
}

export function activityCopy(activity: Activity, context: ActivityCopyContext): ActivityCopy {
  const actor = clean(context.actorName) ?? FALLBACK_ACTOR_NAME;
  const circle = clean(context.circleName ?? activity.circleName) ?? FALLBACK_CIRCLE_NAME;
  const moment = clean(context.vlogTitle ?? activity.vlogTitle) ?? FALLBACK_MOMENT_NAME;

  switch (activity.kind) {
    case 'reply':
      return { title: `${actor} replied to you`, subtitle: `${moment} · ${circle}` };
    case 'comment':
      return {
        title: `${actor} commented on your moment`,
        subtitle: `${moment} · ${circle}`,
      };
    case 'reaction': {
      const emoji = clean(activity.emoji);
      return {
        title: emoji ? `${actor} reacted ${emoji}` : `${actor} reacted`,
        subtitle: `${activity.targetType === 'comment' ? 'your comment' : 'your moment'} · ${moment} · ${circle}`,
      };
    }
    case 'invite':
      return { title: `${actor} invited you to ${circle}`, subtitle: 'Invitation' };
    case 'member-joined':
      return { title: `${actor} joined ${circle}`, subtitle: 'Membership' };
    case 'member-removed':
      return { title: `You were removed from ${circle}`, subtitle: 'Membership' };
    default:
      return { title: 'New activity', subtitle: circle };
  }
}
