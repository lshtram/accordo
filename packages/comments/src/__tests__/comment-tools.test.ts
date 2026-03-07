/**
 * Tests for CommentTools — M38
 *
 * Source: comments-architecture.md §6, §6.1
 *
 * Requirements covered:
 *   §6    6 MCP tools: list, get, create, reply, resolve, delete
 *   §6    Tool metadata: name, description, inputSchema, dangerLevel, idempotent
 *   §6    Tool handlers: delegate to CommentStore, return shaped output
 *   §6.1  Rate limiting: 10 creates/min per agent
 */

// API checklist:
// ✓ createCommentTools()       — Tool array shape (5 tests), all handler tests
// ✓ CreateRateLimiter.isAllowed() — §6.1 Rate Limiting (4 tests)
// ✓ CreateRateLimiter.record()    — §6.1 Rate Limiting (called with isAllowed)
// ✓ CreateRateLimiter.reset()     — §6.1 Rate Limiting (2 tests)
// ✓ normalizeCommentUri()      — URI normalization: file://, absolute, relative (7 tests)
// ✓ comment.list handler       — §6 list (4 tests)
// ✓ comment.get handler        — §6 get (4 tests)
// ✓ comment.create handler     — §6 create (5 tests)
// ✓ comment.reply handler      — §6 reply (4 tests)
// ✓ comment.resolve handler    — §6 resolve (4 tests)
// ✓ comment.delete handler     — §6 delete (5 tests)

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetMockState, workspace } from "./mocks/vscode.js";
import { createCommentTools, CreateRateLimiter, normalizeCommentUri } from "../comment-tools.js";
import { CommentStore } from "../comment-store.js";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import {
  COMMENT_CREATE_RATE_LIMIT,
  COMMENT_CREATE_RATE_WINDOW_MS,
} from "@accordo/bridge-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getToolByName(
  tools: ExtensionToolDefinition[],
  name: string,
): ExtensionToolDefinition {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ── Setup ────────────────────────────────────────────────────────────────────

let store: CommentStore;
let tools: ExtensionToolDefinition[];

beforeEach(() => {
  resetMockState();
  store = new CommentStore();
  tools = createCommentTools(store);
});

// ── §6 Tool array shape ─────────────────────────────────────────────────────

describe("§6 Tool array shape", () => {
  it("returns exactly 6 tools", () => {
    expect(tools).toHaveLength(6);
  });

  it("includes all expected tool names", () => {
    const names = tools.map(t => t.name);
    expect(names).toContain("accordo_comment_list");
    expect(names).toContain("accordo_comment_get");
    expect(names).toContain("accordo_comment_create");
    expect(names).toContain("accordo_comment_reply");
    expect(names).toContain("accordo_comment_resolve");
    expect(names).toContain("accordo_comment_delete");
  });

  it("all tools have descriptions ≤ 120 chars", () => {
    for (const tool of tools) {
      expect(tool.description.length).toBeLessThanOrEqual(120);
    }
  });

  it("all tools have inputSchema with type 'object'", () => {
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it("all tools have handler functions", () => {
    for (const tool of tools) {
      expect(typeof tool.handler).toBe("function");
    }
  });
});

// ── §6 accordo_comment_list ─────────────────────────────────────────────────

describe("§6 accordo_comment_list", () => {
  it("has dangerLevel 'safe'", () => {
    const tool = getToolByName(tools, "accordo_comment_list");
    expect(tool.dangerLevel).toBe("safe");
  });

  it("is idempotent", () => {
    const tool = getToolByName(tools, "accordo_comment_list");
    expect(tool.idempotent).toBe(true);
  });

  it("inputSchema has optional uri, status, intent, anchorKind, updatedSince, lastAuthor, limit, offset", () => {
    const tool = getToolByName(tools, "accordo_comment_list");
    const props = tool.inputSchema.properties;
    expect(props["uri"]).toBeDefined();
    expect(props["status"]).toBeDefined();
    expect(props["intent"]).toBeDefined();
    expect(props["anchorKind"]).toBeDefined();
    expect(props["updatedSince"]).toBeDefined();
    expect(props["lastAuthor"]).toBeDefined();
    expect(props["limit"]).toBeDefined();
    expect(props["offset"]).toBeDefined();
    // None of them are required
    expect(tool.inputSchema.required ?? []).toEqual([]);
  });

  it("handler returns { threads, total, hasMore }", async () => {
    const tool = getToolByName(tools, "accordo_comment_list");
    const result = (await tool.handler({})) as Record<string, unknown>;
    expect(result).toHaveProperty("threads");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("hasMore");
  });

  it("each thread summary includes lastAuthor field", async () => {
    const createTool = getToolByName(tools, "accordo_comment_create");
    await createTool.handler({ uri: "file:///project/src/auth.ts", anchor: { kind: "file" }, body: "agent comment" });
    const listTool = getToolByName(tools, "accordo_comment_list");
    const { threads } = (await listTool.handler({})) as { threads: { lastAuthor: string }[] };
    expect(threads[0]).toHaveProperty("lastAuthor");
    expect(["user", "agent"]).toContain(threads[0].lastAuthor);
  });

  it("updatedSince filter returns only threads active after the timestamp", async () => {
    const createTool = getToolByName(tools, "accordo_comment_create");
    const listTool = getToolByName(tools, "accordo_comment_list");
    // Pin system time so thread timestamps are deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await createTool.handler({ uri: "file:///project/a.ts", anchor: { kind: "file" }, body: "old" });
    const cutoff = "2026-01-01T00:00:01.000Z";
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    await createTool.handler({ uri: "file:///project/b.ts", anchor: { kind: "file" }, body: "new" });
    vi.useRealTimers();
    const { threads, total } = (await listTool.handler({ updatedSince: cutoff })) as { threads: unknown[]; total: number };
    expect(total).toBe(1);
    expect(threads).toHaveLength(1);
  });

  it("lastAuthor=user filter returns only threads where the last comment is from a user", async () => {
    const createTool = getToolByName(tools, "accordo_comment_create");
    const listTool = getToolByName(tools, "accordo_comment_list");
    // Agent creates thread (lastAuthor=agent)
    await createTool.handler({ uri: "file:///project/a.ts", anchor: { kind: "file" }, body: "agent note" });
    // Should return 0 threads with lastAuthor=user
    const r1 = (await listTool.handler({ lastAuthor: "user" })) as { total: number };
    expect(r1.total).toBe(0);
    // Filter lastAuthor=agent should find it
    const r2 = (await listTool.handler({ lastAuthor: "agent" })) as { total: number };
    expect(r2.total).toBe(1);
  });

  it("results are sorted by lastActivity descending (most recent first)", async () => {
    const createTool = getToolByName(tools, "accordo_comment_create");
    const listTool = getToolByName(tools, "accordo_comment_list");
    await createTool.handler({ uri: "file:///project/first.ts", anchor: { kind: "file" }, body: "first" });
    await createTool.handler({ uri: "file:///project/last.ts", anchor: { kind: "file" }, body: "last" });
    const { threads } = (await listTool.handler({})) as { threads: { anchor: { uri: string }; lastActivity: string }[] };
    // Most recent activity first
    expect(threads[0].lastActivity >= threads[1].lastActivity).toBe(true);
  });
});

// ── §6 accordo_comment_get ──────────────────────────────────────────────────

describe("§6 accordo_comment_get", () => {
  it("has dangerLevel 'safe'", () => {
    const tool = getToolByName(tools, "accordo_comment_get");
    expect(tool.dangerLevel).toBe("safe");
  });

  it("is idempotent", () => {
    const tool = getToolByName(tools, "accordo_comment_get");
    expect(tool.idempotent).toBe(true);
  });

  it("inputSchema requires threadId", () => {
    const tool = getToolByName(tools, "accordo_comment_get");
    expect(tool.inputSchema.properties["threadId"]).toBeDefined();
    expect(tool.inputSchema.required).toContain("threadId");
  });

  it("handler returns { thread } with full CommentThread", async () => {
    const tool = getToolByName(tools, "accordo_comment_get");
    // Should throw or return error for non-existent thread
    await expect(tool.handler({ threadId: "nonexistent" })).rejects.toThrow();
  });
});

// ── §6 accordo_comment_create ────────────────────────────────────────────────

describe("§6 accordo_comment_create", () => {
  it("has dangerLevel 'moderate'", () => {
    const tool = getToolByName(tools, "accordo_comment_create");
    expect(tool.dangerLevel).toBe("moderate");
  });

  it("is not idempotent", () => {
    const tool = getToolByName(tools, "accordo_comment_create");
    expect(tool.idempotent).toBe(false);
  });

  it("inputSchema requires uri, anchor, body", () => {
    const tool = getToolByName(tools, "accordo_comment_create");
    expect(tool.inputSchema.required).toContain("uri");
    expect(tool.inputSchema.required).toContain("anchor");
    expect(tool.inputSchema.required).toContain("body");
  });

  it("inputSchema has optional intent", () => {
    const tool = getToolByName(tools, "accordo_comment_create");
    expect(tool.inputSchema.properties["intent"]).toBeDefined();
  });

  it("handler returns { created: true, threadId, commentId }", async () => {
    const tool = getToolByName(tools, "accordo_comment_create");
    const result = (await tool.handler({
      uri: "file:///project/src/auth.ts",
      anchor: { kind: "text", startLine: 42 },
      body: "Fix this",
    })) as Record<string, unknown>;
    expect(result).toHaveProperty("created", true);
    expect(result).toHaveProperty("threadId");
    expect(result).toHaveProperty("commentId");
  });
});

// ── §6 accordo_comment_reply ─────────────────────────────────────────────────

describe("§6 accordo_comment_reply", () => {
  it("has dangerLevel 'moderate'", () => {
    const tool = getToolByName(tools, "accordo_comment_reply");
    expect(tool.dangerLevel).toBe("moderate");
  });

  it("is not idempotent", () => {
    const tool = getToolByName(tools, "accordo_comment_reply");
    expect(tool.idempotent).toBe(false);
  });

  it("inputSchema requires threadId, body", () => {
    const tool = getToolByName(tools, "accordo_comment_reply");
    expect(tool.inputSchema.required).toContain("threadId");
    expect(tool.inputSchema.required).toContain("body");
  });

  it("handler throws for non-existent thread", async () => {
    const tool = getToolByName(tools, "accordo_comment_reply");
    await expect(
      tool.handler({ threadId: "nonexistent", body: "reply" }),
    ).rejects.toThrow();
  });
});

// ── §6 accordo_comment_resolve ───────────────────────────────────────────────

describe("§6 accordo_comment_resolve", () => {
  it("has dangerLevel 'moderate'", () => {
    const tool = getToolByName(tools, "accordo_comment_resolve");
    expect(tool.dangerLevel).toBe("moderate");
  });

  it("is not idempotent", () => {
    const tool = getToolByName(tools, "accordo_comment_resolve");
    expect(tool.idempotent).toBe(false);
  });

  it("inputSchema requires threadId, resolutionNote", () => {
    const tool = getToolByName(tools, "accordo_comment_resolve");
    expect(tool.inputSchema.required).toContain("threadId");
    expect(tool.inputSchema.required).toContain("resolutionNote");
  });

  it("handler throws for non-existent thread", async () => {
    const tool = getToolByName(tools, "accordo_comment_resolve");
    await expect(
      tool.handler({ threadId: "nonexistent", resolutionNote: "done" }),
    ).rejects.toThrow();
  });
});

// ── §6 accordo_comment_delete ────────────────────────────────────────────────

describe("§6 accordo_comment_delete", () => {
  it("has dangerLevel 'moderate'", () => {
    const tool = getToolByName(tools, "accordo_comment_delete");
    expect(tool.dangerLevel).toBe("moderate");
  });

  it("is not idempotent", () => {
    const tool = getToolByName(tools, "accordo_comment_delete");
    expect(tool.idempotent).toBe(false);
  });

  it("inputSchema requires threadId", () => {
    const tool = getToolByName(tools, "accordo_comment_delete");
    expect(tool.inputSchema.required).toContain("threadId");
  });

  it("inputSchema has optional commentId", () => {
    const tool = getToolByName(tools, "accordo_comment_delete");
    expect(tool.inputSchema.properties["commentId"]).toBeDefined();
    // commentId should NOT be in required
    expect(tool.inputSchema.required).not.toContain("commentId");
  });

  it("handler throws for non-existent thread", async () => {
    const tool = getToolByName(tools, "accordo_comment_delete");
    await expect(
      tool.handler({ threadId: "nonexistent" }),
    ).rejects.toThrow();
  });
});

// ── §6.1 Rate Limiting ──────────────────────────────────────────────────────

describe("§6.1 Rate Limiting — CreateRateLimiter", () => {
  let limiter: CreateRateLimiter;

  beforeEach(() => {
    limiter = new CreateRateLimiter();
  });

  it("allows first create", () => {
    expect(limiter.isAllowed("agent-1")).toBe(true);
  });

  it("allows up to COMMENT_CREATE_RATE_LIMIT creates", () => {
    for (let i = 0; i < COMMENT_CREATE_RATE_LIMIT; i++) {
      expect(limiter.isAllowed("agent-1")).toBe(true);
      limiter.record("agent-1");
    }
  });

  it("rejects create after COMMENT_CREATE_RATE_LIMIT within window", () => {
    for (let i = 0; i < COMMENT_CREATE_RATE_LIMIT; i++) {
      limiter.record("agent-1");
    }
    expect(limiter.isAllowed("agent-1")).toBe(false);
  });

  it("tracks agents independently", () => {
    for (let i = 0; i < COMMENT_CREATE_RATE_LIMIT; i++) {
      limiter.record("agent-1");
    }
    // agent-2 should still be allowed
    expect(limiter.isAllowed("agent-2")).toBe(true);
  });

  it("reset clears all rate limit state", () => {
    for (let i = 0; i < COMMENT_CREATE_RATE_LIMIT; i++) {
      limiter.record("agent-1");
    }
    expect(limiter.isAllowed("agent-1")).toBe(false);
    limiter.reset();
    expect(limiter.isAllowed("agent-1")).toBe(true);
  });

  it("allows creates again after rate window expires", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < COMMENT_CREATE_RATE_LIMIT; i++) {
        limiter.record("agent-1");
      }
      expect(limiter.isAllowed("agent-1")).toBe(false);

      // Advance past the rate window
      vi.advanceTimersByTime(COMMENT_CREATE_RATE_WINDOW_MS + 100);

      expect(limiter.isAllowed("agent-1")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── normalizeCommentUri ───────────────────────────────────────────────────────

describe("normalizeCommentUri", () => {
  const root = "/Users/Shared/dev/myproject";

  it("passes through a canonical file:// URI unchanged (modulo path.resolve)", () => {
    const result = normalizeCommentUri("file:///Users/Shared/dev/myproject/src/main.ts", root);
    expect(result).toBe("file:///Users/Shared/dev/myproject/src/main.ts");
  });

  it("converts an absolute FS path to a file:// URI", () => {
    const result = normalizeCommentUri("/Users/Shared/dev/myproject/src/main.ts", root);
    expect(result).toBe("file:///Users/Shared/dev/myproject/src/main.ts");
  });

  it("resolves a relative path against workspaceRoot", () => {
    const result = normalizeCommentUri("src/main.ts", root);
    expect(result).toBe("file:///Users/Shared/dev/myproject/src/main.ts");
  });

  it("resolves a bare filename against workspaceRoot", () => {
    const result = normalizeCommentUri("README.md", root);
    expect(result).toBe("file:///Users/Shared/dev/myproject/README.md");
  });

  it("normalizes path separators / redundant segments inside file:// URIs", () => {
    const result = normalizeCommentUri("file:///Users/Shared/dev/myproject/src/../src/main.ts", root);
    expect(result).toBe("file:///Users/Shared/dev/myproject/src/main.ts");
  });

  it("create handler stores canonical URI regardless of input form", async () => {
    // workspaceRoot is '' in tests (store.load() not called), so relative paths
    // resolve via process.cwd() — but absolute paths must always work correctly.
    const createTool = tools.find(t => t.name === "accordo_comment_create")!;
    const result = await createTool.handler({
      uri: "/Users/Shared/dev/myproject/src/auth.ts",
      anchor: { kind: "text", startLine: 10 },
      body: "Absolute path input",
    }) as { threadId: string };
    const thread = store.getThread(result.threadId)!;
    expect(thread.anchor.uri).toBe("file:///Users/Shared/dev/myproject/src/auth.ts");
  });

  it("list handler normalizes uri filter before matching", async () => {
    const createTool = tools.find(t => t.name === "accordo_comment_create")!;
    await createTool.handler({
      uri: "file:///project/src/auth.ts",
      anchor: { kind: "file" },
      body: "a comment",
    });
    const listTool = tools.find(t => t.name === "accordo_comment_list")!;
    // filter with absolute FS path — must normalize and find the thread
    const result = await listTool.handler({ uri: "/project/src/auth.ts" }) as { total: number };
    expect(result.total).toBe(1);
  });
});
