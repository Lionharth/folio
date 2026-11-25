import type { QueryClient } from '@tanstack/react-query';

export const queryKeys = {
  circles: (viewerPubkey?: string) => ['circles', viewerPubkey] as const,
  circlesWithMembers: (viewerPubkey?: string) => ['circles-with-members', viewerPubkey] as const,
  circle: (viewerPubkey: string | undefined, circleId: string) => ['circle', viewerPubkey, circleId] as const,
  invites: (viewerPubkey?: string) => ['circle-invites', viewerPubkey] as const,
  member: (viewerPubkey: string | undefined, circleId?: string | null) =>
    ['circle-member', viewerPubkey, circleId] as const,
  contacts: ['contact-names'] as const,
  contact: (pubkey?: string) => ['contact-name', pubkey] as const,
  vlogs: (viewerPubkey?: string) => ['vlogs', viewerPubkey] as const,
  vlog: (viewerPubkey: string | undefined, vlogId: string) => ['vlogs', viewerPubkey, 'detail', vlogId] as const,
  comments: (viewerPubkey?: string) => ['comments', viewerPubkey] as const,
  reactions: (viewerPubkey?: string) => ['reactions', viewerPubkey] as const,
  commentReactions: (viewerPubkey?: string) => ['comment-reactions', viewerPubkey] as const,
};

export async function invalidateVlogs(queryClient: QueryClient, viewerPubkey?: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.vlogs(viewerPubkey) });
}

export async function invalidateCircles(queryClient: QueryClient, viewerPubkey?: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['circles', viewerPubkey] }),
    queryClient.invalidateQueries({ queryKey: ['circles-with-members', viewerPubkey] }),
    queryClient.invalidateQueries({ queryKey: ['circle', viewerPubkey] }),
    queryClient.invalidateQueries({ queryKey: ['circle-member', viewerPubkey] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.invites(viewerPubkey) }),
  ]);
}

export async function invalidateSocial(queryClient: QueryClient, viewerPubkey?: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.comments(viewerPubkey) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.reactions(viewerPubkey) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.commentReactions(viewerPubkey) }),
  ]);
}

export async function invalidateAfterInbox(queryClient: QueryClient, viewerPubkey: string): Promise<void> {
  await Promise.all([
    invalidateCircles(queryClient, viewerPubkey),
    invalidateVlogs(queryClient, viewerPubkey),
    invalidateSocial(queryClient, viewerPubkey),
    queryClient.invalidateQueries({ queryKey: queryKeys.contacts }),
    queryClient.invalidateQueries({ queryKey: ['contact-name'] }),
  ]);
}
