import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildBrowserTools } from "../tool-assembly.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { ScreenshotRetentionStore } from "../screenshot-retention.js";
import { BrowserAuditLog } from "../security/audit-log.js";
import type { BrowserBridgeAPI, BrowserRelayLike } from "../types.js";

function createRelay() {
  let lastAction = "";
  let lastPayload: Record<string, unknown> = {};
  let lastTimeout = 0;

  const relay: BrowserRelayLike & {
    getLastCall(): { action: string; payload: Record<string, unknown>; timeout: number };
  } = {
    request: vi.fn().mockImplementation(async (action: string, payload?: Record<string, unknown>, timeoutMs?: number) => {
      lastAction = action;
      lastPayload = { ...(payload ?? {}) };
      lastTimeout = timeoutMs ?? 0;

      if (action === "capture_region") {
        return {
          success: true,
          requestId: "req-1",
          data: {
            success: true,
            dataUrl: "data:image/png;base64,ZmFrZQ==",
            width: 640,
            height: 480,
            sizeBytes: 1234,
            anchorSource: "uid",
            pageId: "page-1",
            frameId: "main",
            snapshotId: "page-1:0",
            capturedAt: "2026-01-01T00:00:00.000Z",
            viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom",
          },
        };
      }

      return { success: true, requestId: "req-1", data: { ok: true } };
    }),
    isConnected: vi.fn(() => true),
    push: vi.fn(),
    getDebuggerUrl: vi.fn(() => undefined),
    getLastCall: () => ({ action: lastAction, payload: lastPayload, timeout: lastTimeout }),
  };

  return relay;
}

function createTools() {
  const relay = createRelay();
  const bridge: BrowserBridgeAPI = {
    registerTools: vi.fn(() => ({ dispose: vi.fn() })),
    publishState: vi.fn(),
    invokeTool: vi.fn(async (toolName: string, args: Record<string, unknown>) => {
      if (toolName === "comment_get") {
        return {
          success: true,
          thread: {
            id: args.threadId,
            comments: [
              {
                id: "c-1",
                context: { surfaceMetadata: { anchorKey: "id:from-comment", snapshotId: "page-1:2" } },
              },
            ],
          },
        };
      }
      return { success: true };
    }),
  };
  const tools = buildBrowserTools(
    bridge,
    relay,
    new SnapshotRetentionStore(),
    {
      originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
      redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
      auditLog: new BrowserAuditLog(),
      snapshotRetention: { maxAgeMs: 0 },
    },
    new ScreenshotRetentionStore(),
  );

  return { bridge, relay, tools };
}

