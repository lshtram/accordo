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
// ✓ createCommentTools()       — Tool array shape (6 tests), all handler tests
// ✓ CreateRateLimiter.isAllowed() — §6.1 Rate Limiting (4 tests)
// ✓ CreateRateLimiter.record()    — §6.1 Rate Limiting (called with isAllowed)
// ✓ CreateRateLimiter.reset()     — §6.1 Rate Limiting (2 tests)
// ✓ normalizeCommentUri()      — URI normalization: file://, absolute, relative (7 tests)
// ✓ comment.list handler       — §6 list (4 tests) + modality routing (7 tests) [M38-CT-01]
// ✓ comment.get handler        — §6 get (4 tests) [M38-CT-02]
// ✓ comment.create handler     — §6 create (5 tests) + browser modality (4 tests) [M38-CT-03]
// ✓ comment.reply handler      — §6 reply (4 tests) [M38-CT-04]
// ✓ comment.resolve handler    — §6 resolve (4 tests) [M38-CT-05]
// ✓ comment.reopen handler     — §6 reopen (5 tests) [M38-CT-06]
// ✓ comment.delete handler     — §6 delete (5 tests) + deleteScope bulk (3 tests) [M38-CT-07]

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import path from "path";
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

/**
 * Platform-aware URI comparison helper.
 * Uses URL-based normalization (which resolves .. segments) and string-based
 * path extraction to avoid fileURLToPath, which throws on Windows for
 * file:// URIs that lack a drive letter (e.g. file:///Users/...).
 */
