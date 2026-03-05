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
import type { ExtensionToolDefinition, CommentAnchor, CommentAnchorSurface, CommentAnchorText, BlockCoordinates, CommentIntent } from "@accordo/bridge-types";
import { CommentStore } from "./comment-store.js";
import { NativeComments } from "./native-comments.js";
import { createCommentTools } from "./comment-tools.js";
import { startStateContribution } from "./state-contribution.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive a BlockCoordinates.blockType from the block-id string produced by
 * the BlockIdPlugin in accordo-md-viewer.
 * Format: "heading:{level}:{slug}" | "p:{index}" | "li:{listIdx}:{itemIdx}" | "pre:{index}"
 */
function inferBlockType(blockId: string): BlockCoordinates["blockType"] {
  if (blockId.startsWith("heading:")) return "heading";
  if (blockId.startsWith("li:")) return "list-item";
  if (blockId.startsWith("pre:")) return "code-block";
  return "paragraph";
}

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
  // ── Store (always created — does not depend on Bridge) ─────────────────────
  const store = new CommentStore();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  await store.load(workspaceRoot);

  // ── Auto-prune threads whose files no longer exist on disk ─────────────────
  {
    const pruned = await store.pruneStaleThreads(async (uri) => {
      try { await vscode.workspace.fs.stat(vscode.Uri.parse(uri)); return true; }
      catch { return false; }
    });
    if (pruned.length > 0) {
      console.info(`[accordo-comments] Pruned ${pruned.length} stale thread(s) on activation`);
    }
  }

  // ── NativeComments (always created — gutter, panel, inline threads) ────────
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

  // ── Internal commands (inter-extension API — no Bridge dependency) ─────────
  context.subscriptions.push(
    // Adapter returned to accordo-md-viewer via getStore so it can persist preview
    // comments and subscribe to store changes without importing VSCode or the
    // full CommentStore class directly.
    vscode.commands.registerCommand(
      "accordo.comments.internal.getStore",
      () => {
        return {
          async createThread(args: { uri: string; blockId: string; body: string; intent?: string; line?: number }) {
            // When a source line is known (blockId→line resolved by md-viewer),
            // create a TEXT anchor so the comment appears in both text editor and
            // webview.  Fall back to surface anchor only when no line is available.
            let anchor: CommentAnchor;
            if (args.line !== undefined && args.line >= 0) {
              // Unified text anchor — NativeComments will place the gutter widget
              // at the correct line; the webview SDK will resolve line→blockId via
              // PreviewBridge's resolver to position the pin.
              const textAnchor: CommentAnchorText = {
                kind: "text",
                uri: args.uri,
                range: {
                  startLine: args.line,
                  startChar: 0,
                  endLine: args.line,
                  endChar: 0,
                },
                docVersion: 0,
              };
              anchor = textAnchor;
            } else {
              // No line mapping — surface anchor (legacy / fallback)
              const coords: BlockCoordinates = { type: "block", blockId: args.blockId, blockType: inferBlockType(args.blockId) };
              anchor = { kind: "surface", uri: args.uri, surfaceType: "markdown-preview", coordinates: coords } as CommentAnchorSurface;
            }
            const result = await store.createThread({ uri: args.uri, anchor, body: args.body, intent: args.intent as CommentIntent | undefined, author: { kind: "user", name: "You" } });
            const thread = store.getThread(result.threadId)!;
            nc.addThread(thread);
            return thread;
          },
          async reply(args: { threadId: string; body: string }) {
            await store.reply({ threadId: args.threadId, body: args.body, author: { kind: "user", name: "You" } });
            const updated = store.getThread(args.threadId);
            if (updated) nc.updateThread(updated);
          },
          async resolve(args: { threadId: string; resolutionNote?: string }) {
            await store.resolve({ threadId: args.threadId, resolutionNote: args.resolutionNote ?? "", author: { kind: "user", name: "You" } });
            const updated = store.getThread(args.threadId);
            if (updated) nc.updateThread(updated);
          },
          async reopen(args: { threadId: string }) {
            await store.reopen(args.threadId, { kind: "user", name: "You" });
            const updated = store.getThread(args.threadId);
            if (updated) nc.updateThread(updated);
          },
          async delete(args: { threadId: string; commentId?: string }) {
            await store.delete({ threadId: args.threadId, commentId: args.commentId });
            const updated = store.getThread(args.threadId);
            if (updated) nc.updateThread(updated);
            else nc.removeThread(args.threadId);
          },
          getThreadsForUri(uri: string) {
            return store.getThreadsForUri(uri);
          },
          onChanged(listener: (uri: string) => void) {
            return store.onChanged(listener);
          },
        };
      },
    ),
    vscode.commands.registerCommand(
      "accordo.comments.internal.getThreadsForUri",
      (uri: string) => {
        return store.getAllThreads().filter(t => t.anchor.uri === uri);
      },
    ),
    vscode.commands.registerCommand(
      "accordo.comments.internal.createSurfaceComment",
      async (params: Record<string, unknown>) => {
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

  // ── Bridge-dependent features (tools + state) — optional ───────────────────
  const bridgeExt = vscode.extensions.getExtension("accordo.accordo-bridge");
  if (!bridgeExt) {
    console.warn("[accordo-comments] accordo-bridge not installed — MCP tools and state disabled");
    return;
  }
  if (!bridgeExt.isActive) {
    try { await bridgeExt.activate(); } catch { /* bridge failed — skip tools */ }
  }
  const bridge = bridgeExt.exports as BridgeAPI | undefined;
  if (!bridge || typeof bridge.registerTools !== "function") {
    console.warn("[accordo-comments] Bridge exports unavailable — MCP tools and state disabled");
    return;
  }

  // ── Tools ─────────────────────────────────────────────────────────────────
  const tools = createCommentTools(store, nc);
  const toolsDisposable = bridge.registerTools("accordo-comments", tools);
  context.subscriptions.push(toolsDisposable);

  // ── State contribution ────────────────────────────────────────────────────
  const stateContrib = startStateContribution(bridge, store);
  context.subscriptions.push(stateContrib);
}

// ── deactivate ────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension host is being shut down.
 */
export function deactivate(): void {
  // Subscriptions added to context.subscriptions are disposed automatically.
}
