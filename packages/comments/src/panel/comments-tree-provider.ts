/**
 * CommentsTreeProvider — TreeDataProvider for the custom Accordo Comments Panel.
 *
 * Three-level tree:
 *   Level 0: Group headers (varies by group mode)
 *   Level 1: Thread items (collapsible — expand to see comment history)
 *   Level 2: Comment items (leaf — one per reply in the thread)
 *
 * Group modes (controlled by PanelFilters.groupMode):
 *   "by-status"   — Open (N) / Resolved (N)        (default)
 *   "by-file"     — One header per distinct file
 *   "by-activity" — Flat list, no group headers
 *
 * Source: requirements-comments-panel.md §3 M45-TP
 */

import * as vscode from "vscode";
import type {
  CommentThread,
  CommentAnchor,
  CommentAnchorText,
  CommentAnchorSurface,
  CommentIntent,
  AccordoComment,
  SlideCoordinates,
  HeadingCoordinates,
  BlockCoordinates,
  NormalizedCoordinates,
  DiagramNodeCoordinates,
  PdfPageCoordinates,
} from "@accordo/bridge-types";
import type { PanelFilters } from "./panel-filters.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal CommentStore subset needed by the tree provider. */
export interface TreeStoreReader {
  getAllThreads(): CommentThread[];
  isThreadStale(threadId: string): boolean;
  onChanged(listener: (uri: string) => void): { dispose(): void };
}

/**
 * Intent → emoji mapping.
 * Source: requirements-comments-panel.md §3 M45-TP Intent emoji mapping table
 */
export const INTENT_EMOJI: Record<CommentIntent, string> = {
  fix: "🔧",
  review: "👀",
  design: "🎨",
  question: "❓",
  explain: "💡",
  refactor: "♻️",
};

// ── CommentTreeItem ──────────────────────────────────────────────────────────

/** Tree item wrapping a group header, a CommentThread, or an individual comment. */
export class CommentTreeItem extends vscode.TreeItem {
  /** The underlying thread (set for thread-level and comment-level items). */
  thread?: CommentThread;
  /** Individual comment (set only for level-2 comment items). */
  comment?: AccordoComment;
  /** Whether this item is a group header (level 0). */
  isGroupHeader: boolean;
  /** Whether this item represents an individual comment (level 2). */
  isComment: boolean;
  /** Group key for headers: "open" | "resolved" | filename string. */
  group?: string;

  constructor(label: string | vscode.TreeItemLabel) {
    super(label);
    this.isGroupHeader = false;
    this.isComment = false;
  }
}

// ── getAnchorLabel ───────────────────────────────────────────────────────────

/**
 * M45-TP-15: Pure function — derives human-readable label from an anchor.
 *
 * | Anchor kind | Coordinates type | Label |
 * |-------------|-----------------|-------|
 * | text        | n/a             | "line {startLine + 1}" |
 * | surface     | slide           | "Slide {slideIndex + 1}" |
 * | surface     | heading         | "§ {headingText}" (truncated 40 chars) |
 * | surface     | block           | "block: {blockId}" (truncated 30 chars) |
 * | surface     | normalized      | "({x%}, {y%})" |
 * | surface     | diagram-node    | "node: {nodeId}" |
 * | surface     | pdf-page        | "p{page} ({x%}, {y%})" |
 * | file        | n/a             | "(file-level)" |
 */
