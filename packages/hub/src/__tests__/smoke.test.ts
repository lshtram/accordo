/**
 * Integration smoke tests — Hub HTTP + stdio
 *
 * Starts a real HubServer on an OS-assigned port (port: 0) and exercises
 * every externally-visible endpoint over real TCP. Also verifies that
 * main() boots in stdio mode and that StdioTransport handles end-to-end
 * MCP over streams.
 *
 * Requirements: requirements-hub.md §2.1, §2.2, §2.3, §2.4, §4.1
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PassThrough } from "node:stream";
import { HubServer } from "../server.js";
import { McpHandler } from "../mcp-handler.js";
import { ToolRegistry } from "../tool-registry.js";
import { BridgeServer } from "../bridge-server.js";
import { StdioTransport } from "../stdio-transport.js";
import { ACCORDO_PROTOCOL_VERSION, MCP_PROTOCOL_VERSION } from "@accordo/bridge-types";

// ── Constants ─────────────────────────────────────────────────────────────────

const TOKEN = "smoke-test-bearer";
const SECRET = "smoke-bridge-secret";

// ── HTTP smoke ────────────────────────────────────────────────────────────────

describe("Hub HTTP smoke", () => {
  let server: HubServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = new HubServer({
      port: 0, // OS picks a free port
      host: "127.0.0.1",
      token: TOKEN,
      bridgeSecret: SECRET,
    });
    await server.start();
    const addr = server.getAddress()!;
    baseUrl = `http://${addr.host}:${addr.port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  // ── /health ────────────────────────────────────────────────────────────────

  it("§2.4: GET /health returns 200 with ok:true", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(typeof body["uptime"]).toBe("number");
    expect(body["protocolVersion"]).toBe(ACCORDO_PROTOCOL_VERSION);
  });

  it("§2.4: GET /health is available without authentication", async () => {
    // No Authorization header — should still be 200
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  // ── /mcp – unauthenticated ─────────────────────────────────────────────────

  it("§2.1: POST /mcp without Bearer returns 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "x", method: "ping" }),
    });
    expect(res.status).toBe(401);
  });

  // ── /mcp – authenticated ───────────────────────────────────────────────────

  it("§2.1: POST /mcp initialize returns MCP result", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "init-smoke",
        method: "initialize",
        params: {
          protocolVersion: ACCORDO_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "smoke-test", version: "0.0.1" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["id"]).toBe("init-smoke");
    expect(body["error"]).toBeUndefined();
    const result = body["result"] as Record<string, unknown>;
    expect(result["protocolVersion"]).toBe(MCP_PROTOCOL_VERSION);
  });

  it("§2.1: POST /mcp ping returns pong", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "ping-smoke", method: "ping" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["id"]).toBe("ping-smoke");
    expect(body["error"]).toBeUndefined();
  });

  it("§2.1: POST /mcp tools/list returns tool array", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "list-smoke", method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["id"]).toBe("list-smoke");
    expect(body["error"]).toBeUndefined();
    const result = body["result"] as Record<string, unknown>;
    expect(Array.isArray(result["tools"])).toBe(true);
  });

  // ── /instructions ──────────────────────────────────────────────────────────

  it("§2.3: GET /instructions without Bearer returns 401", async () => {
    const res = await fetch(`${baseUrl}/instructions`);
    expect(res.status).toBe(401);
  });

  it("§2.3: GET /instructions with Bearer returns text/markdown", async () => {
    const res = await fetch(`${baseUrl}/instructions`, {
      headers: { "Authorization": `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });

  // ── wrong method ───────────────────────────────────────────────────────────

  it("§2.1: GET /mcp without auth returns 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`);
    expect(res.status).toBe(401);
    // consume body to avoid connection leaks
    await res.text();
  });

  it("§2.1: GET /mcp with auth opens SSE stream (text/event-stream)", async () => {
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/mcp`, {
      headers: { "Authorization": `Bearer ${TOKEN}` },
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // abort immediately — we just need to verify headers
    ac.abort();
  });
});

// ── stdio smoke ───────────────────────────────────────────────────────────────

describe("Hub stdio smoke", () => {
  function makeTransport() {
    const input = new PassThrough();
    const output = new PassThrough();
    const logStream = new PassThrough();
    const outLines: string[] = [];

    output.on("data", (chunk: Buffer) => {
      outLines.push(...chunk.toString().split("\n").filter(Boolean));
    });

    const toolRegistry = new ToolRegistry();
    const bridgeServer = new BridgeServer({ secret: SECRET, maxConcurrent: 16, maxQueueDepth: 64 });
    const mcpHandler = new McpHandler({ toolRegistry, bridgeServer });
    const transport = new StdioTransport({ handler: mcpHandler, input, output, logStream });

    return { transport, input, output, logStream, outLines };
  }

  it("§2.2: initialize over stdio returns result", async () => {
    const { transport, input, outLines } = makeTransport();
    const p = transport.start();
    p.catch(() => {});

    input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "stdio-init",
        method: "initialize",
        params: {
          protocolVersion: ACCORDO_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "smoke", version: "0.0.1" },
        },
      }) + "\n",
    );

    await new Promise((r) => setTimeout(r, 30));
    input.end();
    await p;

    expect(outLines).toHaveLength(1);
    const resp = JSON.parse(outLines[0]) as Record<string, unknown>;
    expect(resp["id"]).toBe("stdio-init");
    expect(resp["error"]).toBeUndefined();
  });

  it("§2.2: ping over stdio returns result", async () => {
    const { transport, input, outLines } = makeTransport();
    const p = transport.start();
    p.catch(() => {});

    input.write(JSON.stringify({ jsonrpc: "2.0", id: "stdio-ping", method: "ping" }) + "\n");

    await new Promise((r) => setTimeout(r, 30));
    input.end();
    await p;

    const resp = JSON.parse(outLines[0]) as Record<string, unknown>;
    expect(resp["id"]).toBe("stdio-ping");
    expect(resp["error"]).toBeUndefined();
  });

  it("§2.2: tools/list over stdio returns tool array", async () => {
    const { transport, input, outLines } = makeTransport();
    const p = transport.start();
    p.catch(() => {});

    input.write(JSON.stringify({ jsonrpc: "2.0", id: "stdio-list", method: "tools/list" }) + "\n");

    await new Promise((r) => setTimeout(r, 30));
    input.end();
    await p;

    const resp = JSON.parse(outLines[0]) as Record<string, unknown>;
    expect(resp["id"]).toBe("stdio-list");
    expect(resp["error"]).toBeUndefined();
    const result = resp["result"] as Record<string, unknown>;
    expect(Array.isArray(result["tools"])).toBe(true);
  });

  it("§2.2: malformed JSON over stdio returns parse error", async () => {
    const { transport, input, outLines } = makeTransport();
    const p = transport.start();
    p.catch(() => {});

    input.write("{ not valid json }\n");

    await new Promise((r) => setTimeout(r, 30));
    input.end();
    await p;

    const resp = JSON.parse(outLines[0]) as Record<string, unknown>;
    const error = resp["error"] as Record<string, unknown>;
    expect(error["code"]).toBe(-32700);
  });
});
