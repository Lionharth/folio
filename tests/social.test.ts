import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCommentThreads,
  isCommentIdForAuthor,
  isNewerOp,
  isParticipatingStatus,
  normalizeCommentBody,
  normalizeEmoji,
  summarizeReactions,
  type CommentRecord,
} from '../src/lib/social/rules';

function comment(overrides: Partial<CommentRecord> & Pick<CommentRecord, 'id'>): CommentRecord {
  const { id, ...rest } = overrides;
  return {
    id,
    remoteVlogId: 'vlog-1',
    circleId: 'circle-1',
    authorPubkey: 'a'.repeat(64),
    body: id,
    replyToId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    editedAt: null,
    deletedAt: null,
    placeholder: false,
    ...rest,
  };
}

test('participation and comment-id ownership are explicit', () => {
  assert.equal(isParticipatingStatus('active'), true);
  assert.equal(isParticipatingStatus('invited'), true);
  assert.equal(isParticipatingStatus('removed'), false);
  assert.equal(isParticipatingStatus(undefined), false);

  const author = 'abcdef0123' + 'a'.repeat(54);
  const other = '0123456789' + 'b'.repeat(54);
  assert.equal(isCommentIdForAuthor(`${author.slice(0, 10)}-comment`, author), true);
  assert.equal(isCommentIdForAuthor(`${other.slice(0, 10)}-comment`, author), false);
  assert.equal(isCommentIdForAuthor(`${author.slice(0, 10)}-`, author), false);
});

test('operations are ordered by timestamp and then op id', () => {
  assert.equal(isNewerOp({ at: 2, opId: 'a' }, { at: 1, opId: 'z' }), true);
  assert.equal(isNewerOp({ at: 1, opId: 'b' }, { at: 1, opId: 'a' }), true);
  assert.equal(isNewerOp({ at: 1, opId: 'a' }, { at: 1, opId: 'a' }), false);
  assert.equal(isNewerOp({ at: 1, opId: 'a' }, { at: 2, opId: 'z' }), false);
  assert.equal(isNewerOp({ at: 1, opId: 'a' }, null), true);
});

test('comment bodies are normalised and bounded', () => {
  assert.equal(normalizeCommentBody('  hello\r\nworld  '), 'hello\nworld');
  assert.equal(normalizeCommentBody('\n\n'), null);
  assert.equal(normalizeCommentBody('x'.repeat(1001)), null);
  assert.equal(normalizeCommentBody('hello\u0000world'), 'helloworld');
  assert.equal(normalizeCommentBody('hello\u0007world'), null);
  assert.equal(normalizeCommentBody(42), null);
});

test('emoji validation accepts emoji and rejects text', () => {
  assert.equal(normalizeEmoji(' \u2764\ufe0f '), '\u2764\ufe0f');
  assert.equal(normalizeEmoji('\ud83d\udd25'), '\ud83d\udd25');
  assert.equal(normalizeEmoji('\ud83c\uddec\ud83c\udde7'), '\ud83c\uddec\ud83c\udde7');
  assert.equal(normalizeEmoji('\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67'), '\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67');
  assert.equal(normalizeEmoji('hello'), null);
  assert.equal(normalizeEmoji('heart'), null);
  assert.equal(normalizeEmoji('1'), null);
  assert.equal(normalizeEmoji('\ud83d\udd25 \ud83d\udd25'), null);
  assert.equal(normalizeEmoji('\ud83d\udd25'.repeat(20)), null);
});

test('one-level threads attach replies to the nearest root', () => {
  const root = comment({ id: 'root', createdAt: 1 });
  const reply = comment({ id: 'reply', replyToId: 'root', createdAt: 2 });
  const nested = comment({ id: 'nested', replyToId: 'reply', createdAt: 3 });
  const threads = buildCommentThreads([nested, reply, root]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, 'root');
  assert.deepEqual(threads[0].replies.map((entry) => entry.id), ['reply', 'nested']);
  assert.equal(threads[0].replies[1].replyToId, 'reply');
});

test('missing parents become roots and placeholders stay hidden', () => {
  const orphan = comment({ id: 'orphan', replyToId: 'missing', createdAt: 3 });
  const child = comment({ id: 'child', replyToId: 'orphan', createdAt: 4 });
  const placeholder = comment({ id: 'placeholder', placeholder: true, createdAt: 2 });
  const secondRoot = comment({ id: 'second', createdAt: 1 });
  const threads = buildCommentThreads([orphan, child, placeholder, secondRoot]);
  assert.deepEqual(threads.map((entry) => entry.id), ['second', 'orphan']);
  assert.equal(threads[1].missingParent, true);
  assert.deepEqual(threads[1].replies.map((entry) => entry.id), ['child']);
});

test('reaction summaries count members and preserve first-seen order', () => {
  const summary = summarizeReactions(
    [
      { emoji: '\u2764\ufe0f', authorPubkey: 'a'.repeat(64), active: true, updatedAt: 10 },
      { emoji: '\u2764\ufe0f', authorPubkey: 'b'.repeat(64), active: true, updatedAt: 20 },
      { emoji: '\ud83d\udd25', authorPubkey: 'a'.repeat(64), active: true, updatedAt: 5 },
      { emoji: '\ud83d\udd25', authorPubkey: 'c'.repeat(64), active: false, updatedAt: 1 },
    ],
    'a'.repeat(64)
  );
  assert.deepEqual(summary, [
    { emoji: '\ud83d\udd25', count: 1, mine: true, firstAt: 5 },
    { emoji: '\u2764\ufe0f', count: 2, mine: true, firstAt: 10 },
  ]);
});