export function getAnchorLabel(anchor: CommentAnchor): string {
  if (anchor.kind === "text") {
    return `line ${anchor.range.startLine + 1}`;
  }
  if (anchor.kind === "file") {
    return "(file-level)";
  }
  // surface
  const coords = anchor.coordinates;
  if (coords.type === "slide") {
    return `Slide ${(coords as SlideCoordinates).slideIndex + 1}`;
  }
  if (coords.type === "heading") {
    const text = (coords as HeadingCoordinates).headingText;
    return `§ ${text.slice(0, 40)}`;
  }
  if (coords.type === "block") {
    const id = (coords as BlockCoordinates).blockId;
    return `block: ${id.slice(0, 30)}`;
  }
  if (coords.type === "normalized") {
    const n = coords as NormalizedCoordinates;
    return `(${Math.round(n.x * 100)}%, ${Math.round(n.y * 100)}%)`;
  }
  if (coords.type === "diagram-node") {
    return `node: ${(coords as DiagramNodeCoordinates).nodeId}`;
  }
  if (coords.type === "pdf-page") {
    const p = coords as PdfPageCoordinates;
    return `p${p.page} (${Math.round(p.x * 100)}%, ${Math.round(p.y * 100)}%)`;
  }
  return anchor.uri;
}

// ── Helper: file-type icon ───────────────────────────────────────────────────

/** M45-TP-21: Returns ThemeIcon ID for the file based on anchor type/extension. */
export function getFileTypeIcon(anchor: CommentAnchor): string {
  if (anchor.kind === "surface") {
    const map: Record<string, string> = {
      slide: "play",
      "markdown-preview": "markdown",
      image: "file-media",
      diagram: "type-hierarchy",
      pdf: "file-pdf",
      browser: "globe",
    };
    return map[anchor.surfaceType] ?? "file";
  }
  const uri = anchor.uri;
  const ext = uri.slice(uri.lastIndexOf(".")).toLowerCase();
  if ([".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs", ".cpp", ".java"].includes(ext)) return "file-code";
  if ([".md", ".txt", ".rst"].includes(ext)) return "file-text";
  if ([".json", ".yaml", ".toml", ".xml"].includes(ext)) return "settings";
  if ([".png", ".jpg", ".gif", ".svg", ".webp"].includes(ext)) return "file-media";
  return "file";
}

