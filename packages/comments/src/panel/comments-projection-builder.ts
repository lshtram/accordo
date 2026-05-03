import type { CommentThread } from "@accordo/bridge-types";
import type { PanelFilters } from "./panel-filters.js";
import type {
  CommentsPanelUiState,
  CommentsPanelViewModel,
  CommentsPanelGroupViewModel,
  CommentsPanelThreadViewModel,
  CommentsPanelCommentViewModel,
} from "./comments-webview-contract.js";

export interface CommentsPanelProjectionStore {
  getAllThreads(): readonly CommentThread[];
  isThreadStale(threadId: string): boolean;
}

/**
 * M45-PJ: pure projection boundary for the WebviewView panel.
 * Derives a CommentsPanelViewModel from CommentStore + PanelFilters + uiState.
 */
export interface CommentsPanelProjectionBuilder {
  build(
    store: CommentsPanelProjectionStore,
    filters: PanelFilters,
    uiState: CommentsPanelUiState,
  ): CommentsPanelViewModel;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupIdForStatus(status: CommentThread["status"]): string {
  return status;
}

function groupIdForFile(uri: string): string {
  // Normalize file:/// prefix for stable grouping
  const fsPrefix = "file://";
  let label = uri;
  if (label.startsWith(fsPrefix)) {
    // Strip the authority on Windows (e.g. /C:/...) or use the path as-is
    const path = label.slice(fsPrefix.length);
    // On Windows, path starts with /C:/ — strip the leading slash
    label = path.replace(/^\/[A-Za-z]:/, (m) => m.slice(1));
  }
  return `file:${label}`;
}

function groupIdForActivity(lastActivity: string): string {
  const date = new Date(lastActivity);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 7) return "this-week";
  if (diffDays < 30) return "this-month";
  return "older";
}

function relativeTimeBucket(lastActivity: string): string {
  const date = new Date(lastActivity);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 1) return "today";
  if (diffDays < 7) return "this-week";
  if (diffDays < 30) return "this-month";
  return "older";
}

function fileLabel(uri: string): string {
  const fsPrefix = "file://";
  let label = uri;
  if (label.startsWith(fsPrefix)) {
    const path = label.slice(fsPrefix.length);
    label = path.replace(/^\/[A-Za-z]:/, (m) => m.slice(1));
  }
  // Strip query/fragment if present
  const hashIdx = label.indexOf("#");
  if (hashIdx !== -1) label = label.slice(0, hashIdx);
  // Return just the filename portion for readability
  const parts = label.split("/");
  return parts.at(-1) ?? label;
}

function anchorLine(thread: CommentThread): number {
  const a = thread.anchor;
  if (a.kind === "text") {
    return a.range.startLine;
  }
  if (a.kind === "surface" && a.coordinates) {
    const coords = a.coordinates;
    if (coords.type === "normalized") {
      return Math.round(coords.y * 1000);
    }
    if (coords.type === "slide") {
      return coords.slideIndex * 1000;
    }
    if (coords.type === "pdf-page") {
      return coords.page * 1000 + Math.round(coords.y * 100);
    }
    if (coords.type === "diagram-node") {
      return 0;
    }
  }
  return 0;
}

function anchorSubtitle(thread: CommentThread): string {
  const a = thread.anchor;
  if (a.kind === "text") {
    const fn = fileLabel(a.uri);
    return `${fn} @ L${a.range.startLine}`;
  }
  if (a.kind === "surface") {
    const fn = fileLabel(a.uri);
    if (a.coordinates.type === "slide") {
      return `${fn} @ slide ${a.coordinates.slideIndex}`;
    }
    if (a.coordinates.type === "normalized" || a.coordinates.type === "pdf-page") {
      return `${fn} @ (${a.coordinates.x.toFixed(2)}, ${a.coordinates.y.toFixed(2)})`;
    }
    if (a.coordinates.type === "diagram-node") {
      return `${fn} @ ${a.coordinates.nodeId}`;
    }
    return fn;
  }
  if (a.kind === "file") {
    return fileLabel(a.uri);
  }
  return "";
}

function buildTitle(thread: CommentThread): string {
  const first = thread.comments[0];
  if (!first) return "Comment";
  const body = first.body;
  return body.length > 60 ? body.slice(0, 60) + "…" : body;
}

function buildPreview(thread: CommentThread): string {
  const first = thread.comments[0];
  if (!first) return "";
  const body = first.body;
  return body.length > 80 ? body.slice(0, 80) + "…" : body;
}

function buildReplySummary(thread: CommentThread): string {
  const replyCount = Math.max(0, thread.comments.length - 1);
  if (replyCount === 0) return "No replies yet";
  const lastComment = thread.comments.at(-1);
  const lastAuthor = lastComment?.author.name ?? "Unknown";
  if (replyCount === 1) return `1 reply · last by ${lastAuthor}`;
  return `${replyCount} replies · last by ${lastAuthor}`;
}

