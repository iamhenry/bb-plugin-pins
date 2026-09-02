import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fillColumnWidth,
  neighbors,
  reorderIds,
  sortPins,
  type Pin,
} from "./order.ts";

test("sortPins uses pinSortKey then pinnedAt, not recency", () => {
  const pins: Pin[] = [
    { threadId: "c", title: "c", pinSortKey: "b", pinnedAt: 3 },
    { threadId: "a", title: "a", pinSortKey: "a", pinnedAt: 9 },
    { threadId: "b", title: "b", pinSortKey: "a", pinnedAt: 1 },
  ];
  assert.deepEqual(
    sortPins(pins).map((p) => p.threadId),
    ["b", "a", "c"],
  );
});

test("reorderIds places a column in an original-list slot", () => {
  assert.deepEqual(reorderIds(["a", "b", "c"], "a", 3), ["b", "c", "a"]);
  assert.deepEqual(reorderIds(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
  assert.deepEqual(reorderIds(["a", "b", "c"], "a", 2), ["b", "a", "c"]);
});

test("fillColumnWidth stretches leftover space, packs when overflowing", () => {
  assert.equal(fillColumnWidth(2000, 4, 360), 500);
  assert.equal(fillColumnWidth(1080, 12, 360), 360);
});

test("neighbors after a reorder feed reorderPinned", () => {
  const ids = reorderIds(["a", "b", "c"], "c", 0);
  assert.deepEqual(neighbors(ids, "c"), {
    previousThreadId: null,
    nextThreadId: "a",
  });
});