/** M45-TP-22: Formats ISO datetime to concise locale string, e.g. "Mar 6 10:00". */
export function formatLastActivity(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${month} ${day} ${hour}:${min}`;
}

/** Extracts the filename from a URI string. */
function basename(uri: string): string {
  return uri.split("/").pop() ?? uri;
}

// ── CommentsTreeProvider ─────────────────────────────────────────────────────

/**
 * M45-TP-01: Implements vscode.TreeDataProvider<CommentTreeItem>.
 * M45-TP-02: Constructor accepts CommentStore and PanelFilters.
 */
export class CommentsTreeProvider implements vscode.TreeDataProvider<CommentTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<CommentTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly _store: TreeStoreReader;
  private readonly _filters: PanelFilters;
  private _storeSubscription: { dispose(): void } | undefined;

  constructor(store: TreeStoreReader, filters: PanelFilters) {
    this._store = store;
    this._filters = filters;
    this._storeSubscription = store.onChanged(() => {
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  /** M45-TP-03: Returns the element unchanged. */
  getTreeItem(element: CommentTreeItem): CommentTreeItem {
    return element;
  }

  getChildren(element?: CommentTreeItem): CommentTreeItem[] {
    const mode = this._filters.groupMode;

    // Level 2: comment children of a thread item
    if (element && !element.isGroupHeader && element.thread) {
      return element.thread.comments.map(c => this._makeCommentItem(c, element.thread!));
    }

    const allThreads = this._store.getAllThreads();
    const filtered = this._filters.apply(allThreads, this._store);

    // By-activity: flat sorted list, no group headers
    if (mode === "by-activity") {
      if (element) return []; // no sub-grouping
      return [...filtered]
        .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
        .map(t => this._makeThreadItem(t));
    }

    // By-file: group headers keyed by filename
    if (mode === "by-file") {
      if (!element) {
        // Build file groups
        const fileMap = new Map<string, CommentThread[]>();
        for (const t of filtered) {
          const file = basename(t.anchor.uri);
          const list = fileMap.get(file) ?? [];
          list.push(t);
          fileMap.set(file, list);
        }
        // Sort files by thread count descending
        return [...fileMap.entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .map(([file, threads]) => {
            const header = new CommentTreeItem(`${file} (${threads.length})`);
            header.isGroupHeader = true;
            header.isComment = false;
            header.group = file;
            header.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            return header;
          });
      }
      // Children of a file group header
      if (element.isGroupHeader && element.group) {
        const file = element.group;
        return [...filtered]
          .filter(t => basename(t.anchor.uri) === file)
          .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
          .map(t => this._makeThreadItem(t));
      }
      return [];
    }

    // By-status (default): Open / Resolved headers
    if (!element) {
      const open = filtered.filter(t => t.status === "open");
      const resolved = filtered.filter(t => t.status === "resolved");

      const openHeader = new CommentTreeItem(`🔴 Open (${open.length})`);
      openHeader.isGroupHeader = true;
      openHeader.isComment = false;
      openHeader.group = "open";
      openHeader.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;

      const resolvedHeader = new CommentTreeItem(`✅ Resolved (${resolved.length})`);
      resolvedHeader.isGroupHeader = true;
      resolvedHeader.isComment = false;
      resolvedHeader.group = "resolved";
      resolvedHeader.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

      return [openHeader, resolvedHeader];
    }

    // Children of a status group header
    if (element.isGroupHeader && element.group) {
      const groupStatus = element.group as "open" | "resolved";
      return [...filtered]
        .filter(t => t.status === groupStatus)
        .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
        .map(t => this._makeThreadItem(t));
    }

    return [];
  }

  private _makeThreadItem(thread: CommentThread): CommentTreeItem {
    const stale = this._store.isThreadStale(thread.id ?? "");
    const file = basename(thread.anchor.uri);
    const prefix = stale ? "⚠ " : "";
    const item = new CommentTreeItem(`${prefix}${file}`);
    item.thread = thread;
    item.isGroupHeader = false;
    item.isComment = false;
    item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    item.iconPath = new vscode.ThemeIcon(getFileTypeIcon(thread.anchor));
    item.contextValue = stale
      ? "accordo-thread-stale"
      : thread.status === "resolved"
        ? "accordo-thread-resolved"
        : "accordo-thread-open";

    // Description: anchor · intent emoji · N replies · date
    const anchor = getAnchorLabel(thread.anchor);
    const intent = thread.comments[0]?.intent;
    const emoji = intent ? (INTENT_EMOJI[intent] ?? "") : "";
    const replies = thread.comments.length;
    const date = formatLastActivity(thread.lastActivity);
    const statusBadge = thread.status === "resolved" ? "✅" : "🔴";
    const descParts = [statusBadge, anchor];
    if (emoji) descParts.push(emoji);
    descParts.push(`${replies} ${replies === 1 ? "reply" : "replies"}`);
    descParts.push(date);
    item.description = descParts.join(" · ");

    // Tooltip: full first comment body + author + timestamp
    const first = thread.comments[0];
    if (first) {
      item.tooltip = `${first.body}\n— ${first.author.name} · ${first.createdAt}`;
    }

    item.command = {
      command: "accordo.commentsPanel.navigateToAnchor",
      title: "Go to Anchor",
      arguments: [thread],
    };

    return item;
  }

  private _makeCommentItem(comment: AccordoComment, thread: CommentThread): CommentTreeItem {
    const item = new CommentTreeItem(comment.author.name);
    item.thread = thread;
    item.comment = comment;
    item.isGroupHeader = false;
    item.isComment = true;
    item.collapsibleState = vscode.TreeItemCollapsibleState.None;
    item.contextValue = "accordo-comment";
    item.description = `${comment.body.slice(0, 80)} · ${formatLastActivity(comment.createdAt)}`;
    item.tooltip = `${comment.body}\n— ${comment.author.name} · ${comment.createdAt}`;
    return item;
  }

  /** M45-TP-20: Fires a full tree refresh. */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /** M45-TP-16: Disposes the onChanged store subscription. */
  dispose(): void {
    this._storeSubscription?.dispose();
    this._storeSubscription = undefined;
  }
}