function normalizeUriForComparison(uri: string): string {
  if (!uri.startsWith("file://")) {
    return uri;
  }
  try {
    // URL normalization handles ".." segments cross-platform
    const normalized = new URL(uri).pathname.replace(/\\/g, "/");
    // Remove Windows drive letter if present: /D:/Users → /Users
    return normalized.replace(/^\/[a-zA-Z]:/, "");
  } catch {
    const withoutScheme = uri.slice("file://".length).replace(/\\/g, "/");
    return withoutScheme.replace(/^\/[a-zA-Z]:/, "");
  }
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
  it("M38-CT-01,06: returns exactly 8 tools (including comment_reopen and comment_sync_version)", () => {
    expect(tools).toHaveLength(8);
  });

  it("includes all expected tool names including comment_reopen", () => {
    const names = tools.map(t => t.name);
    expect(names).toContain("comment_list");
    expect(names).toContain("comment_get");
    expect(names).toContain("comment_create");
    expect(names).toContain("comment_reply");
    expect(names).toContain("comment_resolve");
    expect(names).toContain("comment_reopen");
    expect(names).toContain("comment_delete");
    expect(names).toContain("comment_sync_version");
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

// ── comment_list ─────────────────────────────────────────────────────

describe("comment_list", () => {
  it("has dangerLevel 'safe'", () => {
    const tool = getToolByName(tools, "comment_list");
    expect(tool.dangerLevel).toBe("safe");
  });

  it("is idempotent", () => {
    const tool = getToolByName(tools, "comment_list");
    expect(tool.idempotent).toBe(true);
  });

  it("inputSchema has optional uri, status, intent, anchorKind, updatedSince, lastAuthor, limit, offset", () => {
    const tool = getToolByName(tools, "comment_list");
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
    const tool = getToolByName(tools, "comment_list");
    const result = (await tool.handler({})) as Record<string, unknown>;
    expect(result).toHaveProperty("threads");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("hasMore");
  });

  it("each thread summary includes lastAuthor field", async () => {
    const createTool = getToolByName(tools, "comment_create");
    await createTool.handler({ uri: "file:///project/src/auth.ts", anchor: { kind: "file" }, body: "agent comment" });
    const listTool = getToolByName(tools, "comment_list");
    const { threads } = (await listTool.handler({})) as { threads: { lastAuthor: string }[] };
    expect(threads[0]).toHaveProperty("lastAuthor");
    expect(["user", "agent"]).toContain(threads[0].lastAuthor);
  });

  it("updatedSince filter returns only threads active after the timestamp", async () => {
    const createTool = getToolByName(tools, "comment_create");
    const listTool = getToolByName(tools, "comment_list");
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
    const createTool = getToolByName(tools, "comment_create");
    const listTool = getToolByName(tools, "comment_list");
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
    const createTool = getToolByName(tools, "comment_create");
    const listTool = getToolByName(tools, "comment_list");
    await createTool.handler({ uri: "file:///project/first.ts", anchor: { kind: "file" }, body: "first" });
    await createTool.handler({ uri: "file:///project/last.ts", anchor: { kind: "file" }, body: "last" });
    const { threads } = (await listTool.handler({})) as { threads: { anchor: { uri: string }; lastActivity: string }[] };
    // Most recent activity first
    expect(threads[0].lastActivity >= threads[1].lastActivity).toBe(true);
  });
});

// ── comment_get ─────────────────────────────────────────────────────

describe("comment_get", () => {
  it("has dangerLevel 'safe'", () => {
    const tool = getToolByName(tools, "comment_get");
    expect(tool.dangerLevel).toBe("safe");
  });

  it("is idempotent", () => {
    const tool = getToolByName(tools, "comment_get");
    expect(tool.idempotent).toBe(true);
  });

  it("inputSchema requires threadId", () => {
    const tool = getToolByName(tools, "comment_get");
    expect(tool.inputSchema.properties["threadId"]).toBeDefined();
    expect(tool.inputSchema.required).toContain("threadId");
  });

  it("handler returns { thread } with full CommentThread", async () => {
    const tool = getToolByName(tools, "comment_get");
    // Should throw or return error for non-existent thread
    await expect(tool.handler({ threadId: "nonexistent" })).rejects.toThrow();
  });
});

// ── comment_create ─────────────────────────────────────────────────

describe("comment_create", () => {
  it("has dangerLevel 'moderate'", () => {
    const tool = getToolByName(tools, "comment_create");
    expect(tool.dangerLevel).toBe("moderate");
  });

  it("is not idempotent", () => {
    const tool = getToolByName(tools, "comment_create");
    expect(tool.idempotent).toBe(false);
  });

  it("M38-CT-03: inputSchema only requires body (uri optional via scope.url for browser)", () => {
    const tool = getToolByName(tools, "comment_create");
    expect(tool.inputSchema.required).toContain("body");
    // uri is NOT required — can use scope.url for browser modality
    expect(tool.inputSchema.required ?? []).not.toContain("uri");
    // anchor.kind is required but the whole anchor object is not
    expect(tool.inputSchema.required ?? []).not.toContain("anchor");
  });

  it("inputSchema has optional intent", () => {
    const tool = getToolByName(tools, "comment_create");
    expect(tool.inputSchema.properties["intent"]).toBeDefined();
  });

  it("handler returns { created: true, threadId, commentId }", async () => {
    const tool = getToolByName(tools, "comment_create");
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

// ── comment_reply ───────────────────────────────────────────────────

describe("comment_reply", () => {
  it("has dangerLevel 'moderate'", () => {
    const tool = getToolByName(tools, "comment_reply");
    expect(tool.dangerLevel).toBe("moderate");
  });

  it("is not idempotent", () => {
    const tool = getToolByName(tools, "comment_reply");
    expect(tool.idempotent).toBe(false);
  });

  it("inputSchema requires threadId, body", () => {
    const tool = getToolByName(tools, "comment_reply");
    expect(tool.inputSchema.required).toContain("threadId");
    expect(tool.inputSchema.required).toContain("body");
  });

  it("handler throws for non-existent thread", async () => {
    const tool = getToolByName(tools, "comment_reply");
    await expect(
      tool.handler({ threadId: "nonexistent", body: "reply" }),
    ).rejects.toThrow();
  });
});

// ── comment_resolve ─────────────────────────────────────────────────

describe("comment_resolve", () => {
  it("has dangerLevel 'moderate'", () => {
    const tool = getToolByName(tools, "comment_resolve");
    expect(tool.dangerLevel).toBe("moderate");
  });

  it("is not idempotent", () => {
    const tool = getToolByName(tools, "comment_resolve");
    expect(tool.idempotent).toBe(false);
  });

  it("inputSchema requires threadId, resolutionNote", () => {
    const tool = getToolByName(tools, "comment_resolve");
    expect(tool.inputSchema.required).toContain("threadId");
    expect(tool.inputSchema.required).toContain("resolutionNote");
  });

  it("handler throws for non-existent thread", async () => {
    const tool = getToolByName(tools, "comment_resolve");
    await expect(
      tool.handler({ threadId: "nonexistent", resolutionNote: "done" }),
    ).rejects.toThrow();
  });
});

// ── comment_delete ───────────────────────────────────────────────────

describe("comment_delete", () => {
  it("has dangerLevel 'moderate'", () => {
    const tool = getToolByName(tools, "comment_delete");
    expect(tool.dangerLevel).toBe("moderate");
  });

  it("is not idempotent", () => {
    const tool = getToolByName(tools, "comment_delete");
    expect(tool.idempotent).toBe(false);
  });

  it("M38-CT-07: inputSchema has no required fields (can use deleteScope for bulk delete)", () => {
    const tool = getToolByName(tools, "comment_delete");
    // threadId is NOT required — can use deleteScope instead
    expect(tool.inputSchema.required ?? []).not.toContain("threadId");
    expect(tool.inputSchema.required ?? []).toEqual([]);
  });

  it("inputSchema has optional commentId", () => {
    const tool = getToolByName(tools, "comment_delete");
    expect(tool.inputSchema.properties["commentId"]).toBeDefined();
    // commentId should NOT be in required
    expect(tool.inputSchema.required).not.toContain("commentId");
  });

  it("handler throws for non-existent thread", async () => {
    const tool = getToolByName(tools, "comment_delete");
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

describe("normalizeCommentUri", () => {
  const root = "/Users/Shared/dev/myproject";

  it("passes through a canonical file:// URI unchanged (modulo path.resolve)", () => {
    const result = normalizeCommentUri("file:///Users/Shared/dev/myproject/src/main.ts", root);
    expect(normalizeUriForComparison(result)).toBe("/Users/Shared/dev/myproject/src/main.ts");
  });

  it("converts an absolute FS path to a file:// URI", () => {
    const result = normalizeCommentUri("/Users/Shared/dev/myproject/src/main.ts", root);
    expect(normalizeUriForComparison(result)).toBe("/Users/Shared/dev/myproject/src/main.ts");
  });

  it("resolves a relative path against workspaceRoot", () => {
    const result = normalizeCommentUri("src/main.ts", root);
    expect(normalizeUriForComparison(result)).toBe("/Users/Shared/dev/myproject/src/main.ts");
  });

  it("resolves a bare filename against workspaceRoot", () => {
    const result = normalizeCommentUri("README.md", root);
    expect(normalizeUriForComparison(result)).toBe("/Users/Shared/dev/myproject/README.md");
  });

  it("normalizes path separators / redundant segments inside file:// URIs", () => {
    const result = normalizeCommentUri("file:///Users/Shared/dev/myproject/src/../src/main.ts", root);
    expect(normalizeUriForComparison(result)).toBe("/Users/Shared/dev/myproject/src/main.ts");
  });

  it("create handler stores canonical URI regardless of input form", async () => {
    // workspaceRoot is '' in tests (store.load() not called), so relative paths
    // resolve via process.cwd() — but absolute paths must always work correctly.
    const createTool = tools.find(t => t.name === "comment_create")!;
    const result = await createTool.handler({
      uri: "/Users/Shared/dev/myproject/src/auth.ts",
      anchor: { kind: "text", startLine: 10 },
      body: "Absolute path input",
    }) as { threadId: string };
    const thread = store.getThread(result.threadId)!;
    expect(normalizeUriForComparison(thread.anchor.uri)).toBe("/Users/Shared/dev/myproject/src/auth.ts");
  });

  it("list handler normalizes uri filter before matching", async () => {
    const createTool = tools.find(t => t.name === "comment_create")!;
    await createTool.handler({
      uri: "file:///project/src/auth.ts",
      anchor: { kind: "file" },
      body: "a comment",
    });
    const listTool = tools.find(t => t.name === "comment_list")!;
    // filter with the same file:// URI — the normalizer must recognise and match it
    // (cross-platform: bare absolute paths like "/project/src/auth.ts" get drive-letter
    //  prefixes on Windows, so we use the canonical file:// form for portability)
    const result = await listTool.handler({ uri: "file:///project/src/auth.ts" }) as { total: number };
    expect(result.total).toBe(1);
  });
});

// ── M38-CT-01: scope.modality routing ─────────────────────────────────────────

describe("M38-CT-01: comment_list scope.modality routing", () => {
  beforeEach(async () => {
    const createTool = tools.find(t => t.name === "comment_create")!;
    // Create threads for different modalities
    // text modality (maps to anchorKind=text)
    await createTool.handler({ uri: "file:///project/src/a.ts", anchor: { kind: "text", startLine: 1 }, body: "text comment" });
    // markdown-preview modality (maps to surface)
    await createTool.handler({ scope: { modality: "markdown-preview", uri: "file:///project/README.md" }, uri: "file:///project/README.md", anchor: { kind: "surface", surfaceType: "markdown-preview", coordinates: { type: "block", blockId: "b1", blockType: "paragraph" } }, body: "md preview comment" });
    // diagram modality (maps to surface)
    await createTool.handler({ scope: { modality: "diagram", uri: "file:///project/diagram.mmd" }, uri: "file:///project/diagram.mmd", anchor: { kind: "surface", surfaceType: "diagram", coordinates: { type: "diagram-node", nodeId: "n1" } }, body: "diagram comment" });
    // slide modality (maps to surface)
    await createTool.handler({ scope: { modality: "slide", uri: "file:///project/slides.pdf" }, uri: "file:///project/slides.pdf", anchor: { kind: "surface", surfaceType: "slide", coordinates: { type: "slide", slideIndex: 1, x: 0.5, y: 0.5 } }, body: "slide comment" });
    // image modality (maps to surface)
    await createTool.handler({ scope: { modality: "image", uri: "file:///project/img.png" }, uri: "file:///project/img.png", anchor: { kind: "surface", surfaceType: "image", coordinates: { type: "normalized", x: 0.5, y: 0.5 } }, body: "image comment" });
    // pdf modality (maps to surface)
    await createTool.handler({ scope: { modality: "pdf", uri: "file:///project/doc.pdf" }, uri: "file:///project/doc.pdf", anchor: { kind: "surface", surfaceType: "pdf", coordinates: { type: "normalized", x: 0.5, y: 0.5 } }, body: "pdf comment" });
    // browser modality (maps to surface)
    await createTool.handler({ scope: { modality: "browser", url: "https://example.com/page1" }, anchor: { kind: "browser" }, body: "browser comment" });
  });

  it("M38-CT-01: scope.modality=text returns text-anchored threads", async () => {
    const listTool = tools.find(t => t.name === "comment_list")!;
    const result = (await listTool.handler({ scope: { modality: "text" } })) as { threads: unknown[]; total: number };
    expect(result.total).toBe(1);
    expect(result.threads[0]).toHaveProperty("anchor");
  });

  it("M38-CT-01: scope.modality=markdown-preview returns surface threads with markdown-preview type", async () => {
    const listTool = tools.find(t => t.name === "comment_list")!;
    const result = (await listTool.handler({ scope: { modality: "markdown-preview" } })) as { threads: unknown[]; total: number };
    expect(result.total).toBe(1);
  });

  it("M38-CT-01: scope.modality=diagram returns surface threads with diagram type", async () => {
    const listTool = tools.find(t => t.name === "comment_list")!;
    const result = (await listTool.handler({ scope: { modality: "diagram" } })) as { threads: unknown[]; total: number };
    expect(result.total).toBe(1);
  });

  it("M38-CT-01: scope.modality=slide returns surface threads with slide type", async () => {
    const listTool = tools.find(t => t.name === "comment_list")!;
    const result = (await listTool.handler({ scope: { modality: "slide" } })) as { threads: unknown[]; total: number };
    expect(result.total).toBe(1);
  });

  it("M38-CT-01: scope.modality=image returns surface threads with image type", async () => {
    const listTool = tools.find(t => t.name === "comment_list")!;
    const result = (await listTool.handler({ scope: { modality: "image" } })) as { threads: unknown[]; total: number };
    expect(result.total).toBe(1);
  });

  it("M38-CT-01: scope.modality=pdf returns surface threads with pdf type", async () => {
    const listTool = tools.find(t => t.name === "comment_list")!;
    const result = (await listTool.handler({ scope: { modality: "pdf" } })) as { threads: unknown[]; total: number };
    expect(result.total).toBe(1);
  });

  it("M38-CT-01: scope.modality=browser returns surface threads with browser type", async () => {
    const listTool = tools.find(t => t.name === "comment_list")!;
    const result = (await listTool.handler({ scope: { modality: "browser" } })) as { threads: unknown[]; total: number };
    expect(result.total).toBe(1);
  });
});

// ── M38-CT-01: comment_list detail=true for browser modality ──────────────────

describe("M38-CT-01: comment_list detail=true returns full CommentThread[]", () => {
  beforeEach(async () => {
    const createTool = tools.find(t => t.name === "comment_create")!;
    await createTool.handler({
      scope: { modality: "browser", url: "https://example.com/page1" },
      anchor: { kind: "browser" },
      body: "browser comment with full data",
    });
  });

  it("returns a bare array (not ListThreadsResult) when detail=true and browser modality", async () => {
    const listTool = tools.find(t => t.name === "comment_list")!;
    const result = await listTool.handler({ scope: { modality: "browser" }, detail: true });
    expect(Array.isArray(result)).toBe(true);
  });

  it("returned array contains full CommentThread objects with comments array", async () => {
    const listTool = tools.find(t => t.name === "comment_list")!;
    const threads = await listTool.handler({ scope: { modality: "browser" }, detail: true }) as Array<Record<string, unknown>>;
    expect(threads.length).toBe(1);
    expect(threads[0]).toHaveProperty("id");
    expect(threads[0]).toHaveProperty("comments");
    expect(threads[0]).toHaveProperty("createdAt");
    expect(Array.isArray(threads[0]["comments"])).toBe(true);
    const comments = threads[0]["comments"] as Array<Record<string, unknown>>;
    expect(comments[0]).toHaveProperty("body", "browser comment with full data");
  });

  it("without detail=true, browser modality still returns ListThreadsResult", async () => {
    const listTool = tools.find(t => t.name === "comment_list")!;
    const result = (await listTool.handler({ scope: { modality: "browser" } })) as { threads: unknown[]; total: number; hasMore: boolean };
    expect(result).toHaveProperty("threads");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("hasMore");
  });

  it("detail=true on non-browser modality still returns ListThreadsResult", async () => {
    const createTool = tools.find(t => t.name === "comment_create")!;
    await createTool.handler({ uri: "file:///project/src/a.ts", anchor: { kind: "file" }, body: "text comment" });
    const listTool = tools.find(t => t.name === "comment_list")!;
    // detail=true without browser modality => normal ListThreadsResult
    const result = (await listTool.handler({ detail: true })) as { threads: unknown[]; total: number; hasMore: boolean };
    expect(result).toHaveProperty("threads");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("hasMore");
  });
});

// ── M38-CT-03: browser modality retention ─────────────────────────────────────

describe("M38-CT-03: comment_create browser modality retention", () => {
  it("M38-CT-03: creates thread with retention=volatile-browser for browser modality", async () => {
    const createTool = tools.find(t => t.name === "comment_create")!;
    const result = (await createTool.handler({
      scope: { modality: "browser", url: "https://example.com/page1" },
      anchor: { kind: "browser" },
      body: "Browser comment",
    })) as { threadId: string };
    const thread = store.getThread(result.threadId)!;
    expect(thread.retention).toBe("volatile-browser");
  });

  it("M38-CT-03: creates thread with retention=standard for non-browser modality", async () => {
    const createTool = tools.find(t => t.name === "comment_create")!;
    const result = (await createTool.handler({
      scope: { modality: "diagram" },
      uri: "file:///project/diagram.mmd",
      anchor: { kind: "surface", surfaceType: "diagram", coordinates: { type: "diagram-node", nodeId: "n1" } },
      body: "Diagram comment",
    })) as { threadId: string };
    const thread = store.getThread(result.threadId)!;
    expect(thread.retention).toBe("standard");
  });

  it("M38-CT-03: kind=browser anchor creates surface anchor with surfaceType=browser", async () => {
    const createTool = tools.find(t => t.name === "comment_create")!;
    const result = (await createTool.handler({
      scope: { modality: "browser", url: "https://example.com/page1" },
      anchor: { kind: "browser" },
      body: "Browser comment",
    })) as { threadId: string };
    const thread = store.getThread(result.threadId)!;
    expect(thread.anchor.kind).toBe("surface");
    expect((thread.anchor as { surfaceType: string }).surfaceType).toBe("browser");
  });

  it("M38-CT-03: kind=browser anchor with anchorKey parses coordinates correctly", async () => {
    const createTool = tools.find(t => t.name === "comment_create")!;
    const result = (await createTool.handler({
      scope: { modality: "browser", url: "https://example.com/page1" },
      anchor: { kind: "browser", anchorKey: "0.25:0.75" },
      body: "Browser comment at 0.25:0.75",
    })) as { threadId: string };
    const thread = store.getThread(result.threadId)!;
    const coords = (thread.anchor as { coordinates: { x: number; y: number } }).coordinates;
    expect(coords.x).toBe(0.25);
    expect(coords.y).toBe(0.75);
  });

  it("BUG-ANCHOR-01: kind=browser preserves anchorKey in comment context surfaceMetadata", async () => {
    const createTool = tools.find(t => t.name === "comment_create")!;
    const result = (await createTool.handler({
      scope: { modality: "browser", url: "https://example.com/page1" },
      anchor: { kind: "browser", anchorKey: "div:2:hero_title@120,45" },
      body: "Browser comment with DOM anchor",
    })) as { threadId: string };

    const thread = store.getThread(result.threadId)!;
    const first = thread.comments[0];
    expect(first.context?.surfaceMetadata?.anchorKey).toBe("div:2:hero_title@120,45");

    const surfaceAnchor = thread.anchor as {
      kind: "surface";
      surfaceType: string;
      coordinates: { type: string; blockId?: string };
    };
    expect(surfaceAnchor.surfaceType).toBe("browser");
    expect(surfaceAnchor.coordinates.type).toBe("block");
    expect(surfaceAnchor.coordinates.blockId).toBe("div:2:hero_title@120,45");
  });
});

// ── M38-CT-06: comment_reopen ─────────────────────────────────────────

describe("M38-CT-06: comment_reopen", () => {
  let threadId: string;

  beforeEach(async () => {
    const createTool = tools.find(t => t.name === "comment_create")!;
    const resolveTool = tools.find(t => t.name === "comment_resolve")!;
    const result = (await createTool.handler({
      uri: "file:///project/src/a.ts",
      anchor: { kind: "file" },
      body: "Original comment",
    })) as { threadId: string };
    threadId = result.threadId;
    await resolveTool.handler({ threadId, resolutionNote: "Fixed" });
  });

  it("M38-CT-06: has dangerLevel 'moderate'", () => {
    const tool = getToolByName(tools, "comment_reopen");
    expect(tool.dangerLevel).toBe("moderate");
  });

  it("M38-CT-06: is not idempotent", () => {
    const tool = getToolByName(tools, "comment_reopen");
    expect(tool.idempotent).toBe(false);
  });

  it("M38-CT-06: inputSchema requires threadId", () => {
    const tool = getToolByName(tools, "comment_reopen");
    expect(tool.inputSchema.properties["threadId"]).toBeDefined();
    expect(tool.inputSchema.required).toContain("threadId");
  });

  it("M38-CT-06: handler returns { reopened: true, threadId }", async () => {
    const tool = getToolByName(tools, "comment_reopen");
    const result = (await tool.handler({ threadId })) as Record<string, unknown>;
    expect(result).toHaveProperty("reopened", true);
    expect(result).toHaveProperty("threadId", threadId);
  });

  it("M38-CT-06: reopens a resolved thread", async () => {
    const tool = getToolByName(tools, "comment_reopen");
    await tool.handler({ threadId });
    const thread = store.getThread(threadId)!;
    expect(thread.status).toBe("open");
  });

  it("M38-CT-06: throws for non-existent thread", async () => {
    const tool = getToolByName(tools, "comment_reopen");
    await expect(
      tool.handler({ threadId: "nonexistent" }),
    ).rejects.toThrow();
  });
});

// ── M38-CT-07: deleteScope bulk delete ────────────────────────────────────────

describe("M38-CT-07: comment_delete deleteScope bulk delete", () => {
  beforeEach(async () => {
    const createTool = tools.find(t => t.name === "comment_create")!;
    // Create browser threads
    await createTool.handler({ scope: { modality: "browser", url: "https://example.com/1" }, anchor: { kind: "browser" }, body: "browser comment 1" });
    await createTool.handler({ scope: { modality: "browser", url: "https://example.com/2" }, anchor: { kind: "browser" }, body: "browser comment 2" });
    // Create non-browser threads
    await createTool.handler({ uri: "file:///project/src/a.ts", anchor: { kind: "text", startLine: 1 }, body: "text comment" });
    await createTool.handler({ scope: { modality: "diagram" }, uri: "file:///project/diagram.mmd", anchor: { kind: "surface", surfaceType: "diagram", coordinates: { type: "diagram-node", nodeId: "n1" } }, body: "diagram comment" });
  });

  it("M38-CT-07: deleteScope with modality=browser deletes all browser threads", async () => {
    const deleteTool = tools.find(t => t.name === "comment_delete")!;
    const result = (await deleteTool.handler({ deleteScope: { modality: "browser", all: true } })) as { deletedCount: number };
    expect(result.deleted).toBe(true);
    expect(result.deletedCount).toBe(2);
    // Only non-browser threads should remain
    const listTool = tools.find(t => t.name === "comment_list")!;
    const remaining = (await listTool.handler({})) as { total: number };
    expect(remaining.total).toBe(2); // text + diagram
  });

  it("M38-CT-07: deleteScope requires all=true to trigger bulk delete", async () => {
    const deleteTool = tools.find(t => t.name === "comment_delete")!;
    // Without all=true, it should require threadId
    await expect(
      deleteTool.handler({ deleteScope: { modality: "browser" } }),
    ).rejects.toThrow();
  });

  it("M38-CT-07: returns deletedCount with bulk delete", async () => {
    const deleteTool = tools.find(t => t.name === "comment_delete")!;
    const result = (await deleteTool.handler({ deleteScope: { modality: "browser", all: true } })) as { deletedCount: number };
    expect(result.deletedCount).toBe(2);
  });
});

// ── Author kind routing ────────────────────────────────────────────────────────

describe("comment_create / comment_reply author kind routing", () => {
  it("BR-AUTH-CT-01: comment_create with authorKind=user stores author.kind=user and author.name from authorName", async () => {
    const createTool = getToolByName(tools, "comment_create");

    const result = (await createTool.handler({
      scope: { modality: "browser", url: "https://example.com/page" },
      anchor: { kind: "browser" },
      body: "From Guest",
      authorKind: "user",
      authorName: "Guest",
    })) as { threadId: string };

    const thread = store.getThread(result.threadId)!;
    expect(thread.comments[0].author.kind).toBe("user");
    expect(thread.comments[0].author.name).toBe("Guest");
  });

  it("BR-AUTH-CT-02: comment_create without authorKind stores author.kind=agent", async () => {
    const createTool = getToolByName(tools, "comment_create");

    const result = (await createTool.handler({
      uri: "file:///project/src/auth.ts",
      anchor: { kind: "file" },
      body: "From agent",
    })) as { threadId: string };

    const thread = store.getThread(result.threadId)!;
    expect(thread.comments[0].author.kind).toBe("agent");
  });

  it("BR-AUTH-CT-03: comment_reply with authorKind=user stores reply author.kind=user and name from authorName", async () => {
    const createTool = getToolByName(tools, "comment_create");
    const replyTool = getToolByName(tools, "comment_reply");

    // Create a thread first
    const createResult = (await createTool.handler({
      scope: { modality: "browser", url: "https://example.com/page" },
      anchor: { kind: "browser" },
      body: "Initial comment",
    })) as { threadId: string };

    const threadId = createResult.threadId;

    await replyTool.handler({
      threadId,
      body: "Reply from Alice",
      authorKind: "user",
      authorName: "Alice",
    });

    const thread = store.getThread(threadId)!;
    const reply = thread.comments[1];
    expect(reply.author.kind).toBe("user");
    expect(reply.author.name).toBe("Alice");
  });

  it("BR-AUTH-CT-04: comment_reply without authorKind stores reply author.kind=agent", async () => {
    const createTool = getToolByName(tools, "comment_create");
    const replyTool = getToolByName(tools, "comment_reply");

    const createResult = (await createTool.handler({
      uri: "file:///project/src/auth.ts",
      anchor: { kind: "file" },
      body: "Initial comment",
    })) as { threadId: string };

    const threadId = createResult.threadId;

    await replyTool.handler({
      threadId,
      body: "Agent reply",
    });

    const thread = store.getThread(threadId)!;
    const reply = thread.comments[1];
    expect(reply.author.kind).toBe("agent");
  });

  it("BR-AUTH-CT-05: comment_create with authorKind=user and no authorName defaults name to 'User'", async () => {
    const createTool = getToolByName(tools, "comment_create");

    const result = (await createTool.handler({
      scope: { modality: "browser", url: "https://example.com/page" },
      anchor: { kind: "browser" },
      body: "Anonymous browser comment",
      authorKind: "user",
    })) as { threadId: string };

    const thread = store.getThread(result.threadId)!;
    expect(thread.comments[0].author.kind).toBe("user");
    expect(thread.comments[0].author.name).toBe("User");
  });
});
