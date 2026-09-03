import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { pinsRpc } from "./contract.ts";
import { sortPins, type Pin } from "./order.ts";

async function listPinned(bb: BbPluginApi): Promise<Pin[]> {
  const page = await bb.sdk.threads.list({
    archived: false,
    includeHidden: true,
    limit: 1000,
  });
  const pins: Pin[] = [];
  for (const thread of page) {
    if (thread.pinnedAt === null) continue;
    pins.push({
      threadId: thread.id,
      title: thread.title ?? thread.titleFallback ?? "Untitled",
      pinSortKey: thread.pinSortKey,
      pinnedAt: thread.pinnedAt,
    });
  }
  return sortPins(pins);
}

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(pinsRpc, {
    pinned: () => listPinned(bb),
    async reorder({ threadId, previousThreadId, nextThreadId }) {
      await bb.sdk.threads.reorderPinned({
        threadId,
        previousThreadId,
        nextThreadId,
      });
      return listPinned(bb);
    },
    async create(request) {
      const req = request as Parameters<typeof bb.sdk.threads.spawn>[0];
      const sources = req.executionInputSources;
      // ponytail: BB's embedded composer can omit provider provenance; remove after get-bb/bb#2974.
      const spawnRequest =
        req.providerId && sources && !sources.providerId
          ? {
              ...req,
              executionInputSources: { ...sources, providerId: "explicit" as const },
            }
          : req;
      const thread = await bb.sdk.threads.spawn({
        ...spawnRequest,
        origin: "plugin",
      });
      await bb.sdk.threads.pin({ threadId: thread.id });
      const rest = (await listPinned(bb)).find((pin) => pin.threadId !== thread.id);
      await bb.sdk.threads.reorderPinned({
        threadId: thread.id,
        previousThreadId: null,
        nextThreadId: rest?.threadId ?? null,
      });
      return listPinned(bb);
    },
    async unpin(threadId) {
      await bb.sdk.threads.unpin({ threadId });
      return listPinned(bb);
    },
    async gitStats({ environmentIds }) {
      const rows = await Promise.all(
        [...new Set(environmentIds)].map(async (environmentId) => {
          try {
            const status = await bb.sdk.environments.status({ environmentId });
            if (status.outcome !== "available") return null;
            const base = status.workspace.mergeBase;
            const working = status.workspace.workingTree;
            return {
              environmentId,
              insertions: (base?.insertions ?? 0) + working.insertions,
              deletions: (base?.deletions ?? 0) + working.deletions,
              ahead: base?.aheadCount ?? 0,
              behind: base?.behindCount ?? 0,
              dirty: working.hasUncommittedChanges,
            };
          } catch (error) {
            bb.log.warn(`git status unavailable for ${environmentId}: ${String(error)}`);
            return null;
          }
        }),
      );
      return { rows: rows.filter((row) => row !== null) };
    },
  });
}
