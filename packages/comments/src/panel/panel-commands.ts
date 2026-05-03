/**
 * PanelCommands — Registers all VS Code commands for the custom Comments Panel.
 *
 * Each command receives a CommentTreeItem from the tree context menu,
 * extracts the CommentThread, and delegates to CommentStore / NavigationRouter.
 *
 * Source: requirements-comments-panel.md §3 M45-CMD
 */

import type * as vscode from "vscode";
import type { CommentThread, CommentAuthor } from "@accordo/bridge-types";
import type { NavigationAdapterRegistry } from "@accordo/capabilities";
import type { CommentTreeItem } from "./comments-tree-provider.js";
import type { NavigationEnv } from "./navigation-router.js";
import type { PanelFilters } from "./panel-filters.js";
import { commands, window } from "vscode";

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal store interface for panel command mutations. */
export interface PanelCommandStore {
  resolve(params: { threadId: string; resolutionNote: string; author: CommentAuthor }): Promise<void>;
  reopen(threadId: string, author: CommentAuthor): Promise<void>;
  reply(params: { threadId: string; body: string; author: CommentAuthor }): Promise<unknown>;
  delete(params: { threadId: string }): Promise<void>;
  deleteAllByModality(surfaceType: string): Promise<{ count: number; deletedIds: string[] }>;
  getThread(threadId: string): CommentThread | undefined;
}

/** Minimal NativeComments interface for gutter widget sync. */
export interface NativeCommentsSync {
  updateThread(thread: CommentThread): void;
  removeThread(threadId: string): void;
  removeThreads(threadIds: string[]): void;
}

/** VS Code window API subset for UI interactions. */
export interface PanelCommandUI {
  showInputBox(options: { prompt: string; placeHolder?: string }): Thenable<string | undefined>;
  showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
  showInformationMessage(message: string): Thenable<string | undefined>;
}

/** Shared panel surface seam for TreeView and WebviewView generations. */
export interface PanelPresentationSurface {
  refresh(): void;
}

// ── registerPanelCommands ────────────────────────────────────────────────────

/**
 * M45-CMD-01: Registers all panel commands. Returns disposables for context.subscriptions.
 *
 * Commands:
 * - accordo.commentsPanel.navigateToAnchor (M45-CMD-02)
 * - accordo.commentsPanel.resolve (M45-CMD-03)
 * - accordo.commentsPanel.reopen (M45-CMD-04)
 * - accordo.commentsPanel.reply (M45-CMD-05)
 * - accordo.commentsPanel.delete (M45-CMD-06)
 * - accordo.commentsPanel.refresh (M45-CMD-07)
 * - accordo.commentsPanel.filterByStatus (M45-CMD-08)
 * - accordo.commentsPanel.filterByIntent (M45-CMD-09)
 * - accordo.commentsPanel.clearFilters (M45-CMD-10)
 * - accordo.commentsPanel.groupBy (M45-CMD-14)
 */
export function registerPanelCommands(
  context: vscode.ExtensionContext,
  store: PanelCommandStore,
  nc: NativeCommentsSync,
  navEnv: NavigationEnv,
  filters: PanelFilters,
  provider: PanelPresentationSurface,
  ui?: PanelCommandUI,
): { dispose(): void }[] {
  const windowUI: PanelCommandUI = ui ?? {
    showInputBox: (opts) => window.showInputBox(opts),
    showWarningMessage: (msg, ...items) => window.showWarningMessage(msg, ...items) as Thenable<string | undefined>,
    showInformationMessage: (msg) => window.showInformationMessage(msg),
  };

  const disposables: { dispose(): void }[] = [];

  disposables.push(_registerNavigateToAnchor(store, navEnv, windowUI));
  disposables.push(_registerResolve(store, windowUI, provider));
  disposables.push(_registerReopen(store, windowUI, provider));
  disposables.push(_registerReply(store, navEnv, windowUI));
  disposables.push(_registerDelete(store, windowUI, provider));
  disposables.push(_registerRefresh(provider));
  disposables.push(_registerFilterByStatus(filters, provider));
  disposables.push(_registerFilterByIntent(filters, provider));
  disposables.push(_registerClearFilters(filters, provider));
  disposables.push(_registerGroupBy(filters, provider));
  disposables.push(_registerDeleteAllBrowserComments(store, windowUI, provider));

  return disposables;
}

