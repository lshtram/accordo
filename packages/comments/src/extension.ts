/**
 * accordo-comments — VSCode Extension Entry Point
 *
 * Activates by acquiring BridgeAPI from accordo-bridge and wiring:
 * - CommentStore (persistence)
 * - NativeComments (gutter, panel, inline threads)
 * - CommentTools (6 MCP tools)
 * - StateContribution (modality state → system prompt)
 * - Internal commands for inter-extension integration
 *
 * If accordo-bridge is not installed, the extension is inert.
 *
 * Source: comments-architecture.md §10
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition, CommentAnchor, CommentIntent } from "@accordo/bridge-types";
import { CommentStore } from "./comment-store.js";
import { NativeComments } from "./native-comments.js";
import { createCommentTools } from "./comment-tools.js";
import { startStateContribution } from "./state-contribution.js";

// ── BridgeAPI (minimal interface — full type lives in accordo-bridge) ─────────

/** Subset of accordo-bridge BridgeAPI used by this extension. */
export interface BridgeAPI {
  registerTools(
    extensionId: string,
    tools: ExtensionToolDefinition[],
  ): { dispose(): void };
  publishState(extensionId: string, state: Record<string, unknown>): void;
}

// ── activate ──────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension activates (onStartupFinished).
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Acquire BridgeAPI — if absent, remain inert
  const bridgeExt = vscode.extensions.getExtension("accordo.accordo-bridge");
  if (!bridgeExt) {
    return;
  }
  const bridge = bridgeExt.exports as BridgeAPI;

  // ── Store ──────────────────────────────────────────────────────────────────
  const store = new CommentStore();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  await store.load(workspaceRoot);

  // ── NativeComments (controller + widgets) ─────────────────────────────────
  const nc = new NativeComments();
  nc.init(store, context);
  nc.restoreThreads(store.getAllThreads());
  nc.registerCommands(store, context);

  // ── Register accordo.comments.new (user-facing) ────────────────────────────
  // Called by controller.acceptInputCommand when user presses Ctrl+Enter / Save.
  // vscode.CommentReply = { thread: CommentThread, text: string }
  context.subscriptions.push(
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
        }
      },
    ),
  );

  // ── Text document change → staleness tracking ─────────────────────────────
  context.subscriptions.push(
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

  // ── Tools ─────────────────────────────────────────────────────────────────
  const tools = createCommentTools(store, nc);
  const toolsDisposable = bridge.registerTools("accordo-comments", tools);
  context.subscriptions.push(toolsDisposable);

  // ── State contribution ────────────────────────────────────────────────────
  const stateContrib = startStateContribution(bridge, store);
  context.subscriptions.push(stateContrib);

  // ── Internal commands (inter-extension API) ───────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "accordo.comments.internal.getThreadsForUri",
      (uri: string) => {
        return store.getAllThreads().filter(t => t.anchor.uri === uri);
      },
    ),
    vscode.commands.registerCommand(
      "accordo.comments.internal.createSurfaceComment",
      async (params: Record<string, unknown>) => {
        // Called by modality extensions (diagrams, slides) when a comment is
        // created from a webview. Persists directly via the store.
        return store.createThread({
          uri: params["uri"] as string,
          anchor: params["anchor"] as CommentAnchor,
          body: params["body"] as string,
          intent: params["intent"] as CommentIntent | undefined,
          author: { kind: "user", name: "System" },
        });
      },
    ),
    vscode.commands.registerCommand(
      "accordo.comments.internal.resolveThread",
      async (threadId: string) => {
        await store.resolve({
          threadId,
          resolutionNote: "Resolved via internal API",
          author: { kind: "user", name: "System" },
        });
        nc.updateThread(store.getThread(threadId)!);
      },
    ),
  );
}

// ── deactivate ────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension host is being shut down.
 */
export function deactivate(): void {
  // Subscriptions added to context.subscriptions are disposed automatically.
}
