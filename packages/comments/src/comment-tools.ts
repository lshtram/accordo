/**
 * CommentTools — 6 MCP tools for agent interaction with comments.
 *
 * Tools: accordo_comment_list, .get, .create, .reply, .resolve, .delete
 * Registered via BridgeAPI.registerTools('accordo-comments', tools).
 *
 * Source: comments-architecture.md §6
 */

import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import type { ExtensionToolDefinition, CommentThread } from "@accordo/bridge-types";
import { COMMENT_CREATE_RATE_LIMIT, COMMENT_CREATE_RATE_WINDOW_MS } from "@accordo/bridge-types";
import type { CommentStore } from "./comment-store.js";
import type { CommentAnchor, CommentIntent, SurfaceCoordinates, SurfaceType } from "@accordo/bridge-types";

// ── URI normalizer ───────────────────────────────────────────────────────────

/**
 * Normalize any agent-supplied URI string into a canonical `file:///abs/path` URI.
 *
 * Accepts three input forms:
 *   - `file:///abs/path/to/file.ts`  — already canonical, re-normalized for safety
 *   - `/abs/path/to/file.ts`          — absolute FS path → converted to file URI
 *   - `relative/path/to/file.ts`      — resolved against workspaceRoot, then file URI
 *
 * Exported for unit testing and agent helper use.
 */
export function normalizeCommentUri(input: string, workspaceRoot: string): string {
  if (input.startsWith("file://")) {
    try {
      return pathToFileURL(path.resolve(fileURLToPath(input))).href;
    } catch {
      return input; // malformed URI — pass through unchanged
    }
  }
  if (path.isAbsolute(input)) {
    return pathToFileURL(path.resolve(input)).href;
  }
  // relative path — resolve against workspace root
  const base = workspaceRoot || process.cwd();
  return pathToFileURL(path.resolve(base, input)).href;
}

/**
 * Minimal interface for updating VS Code's native comment UI after store mutations.
 * Implemented by NativeComments in the extension; omitted (undefined) in tests.
 */
export interface CommentUINotifier {
  addThread(thread: CommentThread): void;
  updateThread(thread: CommentThread): void;
  removeThread(threadId: string): void;
}

/**
 * Create the array of 6 ExtensionToolDefinition for comment MCP tools.
 */
