import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBrowserTools } from "../tool-assembly.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { ScreenshotRetentionStore } from "../screenshot-retention.js";
import { BrowserAuditLog } from "../security/audit-log.js";
import type { BrowserRelayLike } from "../types.js";

const httpState = vi.hoisted(() => ({
  get: vi.fn(),
}));

const relayPortState = vi.hoisted(() => ({
  readRelayPort: vi.fn(),
}));

vi.mock("node:http", () => ({
  get: httpState.get,
}));

vi.mock("../relay-lifecycle-primitives.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../relay-lifecycle-primitives.js")>();
  return {
    ...actual,
    readRelayPort: relayPortState.readRelayPort,
  };
});

function createRelay(): BrowserRelayLike {
  return {
    request: vi.fn(),
    push: vi.fn(),
    isConnected: vi.fn(() => true),
  };
}

function createTools() {
  return buildBrowserTools(
    createRelay(),
    new SnapshotRetentionStore(),
    {
      originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" },
      redactionPolicy: { redactPatterns: [], replacement: "[REDACTED]" },
      auditLog: new BrowserAuditLog(),
      snapshotRetention: { maxAgeMs: 0 },
    },
    new ScreenshotRetentionStore(),
  );
}

function setupHttpSuccess(body: { code: string; expiresIn?: number }) {
  httpState.get.mockImplementation((url: string, callback: (res: { on(event: string, handler: (chunk?: Buffer) => void): void }) => void) => {
    const listeners: Record<string, Array<(chunk?: Buffer) => void>> = {};
    const response = {
      on(event: string, handler: (chunk?: Buffer) => void): void {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(handler);
      },
    };
    callback(response);
    for (const handler of listeners["data"] ?? []) {
      handler(Buffer.from(JSON.stringify(body)));
    }
    for (const handler of listeners["end"] ?? []) {
      handler();
    }
    return {
      on: vi.fn(),
      end: vi.fn(),
    };
  });
}

describe("pair tool runtime", () => {
  beforeEach(() => {
    httpState.get.mockReset();
    relayPortState.readRelayPort.mockReset();
  });

  it("targets the active non-default relay port when one is persisted", async () => {
    relayPortState.readRelayPort.mockReturnValue(40222);
    setupHttpSuccess({ code: "1234-5678", expiresIn: 300000 });

    const pairTool = createTools().find((tool) => tool.name === "accordo_browser_pair");
    expect(pairTool).toBeDefined();

    await pairTool!.handler({});

    expect(httpState.get).toHaveBeenCalledWith(
      "http://127.0.0.1:40222/pair/code",
      expect.any(Function),
    );
  });

  it("falls back to the canonical relay port when no persisted port is available", async () => {
    relayPortState.readRelayPort.mockReturnValue(undefined);
    setupHttpSuccess({ code: "1234-5678", expiresIn: 300000 });

    const pairTool = createTools().find((tool) => tool.name === "accordo_browser_pair");
    expect(pairTool).toBeDefined();

    await pairTool!.handler({});

    expect(httpState.get).toHaveBeenCalledWith(
      "http://127.0.0.1:40111/pair/code",
      expect.any(Function),
    );
  });
});
