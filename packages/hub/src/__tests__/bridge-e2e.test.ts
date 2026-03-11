/**
 * Strategy A — Hub + stub-Bridge end-to-end integration tests
 *
 * Each test boots a real HubServer on an OS-assigned port (port: 0),
 * connects a real WebSocket stub Bridge, issues genuine HTTP MCP requests,
 * and asserts the full protocol round-trip from MCP call to Bridge result.
 *
 * No VS Code process is involved. The stub Bridge simulates the extension
 * host by registering tools and returning result messages.
 *
 * Checklist (user-approved scope):
 *   [x] §E2E-1  Auth + session lifecycle
 *   [x] §E2E-2  Tool registration — full-replace and 409-conflict behaviour
 *   [x] §E2E-3  Tool-call success, tool error, bridge error, timeout
 *   [x] §E2E-4  Bridge disconnect / reconnect during in-flight call
 *   [x] §E2E-5  Concurrency and ordering guarantees
 *   [x] §E2E-6  Week-4 modules: session error text, version close, audit log,
 *               health fields, token file persistence
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { HubServer } from "../server.js";
import type { ToolRegistration } from "@accordo/bridge-types";
import { ACCORDO_PROTOCOL_VERSION, MCP_PROTOCOL_VERSION } from "@accordo/bridge-types";

// ── Constants ─────────────────────────────────────────────────────────────────

const TOKEN = "e2e-test-token";
const SECRET = "e2e-bridge-secret";
/** Short tool-call timeout used throughout so tests don't wait 30 s. */
const TOOL_TIMEOUT_MS = 300;

// ── Shared fixtures ───────────────────────────────────────────────────────────

/** A minimal valid ToolRegistration shape. */
function makeToolReg(name: string): ToolRegistration {
  return {
    name,
    description: `Stub tool ${name}`,
    inputSchema: { type: "object", properties: {}, required: [] },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  };
}

// ── StubBridge ────────────────────────────────────────────────────────────────

type InvokeFrame = { type: "invoke"; id: string; tool: string; args: Record<string, unknown> };
type BridgeResultPayload = { success: boolean; data?: unknown; error?: string };

/**
 * A real WebSocket client that impersonates the Bridge extension host.
 * Connects to /bridge, sends toolRegistry messages, and handles invocations.
 */
class StubBridge {
  private ws: WebSocket | null = null;
  private receivedFrames: Record<string, unknown>[] = [];
  private invokeQueue: InvokeFrame[] = [];
  private manualHandlers = new Map<string, (res: BridgeResultPayload) => void>();
  private autoResponder: ((tool: string, args: Record<string, unknown>) => BridgeResultPayload) | null = null;
  private onInvokeArrived: (() => void) | null = null;

