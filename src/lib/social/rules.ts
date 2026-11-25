export const MAX_COMMENT_LENGTH = 1000;
export const MAX_SOCIAL_ID_LENGTH = 120;
export const MAX_DISPLAY_NAME_LENGTH = 40;
export const MAX_EMOJI_CODE_POINTS = 16;
export const MAX_EMOJI_UTF16_LENGTH = 64;
export const MAX_REACTIONS_PER_TARGET = 20;

const EMOJI_RANGES: [number, number][] = [
  [0x1f000, 0x1faff],
  [0x2190, 0x21ff],
  [0x2300, 0x23ff],
  [0x25a0, 0x25ff],
  [0x2600, 0x27bf],
  [0x2934, 0x2935],
  [0x2b00, 0x2bff],
  [0x3030, 0x3030],
  [0x303d, 0x303d],
  [0x3297, 0x3299],
];

export interface OpOrder {
  at: number;
  opId: string;
}

export function isNewerOp(candidate: OpOrder, current: OpOrder | null | undefined): boolean {
  if (!current) return true;
  if (candidate.at !== current.at) return candidate.at > current.at;
  return candidate.opId > current.opId;
}

export function isParticipatingStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'invited';
}

export function isCommentIdForAuthor(commentId: string, authorPubkey: string): boolean {
  return commentId.startsWith(`${authorPubkey.slice(0, 10)}-`) && commentId.length > 11;
}

export function normalizeSocialId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_SOCIAL_ID_LENGTH) return null;
  if (value.trim() !== value) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

export function normalizeCommentBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  if (cleaned.length === 0 || cleaned.length > MAX_COMMENT_LENGTH) return null;
  if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned)) return null;
  return cleaned;
}

export function normalizeSocialName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0 || cleaned.length > MAX_DISPLAY_NAME_LENGTH) return null;
  return cleaned;
}

function isPictographicCodePoint(codePoint: number): boolean {
  return EMOJI_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

export function normalizeEmoji(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.normalize('NFC').trim();
  if (cleaned.length === 0 || cleaned.length > MAX_EMOJI_UTF16_LENGTH) return null;
  const points = Array.from(cleaned);
  if (points.length === 0 || points.length > MAX_EMOJI_CODE_POINTS) return null;
  if (/\s/.test(cleaned) || /[A-Za-z0-9]/.test(cleaned)) return null;
  if (!points.some((point) => isPictographicCodePoint(point.codePointAt(0) ?? 0))) return null;
  return cleaned;
}

export function normalizeAt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

export interface CommentRecord {
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

export interface ThreadedComment extends CommentRecord {
  replies: ThreadedComment[];
  missingParent: boolean;
}

function compareComments(a: CommentRecord, b: CommentRecord): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

function threadRoot(comment: CommentRecord, byId: Map<string, CommentRecord>): CommentRecord {
  let current = comment;
  const seen = new Set<string>([comment.id]);
  for (;;) {
    const parentId = current.replyToId;
    if (!parentId) return current;
    const parent = byId.get(parentId);
    if (!parent) return current;
    if (seen.has(parent.id)) return comment;
    seen.add(parent.id);
    current = parent;
  }
}

export function buildCommentThreads(comments: CommentRecord[]): ThreadedComment[] {
  const visible = comments.filter((comment) => !comment.placeholder);
  const byId = new Map(visible.map((comment) => [comment.id, comment]));
  const roots = new Map<string, ThreadedComment>();
  const ordered = [...visible].sort(compareComments);

  for (const comment of ordered) {
    const root = threadRoot(comment, byId);
    if (root.id === comment.id) {
      roots.set(comment.id, {
        ...comment,
        replies: [],
        missingParent: Boolean(comment.replyToId && !byId.has(comment.replyToId)),
      });
    }
  }

  for (const comment of ordered) {
    const root = threadRoot(comment, byId);
    if (root.id === comment.id) continue;
    const node = roots.get(root.id);
    if (!node) continue;
    node.replies.push({
      ...comment,
      replies: [],
      missingParent: Boolean(comment.replyToId && !byId.has(comment.replyToId)),
    });
  }

  return [...roots.values()].sort(compareComments);
}

export interface ReactionRecord {
  emoji: string;
  authorPubkey: string;
  active: boolean;
  updatedAt?: number;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
  firstAt: number;
}

export function summarizeReactions(
  reactions: ReactionRecord[],
  selfPubkey: string | null | undefined
): ReactionSummary[] {
  const groups = new Map<string, { count: number; mine: boolean; firstAt: number }>();
  for (const reaction of reactions) {
    if (!reaction.active) continue;
    const current = groups.get(reaction.emoji);
    if (current) {
      current.count += 1;
      current.mine = current.mine || reaction.authorPubkey === selfPubkey;
      current.firstAt = Math.min(current.firstAt, reaction.updatedAt ?? current.firstAt);
    } else {
      groups.set(reaction.emoji, {
        count: 1,
        mine: reaction.authorPubkey === selfPubkey,
        firstAt: reaction.updatedAt ?? Number.MAX_SAFE_INTEGER,
      });
    }
  }
  return [...groups.entries()]
    .map(([emoji, value]) => ({ emoji, ...value }))
    .sort((a, b) => (a.firstAt !== b.firstAt ? a.firstAt - b.firstAt : a.emoji.localeCompare(b.emoji)));
}
