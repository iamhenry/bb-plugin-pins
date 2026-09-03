import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import {
  definePluginApp,
  experimental_NewThreadComposer,
  experimental_useProviders,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreads,
  ThreadChat,
  useBbContext,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import { pinsRpc } from "./contract.ts";
import { fillColumnWidth, neighbors, reorderIds, type Pin } from "./order.ts";
import "./styles.css";

const COL_MIN = 280;
const COL_DEFAULT = 360;

// Lowercase JSX names parse as intrinsic elements; alias for <NewThreadComposer/>.
const NewThreadComposer = experimental_NewThreadComposer;

// Shared flag between the header + button and the PinsPanel composer column.
// Module-level (not localStorage) so it survives neither reloads nor need to.
let composingListeners = new Set<() => void>();
let composingCount = 0;
function setComposing(next: boolean) {
  if (next === (composingCount > 0)) return;
  composingCount = next ? 1 : 0;
  for (const listener of composingListeners) listener();
}
function subscribeComposing(listener: () => void) {
  composingListeners.add(listener);
  return () => composingListeners.delete(listener);
}
function useComposing(): boolean {
  return useSyncExternalStore(subscribeComposing, () => composingCount > 0);
}

// Same active set as dashboard-sidebar.
const ACTIVE_INDICATORS = new Set([
  "background-agent",
  "background-command",
  "draft",
  "goal",
  "plan-mode",
  "runtime",
  "workflow",
  "working-draft",
]);

interface ProviderInfo {
  id: string;
  displayName: string;
  logoUrl: string | null;
  strings?: { iconTint?: { light: string; dark: string } };
}

interface GitStats {
  environmentId: string;
  insertions: number;
  deletions: number;
  ahead: number;
  behind: number;
  dirty: boolean;
}

function isWorking(thread: PluginSidebarThread): boolean {
  return (
    ACTIVE_INDICATORS.has(thread.indicator) ||
    Object.values(thread.activity).some((count) => count > 0)
  );
}

function formatRelative(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatElapsed(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function ProviderGlyph({ provider }: { provider: ProviderInfo | undefined }) {
  const label = provider?.displayName || provider?.id || "Agent";
  const logoUrl = provider?.logoUrl ?? (provider?.id === "acp-opencode" ? "/api/v1/system/providers/opencode/logo" : null);
  const tint = provider?.strings?.iconTint;
  return (
    <span className="pins-provider" role="img" aria-label={label} title={label}>
      {logoUrl ? (
        <span
          className="pins-provider-logo"
          aria-hidden="true"
          style={{
            "--pins-provider-logo-light": tint?.light ?? "var(--muted-foreground)",
            "--pins-provider-logo-dark": tint?.dark ?? "var(--muted-foreground)",
            maskImage: `url("${logoUrl}")`,
            WebkitMaskImage: `url("${logoUrl}")`,
          } as CSSProperties}
        />
      ) : (
        <span aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

function ThreadSubline({
  thread,
  provider,
  projectName,
  working,
  elapsedFrom,
  now,
}: {
  thread: PluginSidebarThread;
  provider: ProviderInfo | undefined;
  projectName: string | undefined;
  working: boolean;
  elapsedFrom: number;
  now: number;
}) {
  const { pullRequest } = experimental_useSidebarThreadPullRequest(thread.id);
  const branch = thread.environment?.branchName || thread.environment?.name || thread.host?.name;
  let lead;
  if (pullRequest) {
    lead = (
      <a
        className={`pins-pr pins-pr-${pullRequest.state}`}
        href={pullRequest.url}
        target="_blank"
        rel="noreferrer"
        title={pullRequest.title}
        onClick={(event) => event.stopPropagation()}
      >
        PR #{pullRequest.number} {pullRequest.state}
      </a>
    );
  } else if (branch) {
    lead = <span className="pins-branch" title={branch}>⑂ {branch}</span>;
  }
  const attention = thread.hasPendingInteraction ? "Needs input" : thread.isUnread ? "Unread" : null;

  return (
    <div className="pins-meta">
      <span className="pins-status-wrap" aria-label={thread.indicatorLabel ?? "Thread idle"}>
        <ProviderGlyph provider={provider} />
        <span className={`pins-status pins-status-${thread.indicator}`} />
      </span>
      {projectName ? <span className="pins-meta-project" title={projectName}>{projectName}</span> : null}
      {lead ? <span className="pins-meta-lead">{lead}</span> : null}
      {attention ? <span className="pins-meta-attention pins-attention">{attention}</span> : null}
      <span className={`pins-meta-time ${working ? "pins-active" : ""}`}>
        {working ? formatElapsed(elapsedFrom, now) : formatRelative(thread.updatedAt, now)}
      </span>
    </div>
  );
}

function PinsCount() {
  const sidebar = experimental_useSidebarThreads();
  const n = sidebar.threads.filter((thread) => thread.isPinned).length;
  return (
    <span className="tabular-nums text-xs text-muted-foreground">{n}</span>
  );
}

function PinsPanel() {
  const rpc = useRpc<typeof pinsRpc>();
  const sidebar = experimental_useSidebarThreads();
  const providerDirectory = experimental_useProviders();
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [gitRows, setGitRows] = useState<GitStats[]>([]);
  const [now, setNow] = useState(Date.now);
  const [viewport, setViewport] = useState(0);
  const [columnWidth, setColumnWidth] = useState(COL_DEFAULT);
  const composing = useComposing();
  const stripRef = useRef<HTMLDivElement | null>(null);
  const seenRef = useRef<Set<string> | null>(null);

  const pinKey = sidebar.threads
    .filter((thread) => thread.isPinned)
    .map((thread) => thread.id)
    .join(",");

  const refresh = useCallback(async () => {
    const ordered = await rpc.call("pinned", null);
    const have = new Set(ordered.map((pin) => pin.threadId));
    const extra = sidebar.threads
      .filter((thread) => thread.isPinned && !have.has(thread.id))
      .map((thread) => ({
        threadId: thread.id,
        title: thread.title ?? "Untitled",
        pinSortKey: null,
        pinnedAt: 0,
      }));
    const merged = extra.length ? [...ordered, ...extra] : ordered;
    const seen = seenRef.current;
    if (seen === null) {
      seenRef.current = new Set(merged.map((pin) => pin.threadId));
      setPins(merged);
      return;
    }
    const newcomers = merged.filter((pin) => !seen.has(pin.threadId));
    seenRef.current = new Set(merged.map((pin) => pin.threadId));
    if (newcomers.length === 0) {
      setPins(merged);
      return;
    }
    const newest = newcomers.reduce((a, b) =>
      a.pinnedAt >= b.pinnedAt ? a : b,
    );
    const ids = [
      newest.threadId,
      ...merged.map((pin) => pin.threadId).filter((id) => id !== newest.threadId),
    ];
    const { previousThreadId, nextThreadId } = neighbors(ids, newest.threadId);
    try {
      setPins(
        await rpc.call("reorder", {
          threadId: newest.threadId,
          previousThreadId,
          nextThreadId,
        }),
      );
    } catch {
      setPins(ids.map((id) => merged.find((pin) => pin.threadId === id)!));
    }
  }, [rpc, pinKey]);

  useEffect(() => {
    void refresh();
  }, [refresh, pinKey]);

  const threadById = useMemo(
    () => new Map(sidebar.threads.map((thread) => [thread.id, thread])),
    [sidebar.threads],
  );
  const providerById = useMemo(
    () =>
      new Map(
        (providerDirectory.status === "ready" ? providerDirectory.providers : []).map(
          (provider) => [provider.id, provider],
        ),
      ),
    [providerDirectory],
  );
  const projectNameById = useMemo(
    () => new Map(sidebar.projects.map((project) => [project.id, project.name])),
    [sidebar.projects],
  );
  const gitByEnvironment = useMemo(
    () => new Map(gitRows.map((row) => [row.environmentId, row])),
    [gitRows],
  );
  const anyWorking = sidebar.threads.some(isWorking);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), anyWorking ? 1_000 : 60_000);
    return () => window.clearInterval(timer);
  }, [anyWorking]);

  const environmentIds = useMemo(
    () => [...new Set(sidebar.threads.flatMap((thread) => thread.environment?.id ? [thread.environment.id] : []))],
    [sidebar.threads],
  );
  const environmentKey = environmentIds.join("\u0000");
  useEffect(() => {
    if (environmentIds.length === 0) {
      setGitRows([]);
      return;
    }
    const load = () => {
      void rpc.call("gitStats", { environmentIds }).then((result) => setGitRows(result.rows)).catch(() => undefined);
    };
    load();
    if (!anyWorking) return;
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [anyWorking, environmentKey, rpc]);

  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    stripRef.current = node;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setViewport(width);
    });
    observer.observe(node);
    setViewport(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const create = useCallback(
    async (request: unknown) => {
      await rpc.call("create", request);
      setComposing(false);
    },
    [rpc],
  );

  const move = useCallback(
    async (threadId: string, insertAt: number) => {
      if (!pins) return;
      const ids = reorderIds(
        pins.map((pin) => pin.threadId),
        threadId,
        insertAt,
      );
      const { previousThreadId, nextThreadId } = neighbors(ids, threadId);
      setPins(ids.map((id) => pins.find((pin) => pin.threadId === id)!));
      try {
        setPins(
          await rpc.call("reorder", {
            threadId,
            previousThreadId,
            nextThreadId,
          }),
        );
      } catch {
        await refresh();
      }
    },
    [pins, rpc, refresh],
  );

  const unpin = useCallback(
    async (threadId: string) => {
      seenRef.current?.delete(threadId);
      setPins((current) =>
        current ? current.filter((pin) => pin.threadId !== threadId) : current,
      );
      try {
        setPins(await rpc.call("unpin", threadId));
      } catch {
        await refresh();
      }
    },
    [rpc, refresh],
  );

  if (pins === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading pins…
      </div>
    );
  }

  const width =
    viewport > 0
      ? fillColumnWidth(viewport, pins.length + (composing ? 1 : 0), columnWidth, COL_MIN)
      : columnWidth;

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
    <div
      ref={viewportRef}
      className="absolute inset-0 overflow-x-auto overflow-y-hidden"
    >
      {viewport > 0 ? (
        <div className="flex h-full min-h-0">
          {composing ? (
            <ComposeColumn width={width} onCreate={create} />
          ) : null}
          {pins.map((pin, index) => {
            const thread = threadById.get(pin.threadId);
            return (
              <PinColumn
                key={pin.threadId}
                pin={pin}
                thread={thread}
                provider={thread ? providerById.get(thread.providerId) : undefined}
                projectName={thread ? projectNameById.get(thread.projectId) : undefined}
                git={thread?.environment?.id ? gitByEnvironment.get(thread.environment.id) : undefined}
                now={now}
                index={index}
                width={width}
                strip={stripRef}
                onMove={move}
                onResize={setColumnWidth}
                onUnpin={unpin}
              />
            );
          })}
        </div>
      ) : null}
    </div>
    </div>
  );
}

function PinColumn({
  pin,
  thread,
  provider,
  projectName,
  git,
  now,
  index,
  width,
  strip,
  onMove,
  onResize,
  onUnpin,
}: {
  pin: Pin;
  thread: PluginSidebarThread | undefined;
  provider: ProviderInfo | undefined;
  projectName: string | undefined;
  git: GitStats | undefined;
  now: number;
  index: number;
  width: number;
  strip: RefObject<HTMLDivElement | null>;
  onMove: (threadId: string, insertAt: number) => void;
  onResize: (width: number) => void;
  onUnpin: (threadId: string) => void;
}) {
  const articleRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = articleRef.current;
    const root = strip.current;
    if (!node || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { root, rootMargin: "50%" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [strip]);

  const navigate = useBbNavigate();
  const working = thread ? isWorking(thread) : false;
  const elapsedFrom = thread ? thread.updatedAt : now;
  const title = thread ? thread.title?.trim() || thread.titleFallback?.trim() || "Untitled" : pin.title;

  return (
    <article
      ref={articleRef}
      data-column
      data-bb-thread-id={pin.threadId}
      data-index={index}
      className={`relative flex h-full min-h-0 max-h-full shrink-0 flex-col overflow-hidden border-r border-border ${working ? "pins-working" : ""}`}
      style={{ width, flexBasis: width }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const threadId = event.dataTransfer.getData("text/pin-id");
        if (!threadId || threadId === pin.threadId) return;
        const box = event.currentTarget.getBoundingClientRect();
        const after = event.clientX > box.left + box.width / 2;
        onMove(threadId, after ? index + 1 : index);
      }}
    >
      <div
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("text/pin-id", pin.threadId);
          event.dataTransfer.effectAllowed = "move";
        }}
        className="flex shrink-0 cursor-grab flex-col gap-0.5 border-b border-border px-3 py-1.5 pr-4 active:cursor-grabbing"
        title="Drag to reorder"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="pins-title min-w-0 flex-1 truncate text-sm">{title}</span>
          {git && (git.insertions > 0 || git.deletions > 0) ? (
            <span
              className="pins-diff"
              title={`${git.dirty ? "Working tree and branch" : "Branch"} changes${git.ahead ? ` · ${git.ahead} ahead` : ""}${git.behind ? ` · ${git.behind} behind` : ""}`}
            >
              <b>+{git.insertions}</b> <i>−{git.deletions}</i>
            </span>
          ) : null}
          <button
            type="button"
            className="shrink-0 text-xs font-normal text-muted-foreground hover:text-foreground"
            title="Open thread"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              navigate.toThread(pin.threadId);
            }}
          >
            Open
          </button>
          <button
            type="button"
            className="shrink-0 text-xs font-normal text-muted-foreground hover:text-foreground"
            title="Unpin"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onUnpin(pin.threadId);
            }}
          >
            Unpin
          </button>
        </div>
        {thread ? (
          <ThreadSubline
            thread={thread}
            provider={provider}
            projectName={projectName}
            working={working}
            elapsedFrom={elapsedFrom}
            now={now}
          />
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {visible ? (
          <ThreadChat
            threadId={pin.threadId}
            variant="full"
            layout="contained"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-sm text-muted-foreground">
            {pin.title}
          </div>
        )}
      </div>
      <div
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize hover:bg-foreground/20"
        title="Drag to resize"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const startX = event.clientX;
          const startW = width;
          const move = (next: PointerEvent) => {
            onResize(Math.max(COL_MIN, startW + (next.clientX - startX)));
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
    </article>
  );
}

function ComposeColumn({
  width,
  onCreate,
}: {
  width: number;
  onCreate: (request: unknown) => Promise<void>;
}) {
  const { projectId } = useBbContext();
  const [busy, setBusy] = useState(false);
  return (
    <article
      data-column
      className="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-border"
      style={{ width, flexBasis: width }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <span className="pins-title min-w-0 truncate text-sm">New thread</span>
        <button
          type="button"
          className="shrink-0 text-xs font-normal text-muted-foreground hover:text-foreground"
          title="Cancel"
          onClick={() => setComposing(false)}
        >
          Cancel
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NewThreadComposer
          layout="contained"
          defaultProjectId={projectId ?? undefined}
          focusRequest={1}
          onSubmit={async (request) => {
            if (busy) return;
            setBusy(true);
            try {
              await onCreate(request);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </article>
  );
}

function NewPinnedThreadButton() {
  const sidebar = experimental_useSidebarThreads();
  const { projectId: contextProjectId } = useBbContext();

  const hasProject =
    Boolean(contextProjectId) ||
    sidebar.threads.some((thread) => thread.isPinned) ||
    sidebar.projects.length > 0;

  useLayoutEffect(() => {
    const title = Array.from(document.querySelectorAll("header p")).find(
      (el) => el.textContent === "Pins",
    );
    const parent = title?.parentElement;
    if (!parent) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "+";
    btn.title = hasProject ? "New pinned thread" : "No project available";
    btn.disabled = !hasProject;
    btn.style.cssText =
      "flex-shrink:0;position:relative;z-index:50;margin:0;border:0;background:transparent;padding:0 2px;font:inherit;font-size:0.875rem;font-weight:500;line-height:1;color:var(--muted-foreground);cursor:pointer;-webkit-app-region:no-drag;app-region:no-drag;opacity:" +
      (hasProject ? "1" : "0.4");
    btn.onclick = () => setComposing(!(composingCount > 0));
    parent.appendChild(btn);
    return () => btn.remove();
  }, [hasProject]);

  return null;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "pins",
    title: "Pins",
    icon: "Pin",
    path: "pins",
    component: PinsPanel,
    headerContent: NewPinnedThreadButton,
    experimental_sidebarAccessory: PinsCount,
  });
});
