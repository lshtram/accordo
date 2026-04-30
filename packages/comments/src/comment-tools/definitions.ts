/**
 * Comment tool schema definitions — name, description, inputSchema only.
 * No handler logic lives here.
 *
 * Source: comments-architecture.md §6, requirements-comments.md M38-CT-01..11
 */

import type { ToolInputSchema } from "@accordo/bridge-types";

const COMMENT_SKILL = " See accordo://skills/accordo.";

/** Minimal tool definition shape used before handlers are attached. */
export interface ToolSchema {
  name: string;
  group: string;
  description: string;
  dangerLevel: "safe" | "moderate" | "destructive";
  idempotent: boolean;
  inputSchema: ToolInputSchema;
}

/** All 8 comment tool schemas. */
export const commentToolSchemas: ToolSchema[] = [
  // ── comment_list ────────────────────────────────────────────────────
  {
    name: "comment_list",
    group: "comments",
    description:
      "List comments. Filter by scope.modality, status, or intent." + COMMENT_SKILL,
    dangerLevel: "safe",
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "object",
          description:
            "Optional modality scope — filters by surface type. Use scope.modality='browser' for browser comments, scope.url to filter by page URL.",
          properties: {
            modality: {
              type: "string",
              description: "Surface modality",
              enum: ["text", "markdown-preview", "diagram", "slide", "image", "pdf", "browser"],
            },
            uri: { type: "string", description: "File URI for non-browser modalities" },
            url: { type: "string", description: "Page URL for browser modality" },
          },
        },
        uri: {
          type: "string",
          description: "Filter by file — any form accepted: file:///abs, /abs, or repo-relative",
        },
        status: { type: "string", description: "Filter by status", enum: ["open", "resolved"] },
        intent: {
          type: "string",
          description: "Filter by intent",
          enum: ["fix", "explain", "refactor", "review", "design", "question"],
        },
        anchorKind: {
          type: "string",
          description: "Filter by anchor type",
          enum: ["text", "surface", "file"],
        },
        updatedSince: {
          type: "string",
          description: "ISO 8601 timestamp — return only threads active after this time",
        },
        lastAuthor: {
          type: "string",
          description: "Return threads whose last comment was from this author kind",
          enum: ["user", "agent"],
        },
        limit: {
          type: "number",
          description: "Max results to return (default 20 when unfiltered, 50 when uri is specified; max 200)",
        },
        offset: { type: "number", description: "Pagination offset (default 0)" },
        detail: {
          type: "boolean",
          description: "When true, returns full CommentThread[] with all comments instead of summaries",
        },
      },
      required: [],
    },
  },

  // ── comment_get ──────────────────────────────────────────────────────
  {
    name: "comment_get",
    group: "comments",
    description: "Get one comment thread with comments and context." + COMMENT_SKILL,
    dangerLevel: "safe",
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "The thread ID to retrieve" },
      },
      required: ["threadId"],
    },
  },

  // ── comment_create ───────────────────────────────────────────────────
  {
    name: "comment_create",
    group: "comments",
    description:
      "Create a comment thread. Set scope.modality and anchor.kind." + COMMENT_SKILL,
    dangerLevel: "moderate",
    idempotent: false,
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "object",
          description: "Modality scope — determines the surface type and routing.",
          properties: {
            modality: {
              type: "string",
              description: "Surface modality",
              enum: ["text", "markdown-preview", "diagram", "slide", "image", "pdf", "browser"],
            },
            uri: { type: "string", description: "File URI for non-browser modalities" },
            url: { type: "string", description: "Page URL for browser modality" },
          },
        },
        uri: {
          type: "string",
          description: "File path or URI — any form accepted: file:///abs, /abs, or repo-relative",
        },
        anchor: {
          type: "object",
          description: "Where the comment is anchored",
          properties: {
            kind: {
              type: "string",
              enum: ["text", "file", "surface", "browser"],
              description:
                "'text' for line range, 'file' for whole-file, 'surface' for visual surfaces, 'browser' for browser pages",
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
        threadId: {
          type: "string",
          description: "Optional caller-supplied thread ID (for cross-surface ID parity)",
        },
        commentId: { type: "string", description: "Optional caller-supplied first-comment ID" },
        context: {
          type: "object",
          description: "Optional captured context (surfaceMetadata, diagnostics, etc.)",
        },
        intent: {
          type: "string",
          description: "Optional intent tag",
          enum: ["fix", "explain", "refactor", "review", "design", "question"],
        },
      },
      required: ["body"],
    },
  },

  // ── comment_reply ─────────────────────────────────────────────────────
  {
    name: "comment_reply",
    group: "comments",
    description: "Reply to a comment thread by threadId." + COMMENT_SKILL,
    dangerLevel: "moderate",
    idempotent: false,
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "The thread to reply to" },
        body: { type: "string", description: "Reply body (Markdown)" },
        commentId: {
          type: "string",
          description: "Optional caller-supplied comment ID for cross-origin ID parity",
        },
      },
      required: ["threadId", "body"],
    },
  },

  // ── comment_resolve ───────────────────────────────────────────────────
  {
    name: "comment_resolve",
    group: "comments",
    description:
      "Resolve a comment thread with a resolutionNote." + COMMENT_SKILL,
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
  },

  // ── comment_reopen ────────────────────────────────────────────────────
  {
    name: "comment_reopen",
    group: "comments",
    description: "Reopen a resolved comment thread." + COMMENT_SKILL,
    dangerLevel: "moderate",
    idempotent: false,
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "The thread to reopen" },
      },
      required: ["threadId"],
    },
  },

  // ── comment_delete ────────────────────────────────────────────────────
  {
    name: "comment_delete",
    group: "comments",
    description:
      "Delete a comment, thread, or deleteScope batch." + COMMENT_SKILL,
    dangerLevel: "moderate",
    idempotent: false,
    inputSchema: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          description: "The thread to delete (or containing the comment)",
        },
        commentId: {
          type: "string",
          description: "If provided, delete only this comment; otherwise delete the entire thread",
        },
        deleteScope: {
          type: "object",
          description:
            "Bulk delete scope — use { modality: 'browser', all: true } to delete all browser threads",
          properties: {
            modality: {
              type: "string",
              description: "Surface modality to delete",
              enum: ["browser"],
            },
            all: { type: "boolean", description: "Must be true for bulk delete" },
          },
          required: ["modality", "all"],
        },
      },
      required: [],
    },
  },

  // ── comment_sync_version ──────────────────────────────────────────────
  {
    name: "comment_sync_version",
    group: "comments",
    description:
      "Return comment store version and thread count." + COMMENT_SKILL,
    dangerLevel: "safe",
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];
