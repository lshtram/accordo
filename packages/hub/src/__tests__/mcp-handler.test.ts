/**
 * Tests for mcp-handler.ts
 * Requirements: requirements-hub.md §2.1 (MCP methods), §5.5, §6
 *
 * API checklist:
 * ✓ handleRequest — 20 tests (existing) + 9 new (tools/list registry, tools/call)
 * ✓ createSession — 4 tests
 * ✓ getSession — 3 tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { ToolRegistration } from "@accordo/bridge-types";
import { McpHandler } from "../mcp-handler.js";
import type { JsonRpcRequest, Session } from "../mcp-handler.js";
import { ToolRegistry } from "../tool-registry.js";
import { BridgeServer } from "../bridge-server.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(
  method: string,
  params?: Record<string, unknown>,
  id: string | number | null = "req-1",
): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

const SAMPLE_TOOL: ToolRegistration = {
  name: "accordo.editor.open",
  description: "Open a file in the editor",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "File path" } },
    required: ["path"],
  },
  dangerLevel: "safe",
  requiresConfirmation: false,
  idempotent: true,
};

function createHandler(tools: ToolRegistration[] = []): {
  handler: McpHandler;
  toolRegistry: ToolRegistry;
  bridgeServer: BridgeServer;
} {
  const toolRegistry = new ToolRegistry();
  if (tools.length) toolRegistry.register(tools);
  const bridgeServer = new BridgeServer({
    secret: "test-secret",
    maxConcurrent: 16,
    maxQueueDepth: 64,
  });
  return {
    handler: new McpHandler({ toolRegistry, bridgeServer }),
    toolRegistry,
    bridgeServer,
  };
}

// ── McpHandler ────────────────────────────────────────────────────────────────

describe("McpHandler", () => {
  let handler: McpHandler;
  let session: Session;

  beforeEach(() => {
    ({ handler } = createHandler());
    session = handler.createSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── createSession ─────────────────────────────────────────────────────────

  describe("createSession", () => {
    it("§5.5: createSession returns session with non-empty ID", () => {
      expect(session.id).toBeDefined();
      expect(session.id.length).toBeGreaterThan(0);
    });

    it("§5.5: createSession generates unique IDs", () => {
      const s1 = handler.createSession();
      const s2 = handler.createSession();
      expect(s1.id).not.toBe(s2.id);
    });

    it("§5.5: new session starts with initialized: false", () => {
      expect(session.initialized).toBe(false);
    });

    it("§5.5: new session has a createdAt timestamp", () => {
      const before = Date.now();
      const s = handler.createSession();
      const after = Date.now();
      expect(s.createdAt).toBeGreaterThanOrEqual(before);
      expect(s.createdAt).toBeLessThanOrEqual(after);
    });
  });

  // ── getSession ────────────────────────────────────────────────────────────

  describe("getSession", () => {
    it("§5.5: getSession returns session by ID", () => {
      const found = handler.getSession(session.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(session.id);
    });

    it("§5.5: getSession returns undefined for unknown ID", () => {
      expect(handler.getSession("nonexistent-session-id")).toBeUndefined();
    });

    it("§5.5: getSession returns undefined for empty string ID", () => {
      expect(handler.getSession("")).toBeUndefined();
    });
  });

  // ── handleRequest — initialize ────────────────────────────────────────────

  describe("handleRequest — initialize", () => {
    it("§2.1: initialize returns a JSON-RPC 2.0 result", async () => {
      const req = makeRequest("initialize", {
        protocolVersion: ACCORDO_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-agent", version: "1.0" },
      });
      const response = await handler.handleRequest(req, session);
      expect(response).not.toBeNull();
      expect(response?.jsonrpc).toBe("2.0");
      expect(response?.id).toBe("req-1");
      expect(response?.error).toBeUndefined();
    });

    it("§2.1: initialize result includes protocolVersion", async () => {
      const req = makeRequest("initialize", {
        protocolVersion: ACCORDO_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-agent", version: "1.0" },
      });
      const response = await handler.handleRequest(req, session);
      const result = response?.result as Record<string, unknown>;
      expect(result).toHaveProperty("protocolVersion", ACCORDO_PROTOCOL_VERSION);
    });

    it("§2.1: initialize result includes serverInfo", async () => {
      const req = makeRequest("initialize", {
        protocolVersion: ACCORDO_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-agent", version: "1.0" },
      });
      const response = await handler.handleRequest(req, session);
      const result = response?.result as Record<string, unknown>;
      expect(result).toHaveProperty("serverInfo");
    });

    it("§2.1: initialize result includes capabilities", async () => {
      const req = makeRequest("initialize", {
        protocolVersion: ACCORDO_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-agent", version: "1.0" },
      });
      const response = await handler.handleRequest(req, session);
      const result = response?.result as Record<string, unknown>;
      expect(result).toHaveProperty("capabilities");
    });

    it("§5.5: handleRequest updates session lastActivity timestamp", async () => {
      const before = Date.now();
      const req = makeRequest("initialize", {
        protocolVersion: ACCORDO_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "agent", version: "1" },
      });
      await handler.handleRequest(req, session);
      expect(session.lastActivity).toBeGreaterThanOrEqual(before);
    });
  });

  // ── handleRequest — initialized ───────────────────────────────────────────

  describe("handleRequest — initialized (notification)", () => {
    it("§2.1: initialized notification returns null (no response)", async () => {
      const req = makeRequest("initialized", {}, null);
      const response = await handler.handleRequest(req, session);
      expect(response).toBeNull();
    });

    it("§2.1: initialized notification marks session as initialized", async () => {
      await handler.handleRequest(
        makeRequest("initialize", {
          protocolVersion: ACCORDO_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "x", version: "1" },
        }),
        session,
      );
      await handler.handleRequest(makeRequest("initialized", {}, null), session);
      expect(handler.getSession(session.id)?.initialized).toBe(true);
    });
  });

  // ── handleRequest — tools/list ────────────────────────────────────────────

  describe("handleRequest — tools/list", () => {
    it("§2.1: tools/list returns result with tools array", async () => {
      const req = makeRequest("tools/list");
      const response = await handler.handleRequest(req, session);
      expect(response?.error).toBeUndefined();
      const result = response?.result as Record<string, unknown>;
      expect(Array.isArray(result?.tools)).toBe(true);
    });

    it("§2.1: tools/list returns real tools from registry when tools are registered", async () => {
      const { handler: h, toolRegistry } = createHandler();
      const s = h.createSession();
      toolRegistry.register([SAMPLE_TOOL]);
      const req = makeRequest("tools/list");
      const response = await h.handleRequest(req, s);
      const result = response?.result as { tools: unknown[] };
      expect(result.tools).toHaveLength(1);
      const t = result.tools[0] as Record<string, unknown>;
      expect(t["name"]).toBe("accordo.editor.open");
    });

    it("§2.1: tools/list returns empty array when no tools registered", async () => {
      const req = makeRequest("tools/list");
      const response = await handler.handleRequest(req, session);
      const result = response?.result as { tools: unknown[] };
      expect(result.tools).toHaveLength(0);
    });

    it("§2.1: tools/list MCP format includes name, description, inputSchema only", async () => {
      const { handler: h, toolRegistry } = createHandler();
      const s = h.createSession();
      toolRegistry.register([SAMPLE_TOOL]);
      const req = makeRequest("tools/list");
      const response = await h.handleRequest(req, s);
      const result = response?.result as { tools: Record<string, unknown>[] };
      const t = result.tools[0];
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("description");
      expect(t).toHaveProperty("inputSchema");
      // Handler, dangerLevel, requiresConfirmation NOT in MCP wire format
      expect(t).not.toHaveProperty("handler");
      expect(t).not.toHaveProperty("dangerLevel");
    });
  });

  // ── handleRequest — ping ──────────────────────────────────────────────────

  describe("handleRequest — ping", () => {
    it("§2.1: ping returns a pong result", async () => {
      const req = makeRequest("ping");
      const response = await handler.handleRequest(req, session);
      expect(response?.error).toBeUndefined();
      expect(response?.result).toBeDefined();
    });
  });

  // ── handleRequest — tools/call ────────────────────────────────────────────

  describe("handleRequest — tools/call", () => {
    it("§2.1: tools/call — missing name param returns error -32602", async () => {
      const req = makeRequest("tools/call", { arguments: {} });
      const response = await handler.handleRequest(req, session);
      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(-32602);
    });

    it("§6: tools/call — unknown tool returns error -32601", async () => {
      // req-hub §6: "Tool not found → { code: -32601, message: 'Unknown tool: <name>' }"
      const req = makeRequest("tools/call", {
        name: "accordo.editor.nonexistent",
        arguments: {},
      });
      const response = await handler.handleRequest(req, session);
      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(-32601);
      expect(response?.error?.message).toContain("accordo.editor.nonexistent");
    });

    it("§6: tools/call — bridge not connected returns error -32603", async () => {
      // req-hub §6: "Bridge not connected → { code: -32603 }"
      const { handler: h, toolRegistry } = createHandler([SAMPLE_TOOL]);
      const s = h.createSession();
      // Bridge is NOT connected (default state)
      const req = makeRequest("tools/call", {
        name: "accordo.editor.open",
        arguments: { path: "/foo.ts" },
      });
      const response = await h.handleRequest(req, s);
      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(-32603);
    });

    it("§6: tools/call — queue full returns error -32004", async () => {
      // req-hub §6: "Server busy → { code: -32004 }"
      // Configure maxConcurrent=0, maxQueueDepth=0 forces queue-full state
      const toolRegistry = new ToolRegistry();
      toolRegistry.register([SAMPLE_TOOL]);
      const bridgeServer = new BridgeServer({
        secret: "s",
        maxConcurrent: 0,
        maxQueueDepth: 0,
      });
      const h = new McpHandler({ toolRegistry, bridgeServer });
      const s = h.createSession();
      const req = makeRequest("tools/call", {
        name: "accordo.editor.open",
        arguments: { path: "/foo.ts" },
      });
      const response = await h.handleRequest(req, s);
      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(-32004);
    });

    it("§2.1: tools/call — preserves request ID in error responses", async () => {
      const req = makeRequest("tools/call", { arguments: {} }, "call-42");
      const response = await handler.handleRequest(req, session);
      expect(response?.id).toBe("call-42");
    });

    it("§2.1: tools/call — bridge connected, invoke succeeds → returns content array", async () => {
      // RED on stub: bridgeServer.invoke() throws "not implemented"
      const { handler: h, bridgeServer } = createHandler([SAMPLE_TOOL]);
      const s = h.createSession();
      vi.spyOn(bridgeServer, "isConnected").mockReturnValue(true);
      vi.spyOn(bridgeServer, "invoke").mockResolvedValue({
        type: "result",
        id: "r1",
        success: true,
        data: { out: 42 },
      });
      const req = makeRequest("tools/call", {
        name: "accordo.editor.open",
        arguments: { path: "/foo.ts" },
      });
      const response = await h.handleRequest(req, s);
      expect(response?.error).toBeUndefined();
      const result = response?.result as { content: unknown[] };
      expect(Array.isArray(result?.content)).toBe(true);
    });

    it("§6: tools/call — bridge invoke times out → error -32001", async () => {
      // req-hub §6: "Tool invocation timed out → { code: -32001 }"
      // RED on stub: bridgeServer.invoke throws "not implemented" (wrong error code)
      const { handler: h, bridgeServer } = createHandler([SAMPLE_TOOL]);
      const s = h.createSession();
      vi.spyOn(bridgeServer, "isConnected").mockReturnValue(true);
      vi.spyOn(bridgeServer, "invoke").mockRejectedValue(
        new Error("Tool invocation timed out"),
      );
      const req = makeRequest("tools/call", {
        name: "accordo.editor.open",
        arguments: { path: "/foo.ts" },
      });
      const response = await h.handleRequest(req, s);
      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(-32001);
    });
  });

  // ── handleRequest — unknown method ────────────────────────────────────────

  describe("handleRequest — unknown method", () => {
    it("§6: unknown method returns JSON-RPC error -32601", async () => {
      const req = makeRequest("tools/nonexistent");
      const response = await handler.handleRequest(req, session);
      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(-32601);
    });

    it("§6: error response preserves the original request ID", async () => {
      const req = makeRequest("unknown/method", {}, "my-request-id");
      const response = await handler.handleRequest(req, session);
      expect(response?.id).toBe("my-request-id");
    });
  });

  // ── handleRequest — malformed request ────────────────────────────────────

  describe("handleRequest — malformed request", () => {
    it("§6: empty method string returns JSON-RPC error -32600 (Invalid request)", async () => {
      const req = { jsonrpc: "2.0" as const, id: "bad", method: "" };
      const response = await handler.handleRequest(req, session);
      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(-32600);
    });
  });
});