  async connect(baseUrl: string): Promise<void> {
    const wsUrl = baseUrl.replace("http://", "ws://") + "/bridge";
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: { "x-accordo-secret": SECRET },
      });
      ws.on("open", () => {
        this.ws = ws;
        resolve();
      });
      ws.on("message", (data: Buffer) => {
        const frame = JSON.parse(data.toString()) as Record<string, unknown>;
        this.receivedFrames.push(frame);
        if (frame["type"] === "invoke") {
          const inv = frame as unknown as InvokeFrame;
          this.invokeQueue.push(inv);
          this.onInvokeArrived?.();
          if (this.autoResponder) {
            const result = this.autoResponder(inv.tool, inv.args);
            this.send({ type: "result", id: inv.id, ...result });
          }
          const handler = this.manualHandlers.get(inv.tool);
          if (handler) {
            this.manualHandlers.delete(inv.tool);
            handler({ success: true });
          }
        }
      });
      ws.on("error", reject);
    });
  }

  /** Send any raw frame to the Hub. */
  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Replace the registry with the given tools. */
  registerTools(tools: ToolRegistration[]): void {
    this.send({ type: "toolRegistry", tools });
  }

  /** Auto-respond to every future invoke with the given factory. */
  setAutoResponder(
    fn: (tool: string, args: Record<string, unknown>) => BridgeResultPayload,
  ): void {
    this.autoResponder = fn;
  }

  /** Return a promise that resolves once N invokes have been queued. */
  waitForInvokes(n: number, timeoutMs = 1000): Promise<InvokeFrame[]> {
    return new Promise<InvokeFrame[]>((resolve, reject) => {
      const check = () => {
        if (this.invokeQueue.length >= n) {
          resolve(this.invokeQueue.slice(0, n));
        }
      };
      check();
      this.onInvokeArrived = check;
      setTimeout(() => {
        this.onInvokeArrived = null;
        reject(new Error(`waitForInvokes(${n}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /** Send a result frame for a specific invoke ID. */
  respondToId(id: string, result: BridgeResultPayload): void {
    this.send({ type: "result", id, ...result });
  }

  /** Clear the queued invoke list. */
  clearInvokes(): void {
    this.invokeQueue = [];
  }

  /** Gracefully close the WS connection. */
  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  getReceivedFrames(): Record<string, unknown>[] {
    return this.receivedFrames;
  }
}

// ── McpSession ────────────────────────────────────────────────────────────────

interface McpResponseRaw {
  /** HTTP status code */
  status: number;
  /** Mcp-Session-Id response header, or null */
  sessionId: string | null;
  /** Parsed JSON body */
  body: Record<string, unknown> | null;
}

/**
 * Thin wrapper around fetch → /mcp.
 * Manages session creation and reuse.
 */
class McpSession {
  public sessionId: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async call(
    method: string,
    params?: Record<string, unknown>,
    id: string | number | null = 1,
  ): Promise<McpResponseRaw> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.token}`,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const res = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });

    const returnedSession = res.headers.get("mcp-session-id");
    if (returnedSession) this.sessionId = returnedSession;

    let body: Record<string, unknown> | null = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        body = null;
      }
    }

    return { status: res.status, sessionId: returnedSession, body };
  }

  /** Convenience: initialize the session and mark as initialized. */
  async initialize(): Promise<void> {
    await this.call("initialize", {
      protocolVersion: ACCORDO_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "e2e-test", version: "0.0.1" },
    });
    // initialized is a notification — response body is empty
    await this.call("initialized", {}, null);
  }
}

/** Thin helper for one-off unauthenticated or custom-header requests. */
async function rawPost(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<McpResponseRaw> {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> | null = null;
  const text = await res.text();
  if (text) {
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* empty */ }
  }
  return { status: res.status, sessionId: res.headers.get("mcp-session-id"), body: parsed };
}

// ── Per-test server + bridge lifecycle ───────────────────────────────────────

let server: HubServer;
let baseUrl: string;
let bridge: StubBridge;

/** Small delay to let the WS message loop process a sent frame. */
const flush = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(async () => {
  server = new HubServer({
    port: 0,
    host: "127.0.0.1",
    token: TOKEN,
    bridgeSecret: SECRET,
    toolCallTimeout: TOOL_TIMEOUT_MS,
  });
  await server.start();
  const addr = server.getAddress()!;
  baseUrl = `http://${addr.host}:${addr.port}`;
  bridge = new StubBridge();
});

afterEach(async () => {
  bridge.disconnect();
  await server.stop();
});

// ── §E2E-1 Auth + session lifecycle ──────────────────────────────────────────

