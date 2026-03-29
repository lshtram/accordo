/**
 * accordo-comments — Panel Bootstrap
 *
 * Wires the custom Comments Panel (M45-EXT):
 *   - CommentsTreeProvider + PanelFilters
 *   - Panel view registration (accordo-comments-panel)
 *   - Panel commands (via registerPanelCommands)
 *   - accordo.comments.new command (gutter input box / reply)
 *   - workspace.onDidChangeTextDocument for staleness tracking
 *
 * Source: comments-architecture.md §10 (panel section)
 */

import * as vscode from "vscode";
import type { CommentStore } from "./comment-store.js";
import type { NativeComments } from "./native-comments.js";
import { PanelFilters } from "./panel/panel-filters.js";
import { CommentsTreeProvider } from "./panel/comments-tree-provider.js";
import { registerPanelCommands } from "./panel/panel-commands.js";
import type { NavigationEnv } from "./panel/navigation-router.js";

// ── wirePanelAndCommands ──────────────────────────────────────────────────────

/**
 * Creates the custom Comments Panel view, wires panel commands, registers the
 * `accordo.comments.new` command, and subscribes to document-change events for
 * staleness tracking.
 *
 * Returns an array of disposables to be pushed into context.subscriptions.
 */
export function wirePanelAndCommands(
  context: vscode.ExtensionContext,
  store: CommentStore,
  nc: NativeComments,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // ── Custom Comments Panel (M45-EXT) ──────────────────────────────────────────
  const filters = new PanelFilters(context.workspaceState);
  const treeProvider = new CommentsTreeProvider(store, filters);
  const treeView = vscode.window.createTreeView("accordo-comments-panel", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  disposables.push(treeView);

  const navEnv: NavigationEnv = {
    showTextDocument: (uri, options) => vscode.window.showTextDocument(uri, options),
    executeCommand: (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args),
    showWarningMessage: (msg) => vscode.window.showWarningMessage(msg),
    showInformationMessage: (msg) => vscode.window.showInformationMessage(msg),
    delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    visibleTextEditorUris: () => vscode.window.visibleTextEditors.map(e => e.document.uri.toString()),
  };

  const panelDisposables = registerPanelCommands(
    context,
    store,
    nc,
    navEnv,
    filters,
    treeProvider,
  );
  disposables.push(...panelDisposables);

  // ── Register accordo.comments.new (user-facing) ───────────────────────────
  // Called by controller.acceptInputCommand when user presses Ctrl+Enter / Save.
  // vscode.CommentReply = { thread: CommentThread, text: string }
  disposables.push(
    vscode.commands.registerCommand(
      "accordo.comments.new",
      async (reply: { thread: vscode.CommentThread; text: string }) => {
        if (!reply?.thread || !reply.text.trim()) return;
        const existingId = nc.getThreadIdForWidget(reply.thread);
        if (existingId) {
          // Reply to an existing thread from the UI input box
          const result = await store.reply({
            threadId: existingId,
            body: reply.text,
            author: { kind: "user", name: "User" },
          });
          if (result) nc.updateThread(store.getThread(existingId)!);
          // ! is safe: reply succeeds only if the thread exists
        } else {
          // New thread from the gutter "+" input box
          const uri = reply.thread.uri.toString();
          const range = reply.thread.range;
          // Dispose VSCode's temporary draft thread before creating the real one
          reply.thread.dispose();
          const anchor = range
            ? {
                kind: "text" as const,
                uri,
                range: {
                  startLine: range.start.line,
                  startChar: range.start.character,
                  endLine: range.end.line,
                  endChar: range.end.character,
                },
                docVersion: 0,
              }
            : { kind: "file" as const, uri };
          const result = await store.createThread({
            uri,
            anchor,
            body: reply.text,
            author: { kind: "user", name: "User" },
          });
          nc.addThread(store.getThread(result.threadId)!);
          // ! is safe: createThread always persists before returning
        }
      },
    ),
  );

  // ── Text document change → staleness tracking ─────────────────────────────
  disposables.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      store.onDocumentChanged({
        uri: event.document.uri.toString(),
        changes: event.contentChanges.map(c => ({
          startLine: c.range.start.line,
          endLine: c.range.end.line + 1,
          // Count newlines in inserted text (".length - 1" because split always
          // returns at least one element, even for the empty string).
          newLineCount: c.text.split("\n").length - 1,
        })),
      });
      for (const thread of store.getAllThreads()) {
        if (store.isThreadStale(thread.id)) {
          nc.markStale(thread.id);
        }
      }
    }),
  );

  return disposables;
}
