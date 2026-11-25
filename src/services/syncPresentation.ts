import type { InboxRefreshResult } from './inbox';

export type SyncContext = 'updates' | 'circles';
export type SyncTone = 'neutral' | 'success' | 'warning' | 'error';

export interface SyncPresentation {
  message: string;
  tone: SyncTone;
}

export function presentInboxSync(result: InboxRefreshResult, context: SyncContext): SyncPresentation {
  if (!result.anyRelaySucceeded) {
    return {
      message: "Couldn't refresh. Showing saved moments.",
      tone: 'error',
    };
  }

  const partial = !result.allRelaysComplete;
  let message: string;

  if (context === 'circles') {
    if (result.restored > 0) {
      message = `${result.restored} circle${result.restored === 1 ? '' : 's'} restored`;
    } else if (result.invites > 0) {
      message = `${result.invites} invitation${result.invites === 1 ? '' : 's'}`;
    } else if (result.accepted > 0) {
      message = 'Membership updated';
    } else {
      message = partial ? 'Partly refreshed' : 'No new invitations';
    }
  } else if (result.added > 0) {
    message = `${result.added} new ${result.added === 1 ? 'moment' : 'moments'}`;
  } else {
    message = partial ? 'Partly refreshed' : "You're up to date";
  }

  if (partial && message !== 'Partly refreshed') message += ' · partial';
  return { message, tone: partial ? 'warning' : 'success' };
}
