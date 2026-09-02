export type Pin = {
  threadId: string;
  title: string;
  pinSortKey: string | null;
  pinnedAt: number;
};

/** Stretch columns to fill the viewport; overflow keeps `desired` packing. */
export function fillColumnWidth(
  viewport: number,
  count: number,
  desired: number,
  min = 280,
): number {
  const w = Math.max(desired, min);
  if (viewport <= 0 || count <= 0) return w;
  const visible = Math.min(count, Math.max(1, Math.floor(viewport / w)));
  return viewport / visible;
}

/** Server pin order, then pin time. Never recency. */
export function sortPins(pins: readonly Pin[]): Pin[] {
  return [...pins].sort((a, b) => {
    const keys = (a.pinSortKey ?? "").localeCompare(b.pinSortKey ?? "");
    if (keys !== 0) return keys;
    if (a.pinnedAt !== b.pinnedAt) return a.pinnedAt - b.pinnedAt;
    return a.threadId.localeCompare(b.threadId);
  });
}

/** `insertAt` is a slot in the current id list (0..length), same as Cascade. */
export function reorderIds(
  ids: readonly string[],
  threadId: string,
  insertAt: number,
): string[] {
  const next = [...ids];
  const from = next.indexOf(threadId);
  if (from < 0) return next;
  next.splice(from, 1);
  next.splice(from < insertAt ? insertAt - 1 : insertAt, 0, threadId);
  return next;
}

export function neighbors(ids: readonly string[], threadId: string) {
  const i = ids.indexOf(threadId);
  return {
    previousThreadId: i > 0 ? (ids[i - 1] ?? null) : null,
    nextThreadId: i >= 0 && i < ids.length - 1 ? (ids[i + 1] ?? null) : null,
  };
}
