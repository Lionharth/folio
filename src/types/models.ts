export type CircleRole = 'owner' | 'admin' | 'member';
export type MemberStatus = 'invited' | 'active' | 'removed';
export type VlogState = 'draft' | 'uploading' | 'ready' | 'published' | 'failed';
export type ClipState = 'local' | 'uploading' | 'remote' | 'downloaded' | 'failed';

export interface Circle {
  id: string;
  ownerPubkey: string;
  name: string;
  description?: string | null;
  coverUri?: string | null;
  membershipVersion: number;
  createdAt: number;
  updatedAt: number;
  muted: boolean;
}

export interface CircleMember {
  circleId: string;
  pubkey: string;
  role: CircleRole;
  status: MemberStatus;
  joinedAt: number;
}

export interface ClipThumbnail {
  /** Encrypted FC1 blob URL for the JPEG cover. */
  url: string;
  sha256: string;
  encryptedSize: number;
  plaintextSha256?: string | null;
  plaintextSize?: number | null;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  /** Extra verified copies of the same encrypted cover. */
  mirrors?: string[] | null;
}

export interface Clip {
  id: string;
  vlogId: string;
  position: number;
  provider?: string | null;
  url?: string | null;
  mirrors?: string[] | null;
  encryptedSha256: string;
  plaintextSha256?: string | null;
  encryptedSize: number;
  plaintextSize?: number | null;
  durationMs: number;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  localUri?: string | null;
  thumbnail?: ClipThumbnail | null;
  state: ClipState;
  createdAt: number;
}

export interface Vlog {
  /** Local row id, scoped to the viewer identity. */
  id: string;
  viewerPubkey: string;
  remoteId: string;
  rumorId?: string | null;
  authorPubkey: string;
  circleId?: string | null;
  circleName?: string | null;
  title?: string | null;
  description?: string | null;
  coverUri?: string | null;
  createdAt: number;
  receivedAt: number;
  state: VlogState;
  unread: boolean;
  isFavourite: boolean;
  format?: string | null;
  clips?: Clip[];
}

export type ReactionTargetType = 'vlog' | 'comment';

export type ActivityKind =
  | 'comment'
  | 'reply'
  | 'reaction'
  | 'invite'
  | 'member-joined'
  | 'member-removed';

export interface Activity {
  id: string;
  viewerPubkey: string;
  kind: ActivityKind;
  actorPubkey: string;
  circleId?: string | null;
  circleName?: string | null;
  remoteVlogId?: string | null;
  localVlogId?: string | null;
  vlogTitle?: string | null;
  commentId?: string | null;
  targetCommentId?: string | null;
  targetType?: ReactionTargetType | null;
  emoji?: string | null;
  inviteId?: string | null;
  createdAt: number;
  receivedAt: number;
  readAt?: number | null;
}

export interface Comment {
  id: string;
  remoteVlogId: string;
  circleId: string;
  authorPubkey: string;
  body: string;
  replyToId?: string | null;
  createdAt: number;
  updatedAt: number;
  editedAt?: number | null;
  deletedAt?: number | null;
  placeholder?: boolean;
}

export interface Reaction {
  targetType: ReactionTargetType;
  targetId: string;
  remoteVlogId: string;
  circleId: string;
  authorPubkey: string;
  emoji: string;
  active: boolean;
  updatedAt: number;
}

export interface Draft {
  id: string;
  title?: string | null;
  description?: string | null;
  circleId?: string | null;
  coverUri?: string | null;
  createdAt: number;
  updatedAt: number;
  state: 'editing' | 'publishing' | 'published' | 'failed';
  clips?: DraftClip[];
}

export interface DraftClip {
  id: string;
  draftId: string;
  position: number;
  localUri: string;
  mimeType: string;
  durationMs: number;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
  createdAt: number;
}
