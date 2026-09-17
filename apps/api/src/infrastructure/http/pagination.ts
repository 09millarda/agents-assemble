export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export interface PagePagination {
  nextCursor: string | null;
  limit: number;
}

export interface Page<T> {
  data: T[];
  pagination: PagePagination;
}

export function encodeCursor(lastId: string): string {
  return Buffer.from(lastId, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): string | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!decoded || encodeCursor(decoded) !== cursor) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function isCursorValid(cursor: string): boolean {
  return decodeCursor(cursor) !== null;
}

export function paginateById<T>(sortedItems: T[], pickId: (item: T) => string, limit: number, cursor: string | null): Page<T> {
  const lastSeenId = cursor ? decodeCursor(cursor) : null;
  const remaining =
    lastSeenId === null ? sortedItems : sortedItems.filter((item) => pickId(item) > lastSeenId);
  const data = remaining.slice(0, limit);
  const hasMore = remaining.length > data.length;
  return {
    data,
    pagination: {
      nextCursor: hasMore && data.length > 0 ? encodeCursor(pickId(data[data.length - 1])) : null,
      limit,
    },
  };
}
