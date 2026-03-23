/**
 * CommentTools — 7 MCP tools for agent interaction with comments.
 *
 * Tools: comment_list, comment_get, comment_create, comment_reply,
 * comment_resolve, comment_reopen, comment_delete
 * Registered via BridgeAPI.registerTools('accordo-comments', tools).
 *
 * Source: comments-architecture.md §6
 */

import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import type { ExtensionToolDefinition, CommentThread } from "@accordo/bridge-types";
import { COMMENT_CREATE_RATE_LIMIT, COMMENT_CREATE_RATE_WINDOW_MS } from "@accordo/bridge-types";
import type { CommentStore } from "./comment-store.js";
import type { CommentAnchor, CommentIntent, SurfaceCoordinates, SurfaceType, CommentRetention } from "@accordo/bridge-types";

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
 * Create the array of 7 ExtensionToolDefinition for comment MCP tools.
 *
 * Tools: comment_list, comment_get, comment_create, comment_reply,
 * comment_resolve, comment_reopen, comment_delete
 *
 * Source: comments-architecture.md §6, §10.4, requirements-comments.md M38-CT-01..11
 */
export function createCommentTools(store: CommentStore, ui?: CommentUINotifier): ExtensionToolDefinition[] {
  const rateLimiter = new CreateRateLimiter();

  const tools: ExtensionToolDefinition[] = [
    // ── comment_list ──────────────────────────────────────────────────
    {
      name: "comment_list",
      group: "comments",
      description: "List comment threads. Use scope.modality to filter by surface type (e.g. browser). Filters: status, intent.",
      dangerLevel: "safe",
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "object",
            description: "Optional modality scope — filters by surface type. Use scope.modality='browser' for browser comments, scope.url to filter by page URL.",
            properties: {
              modality: { type: "string", description: "Surface modality", enum: ["text", "markdown-preview", "diagram", "slide", "image", "pdf", "browser"] },
              uri: { type: "string", description: "File URI for non-browser modalities" },
              url: { type: "string", description: "Page URL for browser modality" },
            },
          },
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
        const scope = args["scope"] as Record<string, unknown> | undefined;
        const rawUri = (scope?.["uri"] as string | undefined) ?? (args["uri"] as string | undefined);
        const uri = rawUri !== undefined ? normalizeCommentUri(rawUri, store.getWorkspaceRoot()) : undefined;

        // Modality scope maps to anchorKind + surfaceType
        let anchorKind = args["anchorKind"] as "text" | "surface" | "file" | undefined;
        let surfaceType: string | undefined;

        if (scope?.["modality"]) {
          const modality = scope["modality"] as string;
          if (modality === "text") {
            anchorKind = "text";
          } else {
            anchorKind = "surface";
            surfaceType = modality;
          }
        }

        return store.listThreads({
          uri,
          status: args["status"] as "open" | "resolved" | undefined,
          intent: args["intent"] as CommentIntent | undefined,
          anchorKind,
          surfaceType,
          updatedSince: args["updatedSince"] as string | undefined,
          lastAuthor: args["lastAuthor"] as "user" | "agent" | undefined,
          limit: args["limit"] as number | undefined,
          offset: args["offset"] as number | undefined,
        });
      },
    },

    // ── comment_get ──────────────────────────────────────────────────
    {
      name: "comment_get",
      group: "comments",
      description: "Get a specific comment thread with all comments and context. Pass threadId.",
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

    // ── comment_create ────────────────────────────────────────────────
    {
      name: "comment_create",
      group: "comments",
      description: "Create a comment thread on any surface. Set scope.modality + anchor.kind to target text, browser, or visual.",
      dangerLevel: "moderate",
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "object",
            description: "Modality scope — determines the surface type and routing.",
            properties: {
              modality: { type: "string", description: "Surface modality", enum: ["text", "markdown-preview", "diagram", "slide", "image", "pdf", "browser"] },
              uri: { type: "string", description: "File URI for non-browser modalities" },
              url: { type: "string", description: "Page URL for browser modality" },
            },
          },
          uri: { type: "string", description: "File path or URI — any form accepted: file:///abs, /abs, or repo-relative" },
          anchor: {
            type: "object",
            description: "Where the comment is anchored",
            properties: {
              kind: {
                type: "string",
                enum: ["text", "file", "surface", "browser"],
                description: "'text' for line range, 'file' for whole-file, 'surface' for visual surfaces, 'browser' for browser pages",
              },
              startLine: {
                type: "number",
                description: "0-based start line — required when kind='text'",
              },
              endLine: {
                type: "number",
                description: "0-based end line (inclusive) — defaults to startLine when kind='text'",
              },
              surfaceType: {
                type: "string",
                description: "Surface type — required when kind='surface'",
              },
              coordinates: {
                type: "object",
                description: "Surface coordinates — required when kind='surface'",
              },
              anchorKey: {
                type: "string",
                description: "Browser anchor key — optional when kind='browser', defaults to body:center",
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
        required: ["body"],
      },
      handler: async (args) => {
        const scope = args["scope"] as Record<string, unknown> | undefined;
        const rawUri = (scope?.["uri"] as string | undefined) ?? (args["uri"] as string | undefined);
        const uri = rawUri !== undefined ? normalizeCommentUri(rawUri, store.getWorkspaceRoot()) : undefined;
        const anchorInput = args["anchor"] as Record<string, unknown> | undefined;
        const body = args["body"] as string;
        const intent = args["intent"] as CommentIntent | undefined;
        const agentId = (args["agentId"] as string | undefined) ?? "default";
        const modality = scope?.["modality"] as string | undefined;

        if (!rateLimiter.isAllowed(agentId)) {
          throw new Error(`Rate limit exceeded: max ${COMMENT_CREATE_RATE_LIMIT} comment creates per minute`);
        }
        rateLimiter.record(agentId);

        // Determine retention from modality
        const retention: CommentRetention = modality === "browser" ? "volatile-browser" : "standard";

        // Build the final URI — browser modality uses scope.url if no file URI
        const finalUri = uri ?? (scope?.["url"] as string | undefined) ?? "";
        if (!finalUri) {
          throw new Error("Either uri or scope.url is required");
        }

        const anchor = buildAnchor(finalUri, anchorInput ?? { kind: modality === "text" ? "text" : "file" }, modality);

        const result = await store.createThread({
          uri: finalUri,
          anchor,
          body,
          intent,
          retention,
          author: { kind: "agent", name: "agent", agentId },
        });
        const newThread = store.getThread(result.threadId);
        if (newThread) ui?.addThread(newThread);
        return { created: true, threadId: result.threadId, commentId: result.commentId };
      },
    },

    // ── comment_reply ─────────────────────────────────────────────────
    {
      name: "comment_reply",
      group: "comments",
      description: "Reply to an existing comment thread. Use comment_list to find threadId values.",
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

    // ── comment_resolve ────────────────────────────────────────────────
    {
      name: "comment_resolve",
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

    // ── comment_reopen ────────────────────────────────────────────────
    {
      name: "comment_reopen",
      group: "comments",
      description: "Reopen a resolved comment thread. Both users and agents can reopen.",
      dangerLevel: "moderate",
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "The thread to reopen" },
        },
        required: ["threadId"],
      },
      handler: async (args) => {
        const threadId = args["threadId"] as string;
        const agentId = (args["agentId"] as string | undefined) ?? "default";
        await store.reopen(threadId, { kind: "agent", name: "agent", agentId });
        const reopenedThread = store.getThread(threadId);
        if (reopenedThread) ui?.updateThread(reopenedThread);
        return { reopened: true, threadId };
      },
    },

    // ── comment_delete ──────────────────────────────────────────────────
    {
      name: "comment_delete",
      group: "comments",
      description: "Delete a specific comment or entire thread. Use deleteScope for bulk browser cleanup.",
      dangerLevel: "moderate",
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "The thread to delete (or containing the comment)" },
          commentId: { type: "string", description: "If provided, delete only this comment; otherwise delete the entire thread" },
          deleteScope: {
            type: "object",
            description: "Bulk delete scope — use { modality: 'browser', all: true } to delete all browser threads",
            properties: {
              modality: { type: "string", description: "Surface modality to delete", enum: ["browser"] },
              all: { type: "boolean", description: "Must be true for bulk delete" },
            },
            required: ["modality", "all"],
          },
        },
        required: [],
      },
      handler: async (args) => {
        const deleteScope = args["deleteScope"] as Record<string, unknown> | undefined;

        // Bulk delete by modality (M38-CT-07)
        if (deleteScope && deleteScope["all"] === true && deleteScope["modality"]) {
          const modality = deleteScope["modality"] as string;
          const count = await store.deleteAllByModality(modality);
          return { deleted: true, deletedCount: count };
        }

        // Single thread/comment delete
        const threadId = args["threadId"] as string;
        if (!threadId) {
          throw new Error("Either threadId or deleteScope is required");
        }
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

/**
 * Build a CommentAnchor from tool input.
 *
 * Supports all anchor kinds:
 * - "text"    → text range anchor
 * - "file"    → file-level anchor
 * - "surface" → surface anchor with surfaceType + coordinates
 * - "browser" → sugar for surface anchor with surfaceType="browser"
 *
 * Source: comments-architecture.md §3.1, requirements-comments.md M38-CT-03
 */
function buildAnchor(uri: string, input: Record<string, unknown>, modality?: string): CommentAnchor {
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

  if (kind === "surface") {
    const surfaceType = (input["surfaceType"] as SurfaceType) ?? (modality as SurfaceType);
    const coordinates = input["coordinates"] as SurfaceCoordinates;
    if (!surfaceType) throw new Error("surfaceType is required for surface anchors");
    if (!coordinates) throw new Error("coordinates are required for surface anchors");
    return {
      kind: "surface",
      uri,
      surfaceType,
      coordinates,
    };
  }

  if (kind === "browser") {
    // Browser anchor is sugar for a surface anchor with surfaceType="browser"
    // and normalized coordinates. anchorKey is stored in surfaceMetadata (context).
    const anchorKey = input["anchorKey"] as string | undefined;
    const coordinates: SurfaceCoordinates = {
      type: "normalized",
      x: 0.5,
      y: 0.5,
    };
    // If anchorKey is provided, we could parse x:y from it, but the default is center
    if (anchorKey) {
      const parts = anchorKey.split(":");
      if (parts.length === 2) {
        const x = parseFloat(parts[0]);
        const y = parseFloat(parts[1]);
        if (!isNaN(x) && !isNaN(y)) {
          (coordinates as { type: "normalized"; x: number; y: number }).x = x;
          (coordinates as { type: "normalized"; x: number; y: number }).y = y;
        }
      }
    }
    return {
      kind: "surface",
      uri,
      surfaceType: "browser" as SurfaceType,
      coordinates,
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