function buildThreadViewModel(
  thread: CommentThread,
  stale: boolean,
  expanded: boolean,
  uiState: CommentsPanelUiState,
): CommentsPanelThreadViewModel {
  const first = thread.comments[0];
  const replyCount = Math.max(0, thread.comments.length - 1);
  const surfaceType = thread.anchor.kind === "surface" ? thread.anchor.surfaceType : undefined;

  const comments: readonly CommentsPanelCommentViewModel[] = expanded
    ? thread.comments.map((c) => ({
        commentId: c.id ?? "",
        authorName: c.author.name,
        authorKind: c.author.kind,
        body: c.body,
        createdAt: c.createdAt,
        intent: c.intent,
      }))
    : [];

  return {
    threadId: thread.id ?? "",
    uri: thread.anchor.uri,
    title: buildTitle(thread),
    subtitle: anchorSubtitle(thread),
    preview: buildPreview(thread),
    replySummary: buildReplySummary(thread),
    status: thread.status,
    intent: first?.intent,
    surfaceType,
    stale,
    replyCount,
    expanded,
    comments,
  };
}

// ── Main export ───────────────────────────────────────────────────────────

export function buildCommentsPanelViewModel(
  store: CommentsPanelProjectionStore,
  filters: PanelFilters,
  uiState: CommentsPanelUiState,
): CommentsPanelViewModel {
  const allThreads = store.getAllThreads();
  const filtered = filters.apply(allThreads, {
    isThreadStale: (id: string) => store.isThreadStale(id),
  });

  const groupMode = filters.groupMode;
  const groupsMap = new Map<string, CommentThread[]>();

  for (const thread of filtered) {
    let key: string;
    if (groupMode === "by-status") {
      key = groupIdForStatus(thread.status);
    } else if (groupMode === "by-file") {
      key = groupIdForFile(thread.anchor.uri);
    } else {
      // by-activity — bucket by relative time
      key = relativeTimeBucket(thread.lastActivity);
    }
    const existing = groupsMap.get(key);
    if (existing) {
      existing.push(thread);
    } else {
      groupsMap.set(key, [thread]);
    }
  }

  // Sort threads within each group by anchor line
  for (const threads of groupsMap.values()) {
    threads.sort((a, b) => anchorLine(a) - anchorLine(b));
  }

  const groupEntries = Array.from(groupsMap.entries());

  const groups: CommentsPanelGroupViewModel[] = groupEntries
    .map(([groupId, threads]) => {
      const collapsed = uiState.collapsedGroupIds.has(groupId);
      const groupKind =
        groupMode === "by-status"
          ? ("status" as const)
          : groupMode === "by-file"
            ? ("file" as const)
            : ("activity" as const);

      let label: string;
      if (groupMode === "by-status") {
        label = groupId;
      } else if (groupMode === "by-file") {
        // Strip "file:" prefix for display
        label = fileLabel(groupId.slice(5));
      } else {
        label = groupId;
      }

      const threadViewModels = threads.map((thread) => {
        const expanded = uiState.expandedThreadIds.has(thread.id ?? "");
        const stale = store.isThreadStale(thread.id ?? "");
        return buildThreadViewModel(thread, stale, expanded, uiState);
      });

      return {
        groupId,
        kind: groupKind,
        label,
        count: threads.length,
        expanded: !collapsed,
        threads: threadViewModels,
      };
    })
    .sort((a, b) => {
      // by-status: open first
      if (groupMode === "by-status") {
        if (a.label === "open" && b.label !== "open") return -1;
        if (b.label === "open" && a.label !== "open") return 1;
        if (a.label === "resolved" && b.label !== "resolved") return 1;
        if (b.label === "resolved" && a.label !== "resolved") return -1;
      }
      // by-activity: today > this-week > this-month > older
      if (groupMode === "by-activity") {
        const order = { today: 0, "this-week": 1, "this-month": 2, older: 3 };
        const ao = order[a.label as keyof typeof order] ?? 99;
        const bo = order[b.label as keyof typeof order] ?? 99;
        if (ao !== bo) return ao - bo;
      }
      return 0;
    });

  const openThreadCount = allThreads.filter((t) => t.status === "open").length;
  const resolvedThreadCount = allThreads.filter((t) => t.status === "resolved").length;

  return {
    generatedAt: new Date().toISOString(),
    filtersSummary: filters.getSummary(),
    statusFilter: filters.status,
    searchQuery: filters.searchQuery,
    groupMode,
    groups,
    totalThreadCount: allThreads.length,
    openThreadCount,
    resolvedThreadCount,
  };
}
