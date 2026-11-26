import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVlogListWhere } from '../src/lib/database/vlogQuery';

const viewer = 'a'.repeat(64);

test('viewer-only reads filter on the viewer key', () => {
  const { where, params } = buildVlogListWhere(viewer);
  assert.equal(where, 'WHERE viewer_pubkey = ?');
  assert.deepEqual(params, [viewer]);
});

test('author filter follows the viewer parameter', () => {
  const author = 'b'.repeat(64);
  const { where, params } = buildVlogListWhere(viewer, { authorPubkey: author });
  assert.equal(where, 'WHERE viewer_pubkey = ? AND author_pubkey = ?');
  assert.deepEqual(params, [viewer, author]);
});

test('clause and parameter order stay stable for combined filters', () => {
  const author = 'b'.repeat(64);
  const { where, params } = buildVlogListWhere(viewer, {
    authorPubkey: author,
    circleId: 'circle-1',
    favouritesOnly: true,
    unreadOnly: true,
    search: '  Summer Trip  ',
  });
  assert.equal(
    where,
    "WHERE viewer_pubkey = ? AND author_pubkey = ? AND circle_id = ? AND is_favourite = 1 AND unread = 1 AND (LOWER(COALESCE(title, '')) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ?)"
  );
  assert.deepEqual(params, [viewer, author, 'circle-1', '%summer trip%', '%summer trip%']);
});

test('unread only applies the flag without a search clause', () => {
  const { where, params } = buildVlogListWhere(viewer, { unreadOnly: true });
  assert.equal(where, 'WHERE viewer_pubkey = ? AND unread = 1');
  assert.deepEqual(params, [viewer]);
});

test('whitespace-only search adds no clause', () => {
  const { where, params } = buildVlogListWhere(viewer, { search: '   ' });
  assert.equal(where, 'WHERE viewer_pubkey = ?');
  assert.deepEqual(params, [viewer]);
});
