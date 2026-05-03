/**
 * Shared panel helpers — extracted from panel-bootstrap.ts and panel-tree-bootstrap.ts
 * to eliminate duplication of NavigationEnv, new-comment, and staleness logic.
 *
 * These helpers are used by BOTH webview and legacy tree wiring.
 */

// ── NavigationEnv factory ─────────────────────────────────────────────────────

import * as vscode from "vscode";
import type { NavigationEnv } from "./navigation-router.js";

export function createPanelNavigationEnv(): NavigationEnv {
  return {
    showTextDocument: (uri, options) => vscode.window.showTextDocument(uri, options),
    executeCommand: (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args),
    showWarningMessage: (msg) => vscode.window.showWarningMessage(msg),
    showInformationMessage: (msg) => vscode.window.showInformationMessage(msg),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    visibleTextEditorUris: () => vscode.window.visibleTextEditors.map((e) => e.document.uri.toString()),
    activeTextEditorUri: () => vscode.window.activeTextEditor?.document.uri.toString(),
  };
}

// ── New comment registration ──────────────────────────────────────────────────

import type { CommentStore } from "../comment-store.js";
import type { NativeComments } from "../native-comments.js";

/**
 * Registers the `accordo.comments.new` command used by VS Code's native
 * Comment widget when a user types a reply in the gutter.
 *
 * Shared between webview and tree wiring so both use the same bridge
 * from native widget → Accordo store.
 */
export function registerNewCommentCommand(
  store: CommentStore,
  nc: NativeComments,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    "accordo.comments.new",
    async (reply: { thread: vscode.CommentThread; text: string }) => {
      if (!reply?.thread || !reply.text.trim()) return;
      const existingId = nc.getThreadIdForWidget(reply.thread);
      if (existingId) {
        await store.reply({
          threadId: existingId,
          body: reply.text,
          author: { kind: "user", name: "User" },
        });
        return;
      }
      await createNewThreadFromWidget(store, reply);
    },
  );
}

async function createNewThreadFromWidget(
  store: CommentStore,
  reply: { thread: vscode.CommentThread; text: string },
): Promise<void> {
  const uri = reply.thread.uri.toString();
  const range = reply.thread.range;
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
  await store.createThread({
    uri,
    anchor,
    body: reply.text,
    author: { kind: "user", name: "User" },
  });
}

// ── Staleness tracking ─────────────────────────────────────────────────────────

import type { CommentThread } from "@accordo/bridge-types";

export function createStalenessTracker(
  store: CommentStore,
  nc: NativeComments,
): vscode.Disposable {
  return vscode.workspace.onDidChangeTextDocument((event) => {
    store.onDocumentChanged({
      uri: event.document.uri.toString(),
      changes: event.contentChanges.map((c) => ({
        startLine: c.range.start.line,
        endLine: c.range.end.line + 1,
        newLineCount: c.text.split("\n").length - 1,
      })),
    });
    for (const thread of store.getAllThreads()) {
      if (store.isThreadStale(thread.id)) {
        nc.markStale(thread.id);
      }
    }
  });
}