function _registerNavigateToAnchor(
  store: PanelCommandStore,
  navEnv: NavigationEnv,
  windowUI: PanelCommandUI,
): { dispose(): void } {
  async function noArg(): Promise<void> {
    await windowUI.showInformationMessage("Select a thread in the Comments panel first");
  }
  function extractThread(arg: unknown): CommentThread | undefined {
    if (!arg) return undefined;
    if (typeof arg === "string") return store.getThread(arg);
    const item = arg as CommentTreeItem;
    return item.thread ?? (arg as CommentThread);
  }
  return commands.registerCommand("accordo.commentsPanel.navigateToAnchor", async (arg: unknown) => {
    const thread = extractThread(arg);
    if (!thread) { await noArg(); return; }
    let registry: NavigationAdapterRegistry | undefined;
    try {
      registry = await commands.executeCommand<NavigationAdapterRegistry | null>(
        "accordo_marp_internal_getNavigationRegistry",
      ) ?? undefined;
    } catch { /* marp not available */ }
    const { navigateToThread } = await import("./navigation-router.js");
    await navigateToThread(thread, navEnv, registry);
  });
}

function _registerResolve(
  store: PanelCommandStore,
  windowUI: PanelCommandUI,
  provider: PanelPresentationSurface,
): { dispose(): void } {
  const PANEL_AUTHOR: CommentAuthor = { kind: "user", name: "User" };
  async function noArg(): Promise<void> {
    await windowUI.showInformationMessage("Select a thread in the Comments panel first");
  }
  function extractThread(arg: unknown): CommentThread | undefined {
    if (!arg) return undefined;
    if (typeof arg === "string") return store.getThread(arg);
    const item = arg as CommentTreeItem;
    return item.thread ?? (arg as CommentThread);
  }
  return commands.registerCommand("accordo.commentsPanel.resolve", async (arg: unknown) => {
    const thread = extractThread(arg);
    if (!thread) { await noArg(); return; }
    if (thread.status === "resolved") {
      await windowUI.showInformationMessage("Thread is already resolved.");
      return;
    }
    const note = await windowUI.showInputBox({ prompt: "Resolution note (optional)", placeHolder: "What was resolved?" });
    if (note === undefined) return;
    await store.resolve({ threadId: thread.id!, resolutionNote: note, author: PANEL_AUTHOR });
    provider.refresh();
  });
}

function _registerReopen(
  store: PanelCommandStore,
  windowUI: PanelCommandUI,
  provider: PanelPresentationSurface,
): { dispose(): void } {
  const PANEL_AUTHOR: CommentAuthor = { kind: "user", name: "User" };
  async function noArg(): Promise<void> {
    await windowUI.showInformationMessage("Select a thread in the Comments panel first");
  }
  function extractThread(arg: unknown): CommentThread | undefined {
    if (!arg) return undefined;
    if (typeof arg === "string") return store.getThread(arg);
    const item = arg as CommentTreeItem;
    return item.thread ?? (arg as CommentThread);
  }
  return commands.registerCommand("accordo.commentsPanel.reopen", async (arg: unknown) => {
    const thread = extractThread(arg);
    if (!thread) { await noArg(); return; }
    if (thread.status === "open") {
      await windowUI.showInformationMessage("Thread is already open.");
      return;
    }
    await store.reopen(thread.id!, PANEL_AUTHOR);
    provider.refresh();
  });
}

