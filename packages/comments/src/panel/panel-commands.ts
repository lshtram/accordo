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
import type { CommentsTreeProvider, CommentTreeItem } from "./comments-tree-provider.js";
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
  deleteAllByModality(surfaceType: string): Promise<number>;
  getThread(threadId: string): CommentThread | undefined;
}

/** Minimal NativeComments interface for gutter widget sync. */
export interface NativeCommentsSync {
  updateThread(thread: CommentThread): void;
  removeThread(threadId: string): void;
}

/** VS Code window API subset for UI interactions. */
export interface PanelCommandUI {
  showInputBox(options: { prompt: string; placeHolder?: string }): Thenable<string | undefined>;
  showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
  showInformationMessage(message: string): Thenable<string | undefined>;
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
  provider: CommentsTreeProvider,
  ui?: PanelCommandUI,
): { dispose(): void }[] {
  const PANEL_AUTHOR: CommentAuthor = { kind: "user", name: "User" };

  const windowUI: PanelCommandUI = ui ?? {
    showInputBox: (opts) => window.showInputBox(opts),
    showWarningMessage: (msg, ...items) => window.showWarningMessage(msg, ...items) as Thenable<string | undefined>,
    showInformationMessage: (msg) => window.showInformationMessage(msg),
  };

  function extractThread(arg: unknown): CommentThread | undefined {
    if (!arg) return undefined;
    const item = arg as CommentTreeItem;
    return item.thread ?? (arg as CommentThread);
  }

  async function noArg(): Promise<void> {
    await windowUI.showInformationMessage("Select a thread in the Comments panel first");
  }

  const disposables: { dispose(): void }[] = [];

  // M45-CMD-02: navigateToAnchor
  disposables.push(commands.registerCommand("accordo.commentsPanel.navigateToAnchor", async (arg: unknown) => {
    const thread = extractThread(arg);
    if (!thread) { await noArg(); return; }

    // Acquire the navigation registry from accordo-marp (shared at activation).
    // Uses the command-based approach for loose coupling between extensions.
    // Graceful no-op if marp hasn't activated yet — deferred path handles it.
    let registry: NavigationAdapterRegistry | undefined;
    try {
      registry = await commands.executeCommand<NavigationAdapterRegistry | null>(
        "accordo_marp_internal_getNavigationRegistry",
      ) ?? undefined;
    } catch { /* marp not available — deferred path will be used */ }

    const { navigateToThread } = await import("./navigation-router.js");
    await navigateToThread(thread, navEnv, registry);
  }));

  // M45-CMD-03: resolve
  disposables.push(commands.registerCommand("accordo.commentsPanel.resolve", async (arg: unknown) => {
    const thread = extractThread(arg);
    if (!thread) { await noArg(); return; }
    if (thread.status === "resolved") {
      await windowUI.showInformationMessage("Thread is already resolved.");
      return;
    }
    const note = await windowUI.showInputBox({ prompt: "Resolution note (optional)", placeHolder: "What was resolved?" });
    if (note === undefined) return; // cancelled
    await store.resolve({ threadId: thread.id!, resolutionNote: note, author: PANEL_AUTHOR });
    const updated = store.getThread(thread.id!);
    if (updated) nc.updateThread(updated);
    provider.refresh();
  }));

  // M45-CMD-04: reopen
  disposables.push(commands.registerCommand("accordo.commentsPanel.reopen", async (arg: unknown) => {
    const thread = extractThread(arg);
    if (!thread) { await noArg(); return; }
    if (thread.status === "open") {
      await windowUI.showInformationMessage("Thread is already open.");
      return;
    }
    await store.reopen(thread.id!, PANEL_AUTHOR);
    const updated = store.getThread(thread.id!);
    if (updated) nc.updateThread(updated);
    provider.refresh();
  }));

  // M45-CMD-05: reply — navigate to anchor and open its inline input UI
  // (gutter widget for text anchors, slide popover for surface anchors).
  // This avoids the top-of-screen showInputBox dialog in favour of native,
  // in-context input controls.
  // Uses registry-backed navigation (same as navigateToAnchor) for consistency.
  disposables.push(commands.registerCommand("accordo.commentsPanel.reply", async (arg: unknown) => {
    const thread = extractThread(arg);
    if (!thread) { await noArg(); return; }
    const { navigateToThread } = await import("./navigation-router.js");
    let registry: NavigationAdapterRegistry | undefined;
    try {
      registry = await commands.executeCommand<NavigationAdapterRegistry | null>(
        "accordo_marp_internal_getNavigationRegistry",
      ) ?? undefined;
    } catch { /* marp not available — deferred path will be used */ }
    await navigateToThread(thread, navEnv, registry);
  }));

  // M45-CMD-06: delete
  disposables.push(commands.registerCommand("accordo.commentsPanel.delete", async (arg: unknown) => {
    const thread = extractThread(arg);
    if (!thread) { await noArg(); return; }
    const answer = await windowUI.showWarningMessage(
      "Delete thread and all replies?", "Delete", "Cancel",
    );
    if (answer !== "Delete") return;
    await store.delete({ threadId: thread.id! });
    nc.removeThread(thread.id!);
    provider.refresh();
  }));

  // M45-CMD-07: refresh
  disposables.push(commands.registerCommand("accordo.commentsPanel.refresh", () => {
    provider.refresh();
  }));

  // M45-CMD-08: filterByStatus
  disposables.push(commands.registerCommand("accordo.commentsPanel.filterByStatus", async () => {
    const picked = await window.showQuickPick(["open", "resolved", "all"], { placeHolder: "Filter by status" });
    if (!picked) return;
    filters.setStatus(picked === "all" ? undefined : picked as "open" | "resolved");
    provider.refresh();
  }));

  // M45-CMD-09: filterByIntent
  disposables.push(commands.registerCommand("accordo.commentsPanel.filterByIntent", async () => {
    const intents = ["fix", "review", "design", "question", "explain", "refactor", "all"];
    const picked = await window.showQuickPick(intents, { placeHolder: "Filter by intent" });
    if (!picked) return;
    filters.setIntent(picked === "all" ? undefined : picked as import("@accordo/bridge-types").CommentIntent);
    provider.refresh();
  }));

  // M45-CMD-10: clearFilters
  disposables.push(commands.registerCommand("accordo.commentsPanel.clearFilters", () => {
    filters.clear();
    provider.refresh();
  }));

  // M45-CMD-14: groupBy
  disposables.push(commands.registerCommand("accordo.commentsPanel.groupBy", async () => {
    const picked = await window.showQuickPick(
      ["by-status", "by-file", "by-activity"],
      { placeHolder: "Group comments by…" }
    );
    if (!picked) return;
    filters.setGroupMode(picked as import("./panel-filters.js").GroupMode);
    provider.refresh();
  }));

  // M40-EXT-12: deleteAllBrowserComments — bulk browser comment cleanup
  disposables.push(commands.registerCommand("accordo.commentsPanel.deleteAllBrowserComments", async () => {
    const answer = await windowUI.showWarningMessage(
      "Delete all browser comments? This cannot be undone.", "Delete All", "Cancel",
    );
    if (answer !== "Delete All") return;
    const count = await store.deleteAllByModality("browser");
    await windowUI.showInformationMessage(`Deleted ${count} browser comment thread(s).`);
    provider.refresh();
  }));

  return disposables;
}
