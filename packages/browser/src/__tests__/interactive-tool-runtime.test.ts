import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildBrowserTools } from "../tool-assembly.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { ScreenshotRetentionStore } from "../screenshot-retention.js";
import { BrowserAuditLog } from "../security/audit-log.js";
import type { BrowserRelayLike } from "../types.js";

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
  const tools = buildBrowserTools(
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

  return { relay, tools };
}

function getTool(tools: ReturnType<typeof buildBrowserTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe("interactive tool runtime", () => {
  let relay: ReturnType<typeof createRelay>;
  let tools: ReturnType<typeof buildBrowserTools>;

  beforeEach(() => {
    ({ relay, tools } = createTools());
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
});
