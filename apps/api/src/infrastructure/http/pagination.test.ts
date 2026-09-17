import { describe, expect, test } from "bun:test";
import { decodeCursor, encodeCursor, isCursorValid, paginateById } from "./pagination";

describe("cursor pagination", () => {
  test("encodes and decodes an opaque cursor", () => {
    const cursor = encodeCursor("daemon-9");
    expect(cursor).not.toContain("daemon-9");
    expect(decodeCursor(cursor)).toBe("daemon-9");
  });

  test("rejects tampered cursors", () => {
    expect(decodeCursor("!!!not-base64!!!")).toBeNull();
    expect(isCursorValid("!!!not-base64!!!")).toBe(false);
    expect(isCursorValid(encodeCursor("daemon-1"))).toBe(true);
  });

  test("pages by stable id order with a next cursor", () => {
    const items = [{ daemonId: "a" }, { daemonId: "b" }, { daemonId: "c" }];
    const first = paginateById(items, (item) => item.daemonId, 2, null);
    expect(first).toEqual({ data: [{ daemonId: "a" }, { daemonId: "b" }], pagination: { nextCursor: encodeCursor("b"), limit: 2 } });

    const second = paginateById(items, (item) => item.daemonId, 2, first.pagination.nextCursor);
    expect(second).toEqual({ data: [{ daemonId: "c" }], pagination: { nextCursor: null, limit: 2 } });
  });
});