describe("§E2E-1 Auth + session lifecycle", () => {
  it("§E2E-1.1: no Authorization header returns 401", async () => {
    const res = await rawPost(
      `${baseUrl}/mcp`,
      { "Content-Type": "application/json" },
      { jsonrpc: "2.0", id: 1, method: "ping" },
    );
    expect(res.status).toBe(401);
  });

  it("§E2E-1.2: wrong Bearer token returns 401", async () => {
    const res = await rawPost(
      `${baseUrl}/mcp`,
      { "Content-Type": "application/json", "Authorization": "Bearer wrong-token" },
      { jsonrpc: "2.0", id: 1, method: "ping" },
    );
    expect(res.status).toBe(401);
  });

  it("§E2E-1.3: missing Content-Type returns 415", async () => {
    const res = await rawPost(
      `${baseUrl}/mcp`,
      { "Authorization": `Bearer ${TOKEN}` },
      { jsonrpc: "2.0", id: 1, method: "ping" },
    );
    expect(res.status).toBe(415);
  });

  it("§E2E-1.4: malformed JSON body returns 400", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOKEN}`,
      },
      body: "{ not valid }",
    });
    expect(res.status).toBe(400);
  });

  it("§E2E-1.5: initialize returns protocolVersion + Mcp-Session-Id header", async () => {
    const session = new McpSession(baseUrl, TOKEN);
    const res = await session.call("initialize", {
      protocolVersion: ACCORDO_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "e2e", version: "0.0.1" },
    });
    expect(res.status).toBe(200);
    expect(res.sessionId).toBeTruthy();
    const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
    expect(result["protocolVersion"]).toBe(MCP_PROTOCOL_VERSION);
  });

  it("§E2E-1.6: Mcp-Session-Id is reused across calls", async () => {
    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    const first = session.sessionId;
    // Make a second call reusing the same session
    await session.call("ping");
    expect(session.sessionId).toBe(first); // header only on 200 when session is created
  });

  it("§E2E-1.7: unknown Mcp-Session-Id returns 400 Unknown session", async () => {
    const res = await rawPost(
      `${baseUrl}/mcp`,
      {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOKEN}`,
        "Mcp-Session-Id": "00000000-0000-0000-0000-000000000000",
      },
      { jsonrpc: "2.0", id: 1, method: "ping" },
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/session/i);
  });

  it("§E2E-1.8: initialized notification returns empty body", async () => {
    const session = new McpSession(baseUrl, TOKEN);
    // Create session first
    await session.call("initialize", {
      protocolVersion: ACCORDO_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "e2e", version: "0.0.1" },
    });
    // The initialized notification should return 200 with empty body
    const res = await session.call("initialized", {}, null);
    expect(res.status).toBe(200);
    // notifications return null from handleRequest → res.end() is called with no body
    expect(res.body).toBeNull();
  });
});

// ── §E2E-2 Tool registration ──────────────────────────────────────────────────

describe("§E2E-2 Tool registration", () => {
  it("§E2E-2.1: Bridge registers tools → tools/list returns them", async () => {
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_alpha"), makeToolReg("accordo_test_beta")]);
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    const res = await session.call("tools/list");
    const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
    const names = (result["tools"] as { name: string }[]).map((t) => t.name);
    expect(names).toContain("accordo_test_alpha");
    expect(names).toContain("accordo_test_beta");
  });

  it("§E2E-2.2: re-registration replaces the old registry wholesale", async () => {
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_old")]);
    await flush();
    bridge.registerTools([makeToolReg("accordo_test_new")]);
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    const res = await session.call("tools/list");
    const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
    const names = (result["tools"] as { name: string }[]).map((t) => t.name);
    expect(names).not.toContain("accordo_test_old");
    expect(names).toContain("accordo_test_new");
  });

  it("§E2E-2.3: second Bridge connection evicts the first and succeeds (stale-session recovery)", async () => {
    await bridge.connect(baseUrl);

    // Register a tool on the first connection so we can confirm the second
    // connection's registry update takes effect.
    bridge.registerTools([makeToolReg("accordo_test_first")]);
    await flush();

    // Open a second connection directly.  The Hub should terminate the existing
    // connection and accept the new one (no 409), enabling recovery when VS Code
    // kills the Extension Host without calling deactivate().
    const wsUrl = baseUrl.replace("http://", "ws://") + "/bridge";
    let secondConnected = false;
    await new Promise<void>((resolve, reject) => {
      const ws2 = new WebSocket(wsUrl, { headers: { "x-accordo-secret": SECRET } });
      ws2.on("open", () => {
        secondConnected = true;
        ws2.close(1000);
        resolve();
      });
      ws2.on("unexpected-response", (_req, res) => {
        reject(new Error(`Unexpected HTTP ${res.statusCode} — Hub should evict, not reject`));
      });
      ws2.on("error", (err) => reject(err));
      // Timeout guard
      setTimeout(() => reject(new Error("Timed out waiting for second WS connect")), 3000);
    });

    expect(secondConnected).toBe(true);
  });

  it("§E2E-2.4: tools registered before Bridge disconnects persist until re-registration", async () => {
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_persist")]);
    await flush();
    bridge.disconnect();
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    const res = await session.call("tools/list");
    const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
    const names = (result["tools"] as { name: string }[]).map((t) => t.name);
    expect(names).toContain("accordo_test_persist");
  });

  it("§E2E-2.5: /health toolCount reflects current registry size", async () => {
    await bridge.connect(baseUrl);
    bridge.registerTools([
      makeToolReg("accordo_test_a"),
      makeToolReg("accordo_test_b"),
      makeToolReg("accordo_test_c"),
    ]);
    await flush();

    const res = await fetch(`${baseUrl}/health`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["toolCount"]).toBe(3);
  });
});

