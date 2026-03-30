/**
 * accordo-comments — Bridge Integration
 *
 * Registers internal inter-extension commands (`accordo_comments_internal_*`)
 * that other Accordo extensions call to interact with the comment store.
 *
 * Also exports shared types: BridgeAPI and SurfaceCommentAdapter.
 *
 * Source: comments-architecture.md §10.3
 */

import * as vscode from "vscode";
import type {
  ExtensionToolDefinition,
  CommentAnchor,
  CommentAnchorSurface,
  CommentAnchorText,
  BlockCoordinates,
  CommentIntent,
  CommentThread,
} from "@accordo/bridge-types";
import { CAPABILITY_COMMANDS } from "@accordo/capabilities";
import type { SurfaceCommentAdapter } from "@accordo/capabilities";
import type { CommentStore } from "./comment-store.js";
import type { NativeComments } from "./native-comments.js";

// ── BridgeAPI ─────────────────────────────────────────────────────────────────

/** Subset of accordo-bridge BridgeAPI used by this extension. */
export interface BridgeAPI {
  registerTools(
    extensionId: string,
    tools: ExtensionToolDefinition[],
  ): { dispose(): void };
  publishState(extensionId: string, state: Record<string, unknown>): void;
}

// ── SurfaceCommentAdapter ────────────────────────────────────────────────────

/**
 * Re-exported from @accordo/capabilities — canonical location.
 * Source: requirements-comments.md §5.2 (M40-EXT-11)
 */
export type { SurfaceCommentAdapter } from "@accordo/capabilities";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive a BlockCoordinates.blockType from the block-id string.
 * Format: "heading:{level}:{slug}" | "p:{index}" | "li:{listIdx}:{itemIdx}" | "pre:{index}"
 */
function inferBlockType(blockId: string): BlockCoordinates["blockType"] {
  if (blockId.startsWith("heading:")) return "heading";
  if (blockId.startsWith("li:")) return "list-item";
  if (blockId.startsWith("pre:")) return "code-block";
  return "paragraph";
}

/** Shared CRUD methods for both getStore and getSurfaceAdapter adapters. */
function buildSharedAdapterMethods(store: CommentStore, nc: NativeComments): Omit<SurfaceCommentAdapter, "createThread"> {
  return {
    async reply(args) {
      await store.reply({ threadId: args.threadId, body: args.body, author: { kind: "user", name: "User" } });
      const updated = store.getThread(args.threadId);
      if (updated) nc.updateThread(updated);
    },
    async resolve(args) {
      await store.resolve({ threadId: args.threadId, resolutionNote: args.resolutionNote ?? "", author: { kind: "user", name: "User" } });
      const updated = store.getThread(args.threadId);
      if (updated) nc.updateThread(updated);
    },
    async reopen(args) {
      await store.reopen(args.threadId, { kind: "user", name: "User" });
      const updated = store.getThread(args.threadId);
      if (updated) nc.updateThread(updated);
    },
    async delete(args) {
      await store.delete({ threadId: args.threadId, commentId: args.commentId });
      const updated = store.getThread(args.threadId);
      if (updated) nc.updateThread(updated);
      else nc.removeThread(args.threadId);
    },
    getThreadsForUri(uri) { return store.getThreadsForUri(uri); },
    onChanged(listener) { return store.onChanged(listener); },
  };
}

// ── registerBridgeIntegrationCommands ─────────────────────────────────────────

/**
 * Registers all `accordo_comments_internal_*` commands used by other extensions.
 * Returns disposables to push into context.subscriptions.
 */
export function registerBridgeIntegrationCommands(
  store: CommentStore,
  nc: NativeComments,
): vscode.Disposable[] {
  const shared = buildSharedAdapterMethods(store, nc);

  return [
    // Adapter for accordo-md-viewer — creates anchors from blockId/line
    vscode.commands.registerCommand(CAPABILITY_COMMANDS.COMMENTS_GET_STORE, () => ({
      ...shared,
      async createThread(args: { uri: string; blockId: string; body: string; intent?: string; line?: number }) {
        let anchor: CommentAnchor;
        if (args.line !== undefined && args.line >= 0) {
          // Unified text anchor when source line is known
          const textAnchor: CommentAnchorText = {
            kind: "text", uri: args.uri,
            range: { startLine: args.line, startChar: 0, endLine: args.line, endChar: 0 },
            docVersion: 0,
          };
          anchor = textAnchor;
        } else {
          // Surface anchor fallback (legacy / no-line-mapping)
          const coords: BlockCoordinates = { type: "block", blockId: args.blockId, blockType: inferBlockType(args.blockId) };
          anchor = { kind: "surface", uri: args.uri, surfaceType: "markdown-preview", coordinates: coords } as CommentAnchorSurface;
        }
        const result = await store.createThread({ uri: args.uri, anchor, body: args.body, intent: args.intent as CommentIntent | undefined, author: { kind: "user", name: "User" } });
        const thread = store.getThread(result.threadId)!; // ! safe: createThread persists before returning
        nc.addThread(thread);
        return thread;
      },
    })),

    vscode.commands.registerCommand(CAPABILITY_COMMANDS.COMMENTS_GET_THREADS_FOR_URI,
      (uri: string) => store.getAllThreads().filter(t => t.anchor.uri === uri),
    ),

    vscode.commands.registerCommand(CAPABILITY_COMMANDS.COMMENTS_CREATE_SURFACE_COMMENT,
      async (params: Record<string, unknown>) => store.createThread({
        uri: params["uri"] as string,
        anchor: params["anchor"] as CommentAnchor,
        body: params["body"] as string,
        intent: params["intent"] as CommentIntent | undefined,
        author: { kind: "user", name: "User" },
      }),
    ),

    vscode.commands.registerCommand(CAPABILITY_COMMANDS.COMMENTS_RESOLVE_THREAD,
      async (threadId: string) => {
        await store.resolve({ threadId, resolutionNote: "Resolved via internal API", author: { kind: "user", name: "User" } });
        nc.updateThread(store.getThread(threadId)!); // ! safe: resolveThread succeeds only if thread exists
      },
    ),

    // Generalised surface adapter — M40-EXT-11
    // Accepts a full CommentAnchor from the caller; callers own anchor shape.
    vscode.commands.registerCommand(CAPABILITY_COMMANDS.COMMENTS_GET_SURFACE_ADAPTER,
      (): SurfaceCommentAdapter => ({
        ...shared,
        async createThread(args) {
          const result = await store.createThread({
            uri: args.uri, anchor: args.anchor, body: args.body,
            intent: args.intent as CommentIntent | undefined,
            author: { kind: "user", name: "User" },
          });
          const thread = store.getThread(result.threadId)!; // ! safe: createThread persists before returning
          nc.addThread(thread);
          return thread;
        },
      }),
    ),
  ];
}