function _registerReply(
  store: PanelCommandStore,
  navEnv: NavigationEnv,
  windowUI: PanelCommandUI,
): { dispose(): void } {
  async function noArg(): Promise<void> {
    await windowUI.showInformationMessage("Select a thread in the Comments panel first");
  }
  function extractThread(arg: unknown): CommentThread | undefined {
    if (!arg) return undefined;
    if (typeof arg === "string") return store.getThread(arg);
    const item = arg as CommentTreeItem;
    return item.thread ?? (arg as CommentThread);
  }
  return commands.registerCommand("accordo.commentsPanel.reply", async (arg: unknown) => {
    const thread = extractThread(arg);
    if (!thread) { await noArg(); return; }
    const { navigateToThread } = await import("./navigation-router.js");
    let registry: NavigationAdapterRegistry | undefined;
    try {
      registry = await commands.executeCommand<NavigationAdapterRegistry | null>(
        "accordo_marp_internal_getNavigationRegistry",
      ) ?? undefined;
    } catch { /* marp not available */ }
    await navigateToThread(thread, navEnv, registry);
  });
}

function _registerDelete(
  store: PanelCommandStore,
  windowUI: PanelCommandUI,
  provider: PanelPresentationSurface,
): { dispose(): void } {
  async function noArg(): Promise<void> {
    await windowUI.showInformationMessage("Select a thread in the Comments panel first");
  }
  function extractThread(arg: unknown): CommentThread | undefined {
    if (!arg) return undefined;
    if (typeof arg === "string") return store.getThread(arg);
    const item = arg as CommentTreeItem;
    return item.thread ?? (arg as CommentThread);
  }
  return commands.registerCommand("accordo.commentsPanel.delete", async (arg: unknown) => {
    const thread = extractThread(arg);
    if (!thread) { await noArg(); return; }
    const answer = await windowUI.showWarningMessage(
      "Delete thread and all replies?", "Delete", "Cancel",
    );
    if (answer !== "Delete") return;
    await store.delete({ threadId: thread.id! });
    provider.refresh();
  });
}

function _registerRefresh(provider: PanelPresentationSurface): { dispose(): void } {
  return commands.registerCommand("accordo.commentsPanel.refresh", () => {
    provider.refresh();
  });
}

function _registerFilterByStatus(
  filters: PanelFilters,
  provider: PanelPresentationSurface,
): { dispose(): void } {
  return commands.registerCommand("accordo.commentsPanel.filterByStatus", async () => {
    const picked = await window.showQuickPick(["open", "resolved", "all"], { placeHolder: "Filter by status" });
    if (!picked) return;
    filters.setStatus(picked === "all" ? undefined : picked as "open" | "resolved");
    provider.refresh();
  });
}

function _registerFilterByIntent(
  filters: PanelFilters,
  provider: PanelPresentationSurface,
): { dispose(): void } {
  return commands.registerCommand("accordo.commentsPanel.filterByIntent", async () => {
    const intents = ["fix", "review", "design", "question", "explain", "refactor", "all"];
    const picked = await window.showQuickPick(intents, { placeHolder: "Filter by intent" });
    if (!picked) return;
    filters.setIntent(picked === "all" ? undefined : picked as import("@accordo/bridge-types").CommentIntent);
    provider.refresh();
  });
}

function _registerClearFilters(
  filters: PanelFilters,
  provider: PanelPresentationSurface,
): { dispose(): void } {
  return commands.registerCommand("accordo.commentsPanel.clearFilters", () => {
    filters.clear();
    provider.refresh();
  });
}

function _registerGroupBy(
  filters: PanelFilters,
  provider: PanelPresentationSurface,
): { dispose(): void } {
  return commands.registerCommand("accordo.commentsPanel.groupBy", async () => {
    const picked = await window.showQuickPick(
      ["by-status", "by-file", "by-activity"],
      { placeHolder: "Group comments by…" }
    );
    if (!picked) return;
    filters.setGroupMode(picked as import("./panel-filters.js").GroupMode);
    provider.refresh();
  });
}

function _registerDeleteAllBrowserComments(
  store: PanelCommandStore,
  windowUI: PanelCommandUI,
  provider: PanelPresentationSurface,
): { dispose(): void } {
  return commands.registerCommand("accordo.commentsPanel.deleteAllBrowserComments", async () => {
    const answer = await windowUI.showWarningMessage(
      "Delete all browser comments? This cannot be undone.", "Delete All", "Cancel",
    );
    if (answer !== "Delete All") return;
    const result = await store.deleteAllByModality("browser");
    await windowUI.showInformationMessage(`Deleted ${result.count} browser comment thread(s).`);
    provider.refresh();
  });
}