// ── §E2E-3 Tool-call success, error, timeout ──────────────────────────────────

describe("§E2E-3 Tool-call success, error, timeout", () => {
  it("§E2E-3.1: calling an unregistered tool returns -32601", async () => {
    await bridge.connect(baseUrl);
    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    const res = await session.call("tools/call", { name: "accordo_test_nonexistent", arguments: {} });
    const error = (res.body?.["error"] ?? {}) as Record<string, unknown>;
    expect(error["code"]).toBe(-32601);
    expect(String(error["message"])).toMatch(/unknown tool/i);
  });

  it("§E2E-3.2: missing name param returns -32602", async () => {
    await bridge.connect(baseUrl);
    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    const res = await session.call("tools/call", { arguments: {} });
    const error = (res.body?.["error"] ?? {}) as Record<string, unknown>;
    expect(error["code"]).toBe(-32602);
  });

  it("§E2E-3.3: tool call with no Bridge connected returns isError result", async () => {
    // Register the tool via a bridge, then disconnect — the tool stays in the
    // registry but the bridge is gone, so the invoke itself fails.
    // MCP spec: tools/call always returns result — not a JSON-RPC error.
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_nobridgenow")]);
    await flush();
    bridge.disconnect();
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    const res = await session.call("tools/call", { name: "accordo_test_nobridgenow", arguments: {} });
    const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
    expect(result["isError"]).toBe(true);
    const content = result["content"] as { type: string; text: string }[];
    expect(content[0].text).toMatch(/bridge/i);
  });

  it("§E2E-3.4: successful tool call returns content[0].text = JSON of data", async () => {
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_echo")]);
    bridge.setAutoResponder(() => ({ success: true, data: { hello: "world" } }));
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    const res = await session.call("tools/call", { name: "accordo_test_echo", arguments: {} });
    const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
    const content = result["content"] as { type: string; text: string }[];
    expect(content[0].type).toBe("text");
    expect(JSON.parse(content[0].text)).toEqual({ hello: "world" });
    expect(result["isError"]).toBeUndefined();
  });

  it("§E2E-3.5: tool handler returning error sets isError:true", async () => {
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_fail")]);
    bridge.setAutoResponder(() => ({ success: false, error: "permission denied" }));
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    const res = await session.call("tools/call", { name: "accordo_test_fail", arguments: {} });
    const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
    expect(result["isError"]).toBe(true);
    const content = result["content"] as { type: string; text: string }[];
    expect(content[0].text).toBe("permission denied");
  });

  it("§E2E-3.6: tool call timeout returns isError result after idempotent retry (M32)", { timeout: 2 * TOOL_TIMEOUT_MS + 1000 }, async () => {
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_slow")]);
    // autoResponder is NOT set — bridge receives the invoke but never replies
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    const res = await session.call("tools/call", { name: "accordo_test_slow", arguments: {} });
    // accordo_test_slow is idempotent:true so M32 retries once on timeout.
    // Both attempts time out → McpHandler returns isError tool result.
    const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
    expect(result["isError"]).toBe(true);
    const content = result["content"] as { type: string; text: string }[];
    expect(content[0].text).toMatch(/timed out/i);
  });

  it("§E2E-3.7: tool arguments are forwarded to the Bridge invoke frame", async () => {
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_argcheck")]);
    bridge.setAutoResponder(() => ({ success: true, data: {} }));
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    await bridge.waitForInvokes(0).catch(() => {}); // prime
    bridge.clearInvokes();

    await session.call("tools/call", {
      name: "accordo_test_argcheck",
      arguments: { path: "/tmp/test.ts", line: 42 },
    });

    const invokes = await bridge.waitForInvokes(1);
    expect(invokes[0].tool).toBe("accordo_test_argcheck");
    expect(invokes[0].args).toEqual({ path: "/tmp/test.ts", line: 42 });
  });
});