function getTool(tools: ReturnType<typeof buildBrowserTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe("interactive tool runtime", () => {
  let relay: ReturnType<typeof createRelay>;
  let bridge: BrowserBridgeAPI;
  let tools: ReturnType<typeof buildBrowserTools>;

  beforeEach(() => {
    ({ bridge, relay, tools } = createTools());
  });

  it("routes accordo_browser_click through the registered MCP tool handler", async () => {
    const result = await getTool(tools, "accordo_browser_click").handler({ uid: "main:12", dblClick: true });

    expect(result).toEqual({ success: true, target: "main:12" });
    expect(relay.getLastCall()).toEqual({
      action: "click",
      payload: { uid: "main:12", dblClick: true },
      timeout: 5000,
    });
  });

  it("routes accordo_browser_type through the registered MCP tool handler", async () => {
    const result = await getTool(tools, "accordo_browser_type").handler({ selector: "input[name='q']", text: "hello", submitKey: "Enter" });

    expect(result).toEqual({ success: true });
    expect(relay.getLastCall()).toEqual({
      action: "type",
      payload: { selector: "input[name='q']", text: "hello", submitKey: "Enter" },
      timeout: 5000,
    });
  });

  it("routes accordo_browser_press_key through the registered MCP tool handler", async () => {
    const result = await getTool(tools, "accordo_browser_press_key").handler({ tabId: 7, key: "Control+L" });

    expect(result).toEqual({ success: true, key: "Control+L" });
    expect(relay.getLastCall()).toEqual({
      action: "press_key",
      payload: { tabId: 7, key: "Control+L" },
      timeout: 5000,
    });
  });

  it("routes accordo_browser_capture_region through the registered MCP tool handler", async () => {
    const result = await getTool(tools, "accordo_browser_capture_region").handler({ uid: "main:4", format: "png", transport: "inline" });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      artifactMode: "inline",
      width: 640,
      height: 480,
      pageId: "page-1",
      frameId: "main",
      snapshotId: "page-1:0",
      auditId: expect.any(String),
    }));
    expect(relay.getLastCall()).toEqual({
      action: "capture_region",
      payload: { uid: "main:4", format: "png", transport: "inline" },
      timeout: 5000,
    });
  });

  it("routes accordo_browser_resolve_comment_context through comment_get and browser context handlers", async () => {
    relay.request = vi.fn().mockImplementation(async (action: string, payload?: Record<string, unknown>) => {
      if (action === "inspect_element") {
        return {
          success: true,
          requestId: "req-inspect",
          data: {
            found: true,
            pageId: "page-1",
            frameId: "main",
            snapshotId: "page-1:15",
            capturedAt: "2026-01-01T00:00:00.000Z",
            viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom",
            anchorKey: payload?.anchorKey,
            anchorStrategy: "id",
            anchorConfidence: "high",
            resolvedTier: 1,
            snapshotDrift: true,
          },
        };
      }
      if (action === "get_dom_excerpt") {
        return {
          success: true,
          requestId: "req-excerpt",
          data: {
            found: true,
            pageId: "page-1",
            frameId: "main",
            snapshotId: "page-1:16",
            capturedAt: "2026-01-01T00:00:01.000Z",
            viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom",
            html: "<div id=\"from-comment\"></div>",
            text: "from comment",
            nodeCount: 1,
            truncated: false,
          },
        };
      }
      return { success: true, requestId: "req-1", data: { ok: true } };
    });

    const result = await getTool(tools, "accordo_browser_resolve_comment_context").handler({ threadId: "t-1" });

    expect(bridge.invokeTool).toHaveBeenCalledWith("comment_get", { threadId: "t-1" });
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        threadId: "t-1",
        commentId: "c-1",
        anchorKey: "id:from-comment",
        creationSnapshotId: "page-1:2",
        metadata: expect.objectContaining({ anchorKey: "id:from-comment", snapshotId: "page-1:2" }),
        inspect: expect.objectContaining({ found: true, snapshotDrift: true, resolvedTier: 1 }),
        excerpt: expect.objectContaining({ found: true, html: "<div id=\"from-comment\"></div>" }),
      }),
    );
  });

  it("returns comment-not-found when a requested commentId does not exist in the thread", async () => {
    const result = await getTool(tools, "accordo_browser_resolve_comment_context").handler({ threadId: "t-1", commentId: "missing" });

    expect(result).toEqual({ success: false, error: "comment-not-found", threadId: "t-1", commentId: "missing" });
  });

  it("falls back to normalized browser coordinates when surfaceMetadata anchorKey is missing", async () => {
    (bridge.invokeTool as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      success: true,
      thread: {
        id: "t-2",
        anchor: {
          kind: "surface",
          surfaceType: "browser",
          coordinates: { type: "normalized", x: 0.25, y: 0.75 },
        },
        comments: [{ id: "c-2", context: { surfaceMetadata: {} } }],
      },
    }));
    relay.request = vi.fn().mockImplementation(async (action: string, payload?: Record<string, unknown>) => {
      if (action === "inspect_element") {
        return {
          success: true,
          requestId: "req-inspect",
          data: {
            found: true,
            pageId: "page-2",
            frameId: "main",
            snapshotId: "page-2:3",
            capturedAt: "2026-01-01T00:00:00.000Z",
            viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom",
            anchorKey: payload?.anchorKey,
            anchorStrategy: "viewport-pct",
            anchorConfidence: "low",
            resolvedTier: 6,
            snapshotDrift: false,
          },
        };
      }
      if (action === "get_dom_excerpt") {
        return {
          success: true,
          requestId: "req-excerpt",
          data: {
            found: true,
            pageId: "page-2",
            frameId: "main",
            snapshotId: "page-2:4",
            capturedAt: "2026-01-01T00:00:01.000Z",
            viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom",
            anchorKey: payload?.anchorKey,
            anchorStrategy: "viewport-pct",
            anchorConfidence: "low",
            resolvedTier: 6,
            snapshotDrift: false,
            html: "<div></div>",
            text: "",
            nodeCount: 1,
            truncated: false,
          },
        };
      }
      return { success: true, requestId: "req-1", data: { ok: true } };
    });

    const result = await getTool(tools, "accordo_browser_resolve_comment_context").handler({ threadId: "t-2" });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        anchorKey: "body:25%x75%",
        inspect: expect.objectContaining({ anchorKey: "body:25%x75%" }),
        excerpt: expect.objectContaining({ anchorKey: "body:25%x75%" }),
      }),
    );
  });

  it("returns thread-not-found when comment_get throws", async () => {
    (bridge.invokeTool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Thread not found: missing-thread"));

    const result = await getTool(tools, "accordo_browser_resolve_comment_context").handler({ threadId: "missing-thread" });

    expect(result).toEqual({ success: false, error: "thread-not-found", threadId: "missing-thread" });
  });

  it("returns comment-get-failed when comment_get fails for another reason", async () => {
    (bridge.invokeTool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Bridge unavailable"));

    const result = await getTool(tools, "accordo_browser_resolve_comment_context").handler({ threadId: "t-err" });

    expect(result).toEqual({ success: false, error: "comment-get-failed", threadId: "t-err", message: "Bridge unavailable" });
  });

  it("falls back to the thread anchor-bearing comment metadata when a targeted reply lacks anchor metadata", async () => {
    (bridge.invokeTool as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      success: true,
      thread: {
        id: "t-3",
        comments: [
          { id: "c-root", context: { surfaceMetadata: { anchorKey: "id:root-anchor", snapshotId: "page-3:2" } } },
          { id: "c-reply", context: { surfaceMetadata: {} } },
        ],
      },
    }));
    relay.request = vi.fn().mockImplementation(async (action: string, payload?: Record<string, unknown>) => ({
      success: true,
      requestId: `req-${action}`,
      data: {
        found: true,
        pageId: "page-3",
        frameId: "main",
        snapshotId: action === "inspect_element" ? "page-3:15" : "page-3:16",
        capturedAt: "2026-01-01T00:00:00.000Z",
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
        anchorKey: payload?.anchorKey,
        anchorStrategy: "id",
        anchorConfidence: "high",
        resolvedTier: 1,
        snapshotDrift: true,
        ...(action === "get_dom_excerpt" ? { html: "<div></div>", text: "", nodeCount: 1, truncated: false } : {}),
      },
    }));

    const result = await getTool(tools, "accordo_browser_resolve_comment_context").handler({ threadId: "t-3", commentId: "c-reply" });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        commentId: "c-reply",
        anchorKey: "id:root-anchor",
        creationSnapshotId: "page-3:2",
      }),
    );
  });

  it("normalizes legacy numeric surfaceMetadata anchor keys before re-resolution", async () => {
    (bridge.invokeTool as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      success: true,
      thread: {
        id: "t-4",
        comments: [{ id: "c-4", context: { surfaceMetadata: { anchorKey: "0.25:0.75", snapshotId: "page-4:1" } } }],
      },
    }));
    relay.request = vi.fn().mockImplementation(async (action: string, payload?: Record<string, unknown>) => ({
      success: true,
      requestId: `req-${action}`,
      data: {
        found: true,
        pageId: "page-4",
        frameId: "main",
        snapshotId: action === "inspect_element" ? "page-4:12" : "page-4:13",
        capturedAt: "2026-01-01T00:00:00.000Z",
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
        source: "dom",
        anchorKey: payload?.anchorKey,
        anchorStrategy: "viewport-pct",
        anchorConfidence: "low",
        resolvedTier: 6,
        snapshotDrift: true,
        ...(action === "get_dom_excerpt" ? { html: "<div></div>", text: "", nodeCount: 1, truncated: false } : {}),
      },
    }));

    const result = await getTool(tools, "accordo_browser_resolve_comment_context").handler({ threadId: "t-4" });

    expect(result).toEqual(expect.objectContaining({ anchorKey: "body:25%x75%" }));
  });
});