export function createCommentTools(store: CommentStore, ui?: CommentUINotifier): ExtensionToolDefinition[] {
  const rateLimiter = new CreateRateLimiter();

  const tools: ExtensionToolDefinition[] = [
    // ── accordo_comment_list ──────────────────────────────────────────────
    {
      name: "accordo_comment_list",
      group: "comments",
      description: "List comment threads. Pass uri to scope to one file; omitting queries all files. Filters: status, intent, limit, offset.",
      dangerLevel: "safe",
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          uri: { type: "string", description: "Filter by file — any form accepted: file:///abs, /abs, or repo-relative" },
          status: { type: "string", description: "Filter by status", enum: ["open", "resolved"] },
          intent: { type: "string", description: "Filter by intent", enum: ["fix", "explain", "refactor", "review", "design", "question"] },
          anchorKind: { type: "string", description: "Filter by anchor type", enum: ["text", "surface", "file"] },
          updatedSince: { type: "string", description: "ISO 8601 timestamp — return only threads active after this time" },
          lastAuthor: { type: "string", description: "Return threads whose last comment was from this author kind", enum: ["user", "agent"] },
          limit: { type: "number", description: "Max results to return (default 20 when unfiltered, 50 when uri is specified; max 200)" },
          offset: { type: "number", description: "Pagination offset (default 0)" },
        },
        required: [],
      },
      handler: async (args) => {
        const rawUri = args["uri"] as string | undefined;
        const uri = rawUri !== undefined ? normalizeCommentUri(rawUri, store.getWorkspaceRoot()) : undefined;
        return store.listThreads({
          uri,
          status: args["status"] as "open" | "resolved" | undefined,
          intent: args["intent"] as CommentIntent | undefined,
          anchorKind: args["anchorKind"] as "text" | "surface" | "file" | undefined,
          updatedSince: args["updatedSince"] as string | undefined,
          lastAuthor: args["lastAuthor"] as "user" | "agent" | undefined,
          limit: args["limit"] as number | undefined,
          offset: args["offset"] as number | undefined,
        });
      },
    },

    // ── accordo_comment_get ───────────────────────────────────────────────
    {
      name: "accordo_comment_get",
      group: "comments",
      description: "Get a specific comment thread with all comments and context.",
      dangerLevel: "safe",
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "The thread ID to retrieve" },
        },
        required: ["threadId"],
      },
      handler: async (args) => {
        const threadId = args["threadId"] as string;
        const thread = store.getThread(threadId);
        if (!thread) throw new Error(`Thread not found: ${threadId}`);
        return { thread };
      },
    },

    // ── accordo_comment_create ────────────────────────────────────────────
    {
      name: "accordo_comment_create",
      group: "comments",
      description: "Create a comment thread. anchor: {kind:'text',startLine:N} or {kind:'file'}. intent: fix|explain|refactor|review|design",
      dangerLevel: "moderate",
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          uri: { type: "string", description: "File path or URI — any form accepted: file:///abs, /abs, or repo-relative" },
          anchor: {
            type: "object",
            description: "Where the comment is anchored",
            properties: {
              kind: {
                type: "string",
                enum: ["text", "file"],
                description: "'text' to anchor to a line range, 'file' for a whole-file comment",
              },
              startLine: {
                type: "number",
                description: "0-based start line — required when kind='text'",
              },
              endLine: {
                type: "number",
                description: "0-based end line (inclusive) — defaults to startLine when kind='text'",
              },
            },
            required: ["kind"],
          },
          body: { type: "string", description: "Comment body (Markdown supported)" },
          intent: {
            type: "string",
            description: "Optional intent tag",
            enum: ["fix", "explain", "refactor", "review", "design", "question"],
          },
        },
        required: ["uri", "anchor", "body"],
      },
      handler: async (args) => {
        const rawUri = args["uri"] as string;
        const uri = normalizeCommentUri(rawUri, store.getWorkspaceRoot());
        const anchorInput = args["anchor"] as Record<string, unknown>;
        const body = args["body"] as string;
        const intent = args["intent"] as CommentIntent | undefined;
        const agentId = (args["agentId"] as string | undefined) ?? "default";

        if (!rateLimiter.isAllowed(agentId)) {
          throw new Error(`Rate limit exceeded: max ${COMMENT_CREATE_RATE_LIMIT} comment creates per minute`);
        }
        rateLimiter.record(agentId);

        const anchor = buildAnchor(uri, anchorInput);

        const result = await store.createThread({
          uri,
          anchor,
          body,
          intent,
          author: { kind: "agent", name: "agent", agentId },
        });
        const newThread = store.getThread(result.threadId);
        if (newThread) ui?.addThread(newThread);
        return { created: true, threadId: result.threadId, commentId: result.commentId };
      },
    },

    // ── accordo_comment_reply ─────────────────────────────────────────────
    {
      name: "accordo_comment_reply",
      group: "comments",
      description: "Reply to an existing comment thread. Use accordo_comment_list to find threadId values.",
      dangerLevel: "moderate",
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "The thread to reply to" },
          body: { type: "string", description: "Reply body (Markdown)" },
        },
        required: ["threadId", "body"],
      },
      handler: async (args) => {
        const threadId = args["threadId"] as string;
        const body = args["body"] as string;
        const agentId = (args["agentId"] as string | undefined) ?? "default";
        const result = await store.reply({
          threadId,
          body,
          author: { kind: "agent", name: "agent", agentId },
        });
        const repliedThread = store.getThread(threadId);
        if (repliedThread) ui?.updateThread(repliedThread);
        return { replied: true, commentId: result.commentId };
      },
    },

    // ── accordo_comment_resolve ───────────────────────────────────────────
    {
      name: "accordo_comment_resolve",
      group: "comments",
      description: "Mark a comment thread as resolved. Always include a resolutionNote summarising what was done.",
      dangerLevel: "moderate",
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "The thread to resolve" },
          resolutionNote: { type: "string", description: "What was done to resolve the comment" },
        },
        required: ["threadId", "resolutionNote"],
      },
      handler: async (args) => {
        const threadId = args["threadId"] as string;
        const resolutionNote = args["resolutionNote"] as string;
        const agentId = (args["agentId"] as string | undefined) ?? "default";
        await store.resolve({
          threadId,
          resolutionNote,
          author: { kind: "agent", name: "agent", agentId },
        });
        const resolvedThread = store.getThread(threadId);
        if (resolvedThread) ui?.updateThread(resolvedThread);
        return { resolved: true, threadId };
      },
    },

    // ── accordo_comment_delete ────────────────────────────────────────────
    {
      name: "accordo_comment_delete",
      group: "comments",
      description: "Delete a specific comment or an entire comment thread.",
      dangerLevel: "moderate",
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "The thread to delete (or containing the comment)" },
          commentId: { type: "string", description: "If provided, delete only this comment; otherwise delete the entire thread" },
        },
        required: ["threadId"],
      },
      handler: async (args) => {
        const threadId = args["threadId"] as string;
        const commentId = args["commentId"] as string | undefined;
        await store.delete({ threadId, commentId });
        if (commentId) {
          // Removed a single comment — update the thread widget
          const updatedThread = store.getThread(threadId);
          if (updatedThread) ui?.updateThread(updatedThread);
        } else {
          // Removed the whole thread — destroy the widget
          ui?.removeThread(threadId);
        }
        return { deleted: true };
      },
    },
  ];

  return tools;
}

// ── Anchor builder ─────────────────────────────────────────────────────────

function buildAnchor(uri: string, input: Record<string, unknown>): CommentAnchor {
  const kind = input["kind"] as string;
  if (kind === "text") {
    const startLine = input["startLine"] as number;
    const endLine = (input["endLine"] as number | undefined) ?? startLine;
    return {
      kind: "text",
      uri,
      range: { startLine, startChar: 0, endLine, endChar: 0 },
      docVersion: 0,
    };
  }
  // file-level anchor (default)
  return { kind: "file", uri };
}

/**
 * Rate limiter for comment.create — 10 per minute per agent.
 * Exported for testing.
 *
 * Source: comments-architecture.md §6.1
 */
export class CreateRateLimiter {
  /** Maps agentId → array of timestamps (ms) of recent creates */
  private readonly _windows = new Map<string, number[]>();

  /** Check if a create is allowed for the given agent. */
  isAllowed(agentId: string): boolean {
    this._purge(agentId);
    const count = this._windows.get(agentId)?.length ?? 0;
    return count < COMMENT_CREATE_RATE_LIMIT;
  }

  /** Record a create for the given agent. */
  record(agentId: string): void {
    this._purge(agentId);
    const times = this._windows.get(agentId) ?? [];
    times.push(Date.now());
    this._windows.set(agentId, times);
  }

  /** Reset all rate limit state. */
  reset(): void {
    this._windows.clear();
  }

  private _purge(agentId: string): void {
    const cutoff = Date.now() - COMMENT_CREATE_RATE_WINDOW_MS;
    const times = this._windows.get(agentId);
    if (!times) return;
    const fresh = times.filter(t => t > cutoff);
    if (fresh.length === 0) this._windows.delete(agentId);
    else this._windows.set(agentId, fresh);
  }
}