// ── §E2E-4 Bridge disconnect / reconnect during in-flight call ────────────────

describe("§E2E-4 Bridge disconnect / reconnect", () => {
  it("§E2E-4.1: disconnect while call is in-flight returns isError result", async () => {
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_stall")]);
    // Do NOT set an auto-responder — the invoke will hang until bridge disconnects
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();

    // Fire the call but don't await yet
    const callPromise = session.call("tools/call", { name: "accordo_test_stall", arguments: {} });

    // Wait until the Hub has sent the invoke frame to the bridge
    await bridge.waitForInvokes(1);

    // Now kill the bridge
    bridge.disconnect();

    const res = await callPromise;
    const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
    expect(result["isError"]).toBe(true);
    const content = result["content"] as { type: string; text: string }[];
    expect(content[0].text).toMatch(/disconnected/i);
  });

  it("§E2E-4.2: calls made after disconnect are rejected immediately", async () => {
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_gone")]);
    await flush();
    bridge.disconnect();
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    const res = await session.call("tools/call", { name: "accordo_test_gone", arguments: {} });
    const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
    expect(result["isError"]).toBe(true);
  });

  it("§E2E-4.3: /health shows disconnected after bridge closes", async () => {
    await bridge.connect(baseUrl);
    await flush();
    bridge.disconnect();
    await flush(100); // WS close event needs more time to propagate under concurrent load

    const res = await fetch(`${baseUrl}/health`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["bridge"]).toBe("disconnected");
  });

  it("§E2E-4.4: bridge reconnect after disconnect restores call routing", async () => {
    // First connection
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_ping")]);
    bridge.setAutoResponder(() => ({ success: true, data: { ok: true } }));
    await flush();

    bridge.disconnect();
    await flush();

    // Second connection — fresh StubBridge instance
    const bridge2 = new StubBridge();
    await bridge2.connect(baseUrl);
    bridge2.registerTools([makeToolReg("accordo_test_ping")]);
    bridge2.setAutoResponder(() => ({ success: true, data: { ok: true } }));
    await flush();

    try {
      const session = new McpSession(baseUrl, TOKEN);
      await session.initialize();
      const res = await session.call("tools/call", { name: "accordo_test_ping", arguments: {} });
      const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
      expect(result["isError"]).toBeUndefined();
    } finally {
      bridge2.disconnect();
    }
  });
});

// ── §E2E-5 Concurrency + ordering ────────────────────────────────────────────

