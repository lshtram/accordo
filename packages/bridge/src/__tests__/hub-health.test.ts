/**
 * Tests for hub-health.ts — sendDisconnect()
 * Requirements: adr-reload-reconnect.md §D1
 *
 * All HH-xx tests are RED until sendDisconnect() is implemented
 * (currently throws "not implemented").
 *
 * API checklist:
 * ✓ HubHealth.sendDisconnect(bridgeSecret)  [5 tests: HH-01–HH-05]
 * ✓ HubHealth.checkHealth()                 [already tested in hub-manager.test.ts]
 * ✓ HubHealth.attemptReauth()               [already tested in hub-manager.test.ts]
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer } from "node:http";
import type http from "node:http";
import { HubHealth } from "../hub-health.js";
import type { HubHealthSharedState } from "../hub-health.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeOutputChannel() {
  return { appendLine: vi.fn(), show: vi.fn() };
}

function makeState(port: number): HubHealthSharedState {
  return { port };
}

function makeHubHealth(port: number): HubHealth {
  return new HubHealth(makeOutputChannel(), makeState(port));
}

// ── Helper: spin up a real HTTP server that responds to /bridge/disconnect ───

interface DisconnectServer {
  port: number;
  lastMethod: string | undefined;
  lastPath: string | undefined;
  lastSecret: string | undefined;
  respondWith: (status: number) => void;
  close(): Promise<void>;
}

async function makeDisconnectServer(defaultStatus = 200): Promise<DisconnectServer> {
  let status = defaultStatus;
  let lastMethod: string | undefined;
  let lastPath: string | undefined;
  let lastSecret: string | undefined;

  const server = createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    lastMethod = req.method;
    lastPath = req.url;
    lastSecret = req.headers["x-accordo-secret"] as string;
    req.resume(); // drain body
    req.on("end", () => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address() as { port: number };

  return {
    port,
    get lastMethod() { return lastMethod; },
    get lastPath() { return lastPath; },
    get lastSecret() { return lastSecret; },
    respondWith(s: number) { status = s; },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// ── HH-01: Hub responds 200 → sendDisconnect returns true ─────────────────────

describe("HubHealth.sendDisconnect() — HH-01: Hub responds 200", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("HH-01: sendDisconnect() returns true when Hub responds with 200", async () => {
    vi.useRealTimers();
    const srv = await makeDisconnectServer(200);
    try {
      const health = makeHubHealth(srv.port);
      // RED: sendDisconnect() throws "not implemented"
      const result = await health.sendDisconnect("test-secret");
      expect(result).toBe(true);
    } finally {
      await srv.close();
    }
  });
});

// ── HH-02: Hub responds non-200 → sendDisconnect returns false ────────────────

describe("HubHealth.sendDisconnect() — HH-02: Hub responds non-200", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("HH-02: sendDisconnect() returns false when Hub responds with 503", async () => {
    vi.useRealTimers();
    const srv = await makeDisconnectServer(503);
    try {
      const health = makeHubHealth(srv.port);
      // RED: sendDisconnect() throws "not implemented"
      const result = await health.sendDisconnect("test-secret");
      expect(result).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it("HH-02: sendDisconnect() returns false when Hub responds with 401", async () => {
    vi.useRealTimers();
    const srv = await makeDisconnectServer(401);
    try {
      const health = makeHubHealth(srv.port);
      const result = await health.sendDisconnect("wrong-secret");
      expect(result).toBe(false);
    } finally {
      await srv.close();
    }
  });
});

// ── HH-03: Hub not reachable → sendDisconnect returns false (no throw) ────────

describe("HubHealth.sendDisconnect() — HH-03: Hub not reachable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("HH-03: sendDisconnect() returns false (not throw) when Hub is ECONNREFUSED", async () => {
    vi.useRealTimers();
    // Port with nothing listening
    const health = makeHubHealth(19993);
    // RED: sendDisconnect() throws "not implemented"
    const result = await health.sendDisconnect("any-secret").catch(() => "threw");
    // Must resolve to false, NOT throw
    expect(result).toBe(false);
  });

  it("HH-03b: sendDisconnect() calls fetch when Hub is unreachable (ECONNREFUSED)", async () => {
    vi.useRealTimers();
    // Mock fetch to simulate ECONNREFUSED — stub throws before calling fetch,
    // so expect(mockFetch).toHaveBeenCalled() will fail RED until implemented
    const mockFetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const health = makeHubHealth(19992);
    // RED: sendDisconnect() throws "not implemented" — fetch is never called
    const result = await health.sendDisconnect("any-secret").catch(() => false as boolean);

    expect(result).toBe(false);
    expect(mockFetch).toHaveBeenCalled();
  });
});

// ── HH-04: Request includes x-accordo-secret header with provided secret ──────

describe("HubHealth.sendDisconnect() — HH-04: correct auth header", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("HH-04: sendDisconnect() sends x-accordo-secret header matching bridgeSecret param", async () => {
    vi.useRealTimers();
    const srv = await makeDisconnectServer(200);
    try {
      const health = makeHubHealth(srv.port);
      // RED: sendDisconnect() throws "not implemented"
      await health.sendDisconnect("my-bridge-secret");
      expect(srv.lastSecret).toBe("my-bridge-secret");
    } finally {
      await srv.close();
    }
  });

  it("HH-04: sendDisconnect() POSTs to /bridge/disconnect endpoint", async () => {
    vi.useRealTimers();
    const srv = await makeDisconnectServer(200);
    try {
      const health = makeHubHealth(srv.port);
      await health.sendDisconnect("s");
      expect(srv.lastMethod).toBe("POST");
      expect(srv.lastPath).toBe("/bridge/disconnect");
    } finally {
      await srv.close();
    }
  });
});

// ── HH-05: Request timeout → sendDisconnect returns false ─────────────────────

describe("HubHealth.sendDisconnect() — HH-05: request timeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("HH-05: sendDisconnect() returns false when Hub hangs (does not respond within timeout)", async () => {
    vi.useRealTimers();

    // Mock fetch to hang (never resolve) — stub throws before calling fetch,
    // so expect(mockFetch).toHaveBeenCalled() will fail RED until implemented
    const mockFetch = vi.fn().mockReturnValue(new Promise<never>(() => {}));
    vi.stubGlobal("fetch", mockFetch);

    const health = makeHubHealth(19992);
    // RED: sendDisconnect() throws "not implemented" — fetch is never called;
    // When implemented, it must have a short timeout and return false
    const result = await health.sendDisconnect("test-secret").catch(() => false as boolean);

    // Must return false (not hang — test itself has no timeout, implementation must)
    expect(result).toBe(false);
    // fetch must have been called (implementation uses fetch, not http.request)
    expect(mockFetch).toHaveBeenCalled();
  });
});
