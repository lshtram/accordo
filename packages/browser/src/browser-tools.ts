import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";

export function createBrowserTools(relay: BrowserRelayLike): ExtensionToolDefinition[] {
  return [
    {
      name: "accordo_browser_getAllComments",
      description: "List all commented pages sorted by recent activity",
      inputSchema: {
        type: "object",
        properties: {},
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: async () => relay.request("get_all_comments", {}),
    },
    {
      name: "accordo_browser_getComments",
      description: "Get browser comments for a URL (defaults to active tab)",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Optional page URL; defaults to active tab URL" },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: async (args) => relay.request("get_comments", {
        ...(args.url !== undefined ? { url: String(args.url) } : {}),
      }),
    },
    {
      name: "accordo_browser_createComment",
      description: "Create a new browser comment thread (defaults to active tab and center anchor)",
      inputSchema: {
        type: "object",
        properties: {
          body: { type: "string", description: "Comment text" },
          url: { type: "string", description: "Optional page URL; defaults to active tab URL" },
          anchorKey: { type: "string", description: "Optional anchor key; defaults to body:center" },
          authorName: { type: "string", description: "Optional author name; defaults to Agent" },
        },
        required: ["body"],
      },
      dangerLevel: "moderate",
      handler: async (args) => relay.request("create_comment", {
        body: String(args.body ?? ""),
        ...(args.url !== undefined ? { url: String(args.url) } : {}),
        ...(args.anchorKey !== undefined ? { anchorKey: String(args.anchorKey) } : {}),
        ...(args.authorName !== undefined ? { authorName: String(args.authorName) } : {}),
      }),
    },
    {
      name: "accordo_browser_replyComment",
      description: "Reply to a browser comment thread",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string" },
          body: { type: "string" },
          authorName: { type: "string" },
        },
        required: ["threadId", "body"],
      },
      dangerLevel: "moderate",
      handler: async (args) => relay.request("reply_comment", {
        threadId: String(args.threadId ?? ""),
        body: String(args.body ?? ""),
        authorName: String(args.authorName ?? "Agent"),
      }),
    },
    {
      name: "accordo_browser_resolveThread",
      description: "Resolve a browser comment thread",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string" },
          resolutionNote: { type: "string" },
        },
        required: ["threadId"],
      },
      dangerLevel: "moderate",
      handler: async (args) => relay.request("resolve_thread", {
        threadId: String(args.threadId ?? ""),
        ...(args.resolutionNote !== undefined ? { resolutionNote: String(args.resolutionNote) } : {}),
      }),
    },
    {
      name: "accordo_browser_reopenThread",
      description: "Reopen a resolved browser comment thread",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string" },
        },
        required: ["threadId"],
      },
      dangerLevel: "moderate",
      handler: async (args) => relay.request("reopen_thread", {
        threadId: String(args.threadId ?? ""),
      }),
    },
    {
      name: "accordo_browser_deleteComment",
      description: "Delete one browser comment in a thread",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string" },
          commentId: { type: "string" },
        },
        required: ["threadId", "commentId"],
      },
      dangerLevel: "destructive",
      handler: async (args) => relay.request("delete_comment", {
        threadId: String(args.threadId ?? ""),
        commentId: String(args.commentId ?? ""),
      }),
    },
    {
      name: "accordo_browser_deleteThread",
      description: "Delete a browser comment thread",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string" },
        },
        required: ["threadId"],
      },
      dangerLevel: "destructive",
      handler: async (args) => relay.request("delete_thread", {
        threadId: String(args.threadId ?? ""),
      }),
    },
  ];
}