describe("§E2E-5 Concurrency + ordering", () => {
  it("§E2E-5.1: N concurrent calls all succeed", async () => {
    const N = 5;
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_concurrent")]);
    bridge.setAutoResponder((_, args) => ({ success: true, data: args }));
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        session.call("tools/call", { name: "accordo_test_concurrent", arguments: { i } }, i + 1),
      ),
    );

    for (const res of results) {
      expect(res.status).toBe(200);
      const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
      expect(result["isError"]).toBeUndefined();
    }
  });

  it("§E2E-5.2: out-of-order bridge responses map to correct JSON-RPC request IDs", async () => {
    const N = 4;
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_order")]);
    // Do NOT set autoResponder — we'll respond manually in reverse order
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();

    // Fire all calls concurrently
    const callPromises = Array.from({ length: N }, (_, i) =>
      session.call("tools/call", { name: "accordo_test_order", arguments: { seq: i } }, `req-${i}`),
    );

    // Wait for all invoke frames to arrive at the bridge
    const invokes = await bridge.waitForInvokes(N, 2000);

    // Respond in reverse order
    for (const inv of [...invokes].reverse()) {
      bridge.respondToId(inv.id, { success: true, data: { seq: (inv.args["seq"] as number) } });
    }

    const results = await Promise.all(callPromises);

    // Each HTTP response must carry back the right JSON-RPC id
    for (let i = 0; i < N; i++) {
      expect(results[i].body?.["id"]).toBe(`req-${i}`);
      const result = (results[i].body?.["result"] ?? {}) as Record<string, unknown>;
      const content = result["content"] as { text: string }[];
      expect(JSON.parse(content[0].text)).toEqual({ seq: i });
    }
  });

  it("§E2E-5.3: queue full (maxConcurrent=0, maxQueueDepth=0) returns -32004", async () => {
    // Dedicated server with zero concurrency budget
    const tightServer = new HubServer({
      port: 0,
      host: "127.0.0.1",
      token: TOKEN,
      bridgeSecret: SECRET,
      maxConcurrent: 0,
      maxQueueDepth: 0,
      toolCallTimeout: TOOL_TIMEOUT_MS,
    });
    await tightServer.start();
    const addr = tightServer.getAddress()!;
    const tightUrl = `http://${addr.host}:${addr.port}`;

    const tightBridge = new StubBridge();
    await tightBridge.connect(tightUrl);
    tightBridge.registerTools([makeToolReg("accordo_test_busy")]);
    await flush();

    try {
      const session = new McpSession(tightUrl, TOKEN);
      await session.initialize();
      const res = await session.call("tools/call", { name: "accordo_test_busy", arguments: {} });
      const result = (res.body?.["result"] ?? {}) as Record<string, unknown>;
      expect(result["isError"]).toBe(true);
      const content = result["content"] as { type: string; text: string }[];
      expect(content[0].text).toMatch(/busy|queue/i);
    } finally {
      tightBridge.disconnect();
      await tightServer.stop();
    }
  });

  it("§E2E-5.4: inflight counter returns to zero after all calls complete", async () => {
    const N = 3;
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_drain")]);
    bridge.setAutoResponder(() => ({ success: true, data: {} }));
    await flush();

    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();

    await Promise.all(
      Array.from({ length: N }, () =>
        session.call("tools/call", { name: "accordo_test_drain", arguments: {} }),
      ),
    );

    const res = await fetch(`${baseUrl}/health`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["inflight"]).toBe(0);
  });
});

// ── §E2E-6 Week-4 modules ─────────────────────────────────────────────────────

