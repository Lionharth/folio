/**
 * Vlog list filtering kept free of the database module so it can be tested
 * without loading expo-sqlite.
 */
export interface ListVlogsOptions {
  authorPubkey?: string;
  circleId?: string | null;
  search?: string;
  favouritesOnly?: boolean;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

/** Builds the WHERE clause and matching bind parameters for a vlog list read. */
export function buildVlogListWhere(
  viewerPubkey: string,
  options: ListVlogsOptions = {}
): { where: string; params: (string | number)[] } {
  const clauses: string[] = ['viewer_pubkey = ?'];
  const params: (string | number)[] = [viewerPubkey];
  if (options.authorPubkey) {
    clauses.push('author_pubkey = ?');
    params.push(options.authorPubkey);
  }
  if (options.circleId) {
    clauses.push('circle_id = ?');
    params.push(options.circleId);
  }
  if (options.favouritesOnly) clauses.push('is_favourite = 1');
  if (options.unreadOnly) clauses.push('unread = 1');
  if (options.search?.trim()) {
    clauses.push('(LOWER(COALESCE(title, \'\')) LIKE ? OR LOWER(COALESCE(description, \'\')) LIKE ?)');
    const needle = `%${options.search.trim().toLowerCase()}%`;
    params.push(needle, needle);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}