describe("§E2E-6 Week-4 modules", () => {
  // ── M21: session error message text ─────────────────────────────────────

  it("§E2E-6.1 (M21): stale session ID returns 'Invalid or expired session'", async () => {
    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    // Replace the valid session ID with a fabricated stale one
    session.sessionId = "stale-session-id-does-not-exist";
    const res = await session.call("tools/list", {});
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    // Server returns { error: "Invalid or expired session" } — flat string, not RPC nested object
    const errMsg = body["error"] as string;
    expect(errMsg).toContain("Invalid or expired session");
  });

  // ── M22: protocol version close code ────────────────────────────────────

  it("§E2E-6.2 (M22): stateSnapshot with wrong version closes WS with 4002 + version strings", async () => {
    const wsUrl = baseUrl.replace("http://", "ws://") + "/bridge";
    const closeInfo = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { headers: { "x-accordo-secret": SECRET } });
      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "stateSnapshot",
            protocolVersion: "1999-01-01",
            state: {},
          }),
        );
      });
      ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on("error", reject);
      setTimeout(() => reject(new Error("WS close event timed out")), 2000);
    });
    expect(closeInfo.code).toBe(4002);
    expect(closeInfo.reason).toContain(ACCORDO_PROTOCOL_VERSION);
    expect(closeInfo.reason).toContain("1999-01-01");
  });

  // ── M24: audit log written after tool call ───────────────────────────────

  it("§E2E-6.3 (M24): audit log entry written after a successful tool call", async () => {
    const auditFile = path.join(os.tmpdir(), `accordo-audit-${Date.now()}.jsonl`);
    const auditServer = new HubServer({
      port: 0,
      host: "127.0.0.1",
      token: TOKEN,
      bridgeSecret: SECRET,
      toolCallTimeout: TOOL_TIMEOUT_MS,
      auditFile,
    });
    await auditServer.start();
    const addr = auditServer.getAddress()!;
    const auditUrl = `http://${addr.host}:${addr.port}`;
    const auditBridge = new StubBridge();
    await auditBridge.connect(auditUrl);
    auditBridge.registerTools([makeToolReg("accordo_test_audit")]);
    auditBridge.setAutoResponder(() => ({ success: true, data: { ok: true } }));
    await flush();

    try {
      const session = new McpSession(auditUrl, TOKEN);
      await session.initialize();
      await session.call("tools/call", { name: "accordo_test_audit", arguments: { x: 1 } });
      await flush();

      const lines = fs.readFileSync(auditFile, "utf8").trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const entry = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
      expect(entry["tool"]).toBe("accordo_test_audit");
      expect(entry["result"]).toBe("success");
      expect(typeof entry["argsHash"]).toBe("string");
      expect((entry["argsHash"] as string).length).toBe(64); // SHA-256 hex
      expect(entry["sessionId"]).toBeTruthy();
      expect(typeof entry["durationMs"]).toBe("number");
    } finally {
      auditBridge.disconnect();
      await auditServer.stop();
      fs.rmSync(auditFile, { force: true });
    }
  });

  it("§E2E-6.4 (M24): audit log entry records 'error' result when tool returns error", async () => {
    const auditFile = path.join(os.tmpdir(), `accordo-audit-err-${Date.now()}.jsonl`);
    const auditServer = new HubServer({
      port: 0,
      host: "127.0.0.1",
      token: TOKEN,
      bridgeSecret: SECRET,
      toolCallTimeout: TOOL_TIMEOUT_MS,
      auditFile,
    });
    await auditServer.start();
    const addr = auditServer.getAddress()!;
    const auditUrl = `http://${addr.host}:${addr.port}`;
    const auditBridge = new StubBridge();
    await auditBridge.connect(auditUrl);
    auditBridge.registerTools([makeToolReg("accordo_test_audit_fail")]);
    auditBridge.setAutoResponder(() => ({ success: false, error: "simulated tool error" }));
    await flush();

    try {
      const session = new McpSession(auditUrl, TOKEN);
      await session.initialize();
      await session.call("tools/call", { name: "accordo_test_audit_fail", arguments: {} });
      await flush();

      const lines = fs.readFileSync(auditFile, "utf8").trim().split("\n");
      const entry = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
      expect(entry["result"]).toBe("error");
      expect(entry["errorMessage"]).toContain("simulated tool error");
    } finally {
      auditBridge.disconnect();
      await auditServer.stop();
      fs.rmSync(auditFile, { force: true });
    }
  });

  // ── M25: health response includes queued field ───────────────────────────

  it("§E2E-6.5 (M25): /health response includes 'queued' field", async () => {
    await bridge.connect(baseUrl);
    bridge.registerTools([makeToolReg("accordo_test_health")]);
    await flush();

    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, "queued")).toBe(true);
    expect(body["queued"]).toBe(0);
  });

  it("§E2E-6.7 (M25-b): 'queued' counter rises above 0 when inflight limit is saturated", async () => {
    // Use a dedicated server with maxConcurrent=1 so the second request queues immediately.
    const busyServer = new HubServer({
      port: 0,
      host: "127.0.0.1",
      token: TOKEN,
      bridgeSecret: SECRET,
      maxConcurrent: 1,
      maxQueueDepth: 8,
      toolCallTimeout: 2000,
    });
    await busyServer.start();
    const addr = busyServer.getAddress()!;
    const busyUrl = `http://${addr.host}:${addr.port}`;
    const busyBridge = new StubBridge();
    await busyBridge.connect(busyUrl);
    busyBridge.registerTools([makeToolReg("accordo_test_queue")]);
    // Do NOT set autoResponder — hold the first request in-flight
    await flush();

    try {
      const session = new McpSession(busyUrl, TOKEN);
      await session.initialize();

      // First call occupies the single in-flight slot
      const p1 = session.call("tools/call", { name: "accordo_test_queue", arguments: {} });
      await flush(30);

      // Second call must queue (no slot available)
      const p2 = session.call("tools/call", { name: "accordo_test_queue", arguments: {} });
      await flush(30);

      // Health should now show queued: 1, inflight: 1
      const healthRes = await fetch(`${busyUrl}/health`);
      const health = (await healthRes.json()) as Record<string, unknown>;
      expect(health["inflight"]).toBe(1);
      expect(health["queued"]).toBe(1);

      // Respond to both invocations so promises resolve and server can shut down
      const invokes = await busyBridge.waitForInvokes(1, 500);
      busyBridge.respondToId(invokes[0]!.id, { success: true, data: {} });
      await flush(50);
      const invokes2 = await busyBridge.waitForInvokes(2, 500);
      busyBridge.respondToId(invokes2[1]!.id, { success: true, data: {} });
      await Promise.allSettled([p1, p2]);

      // After both complete, counters must return to zero
      const finalRes = await fetch(`${busyUrl}/health`);
      const final = (await finalRes.json()) as Record<string, unknown>;
      expect(final["inflight"]).toBe(0);
      expect(final["queued"]).toBe(0);
    } finally {
      busyBridge.disconnect();
      await busyServer.stop();
    }
  });

  // ── M30-hub: token file written after /bridge/reauth ────────────────────

  it("§E2E-6.6 (M30-hub): /bridge/reauth writes new token to tokenFilePath", async () => {
    const tokenFile = path.join(os.tmpdir(), `accordo-token-${Date.now()}`);
    const reauthServer = new HubServer({
      port: 0,
      host: "127.0.0.1",
      token: TOKEN,
      bridgeSecret: SECRET,
      toolCallTimeout: TOOL_TIMEOUT_MS,
      tokenFilePath: tokenFile,
    });
    await reauthServer.start();
    const addr = reauthServer.getAddress()!;
    const reauthUrl = `http://${addr.host}:${addr.port}`;
    const reauthBridge = new StubBridge();
    await reauthBridge.connect(reauthUrl);
    await flush();

    const newToken = "rotated-token-xyz";
    const newSecret = "rotated-secret-xyz";
    try {
      const res = await fetch(`${reauthUrl}/bridge/reauth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-accordo-secret": SECRET,
        },
        body: JSON.stringify({ newToken, newSecret }),
      });
      expect(res.status).toBe(200);

      const written = fs.readFileSync(tokenFile, "utf8");
      expect(written).toBe(newToken);
    } finally {
      reauthBridge.disconnect();
      await reauthServer.stop();
      fs.rmSync(tokenFile, { force: true });
    }
  });
});
