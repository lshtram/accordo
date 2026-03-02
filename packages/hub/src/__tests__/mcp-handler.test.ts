/**
 * Tests for mcp-handler.ts
 * Requirements: requirements-hub.md §2.1 (MCP methods), §5.5
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import { McpHandler } from "../mcp-handler.js";
import type { JsonRpcRequest, Session } from "../mcp-handler.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(
  method: string,
  params?: Record<string, unknown>,
  id: string | number | null = "req-1",
): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

// ── McpHandler ────────────────────────────────────────────────────────────────

describe("McpHandler", () => {
  let handler: McpHandler;
  let session: Session;

  beforeEach(() => {
    handler = new McpHandler();
    session = handler.createSession();
  });

  // ── createSession ─────────────────────────────────────────────────────────

  describe("createSession", () => {
    it("§5.5: createSession returns session with non-empty ID", () => {
      // req-hub §5.5: createSession() → Session (called on initialize)
      expect(session.id).toBeDefined();
      expect(session.id.length).toBeGreaterThan(0);
    });

    it("§5.5: createSession generates unique IDs", () => {
      const s1 = handler.createSession();
      const s2 = handler.createSession();
      expect(s1.id).not.toBe(s2.id);
    });

    it("§5.5: new session starts with initialized: false", () => {
      // Session starts uninitialized until client sends 'initialized' notification
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
      // req-hub §5.5: getSession(id) → Session | undefined
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
      // req-hub §2.1: initialize → capability negotiation
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
  });

  // ── handleRequest — initialized ───────────────────────────────────────────

  describe("handleRequest — initialized (notification)", () => {
    it("§2.1: initialized notification returns null (no response)", async () => {
      // req-hub §2.1: initialized is a notification — no response
      const req = makeRequest("initialized", {}, null);
      const response = await handler.handleRequest(req, session);
      expect(response).toBeNull();
    });

    it("§2.1: initialized notification marks session as initialized", async () => {
      // Initialize first
      await handler.handleRequest(
        makeRequest("initialize", { protocolVersion: ACCORDO_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "x", version: "1" } }),
        session,
      );
      // Then send initialized notification
      await handler.handleRequest(makeRequest("initialized", {}, null), session);
      expect(handler.getSession(session.id)?.initialized).toBe(true);
    });
  });

  // ── handleRequest — tools/list ────────────────────────────────────────────

  describe("handleRequest — tools/list", () => {
    it("§2.1: tools/list returns result with tools array", async () => {
      // req-hub §2.1: tools/list → returns all registered tools
      const req = makeRequest("tools/list");
      const response = await handler.handleRequest(req, session);
      expect(response?.error).toBeUndefined();
      const result = response?.result as Record<string, unknown>;
      expect(Array.isArray(result?.tools)).toBe(true);
    });
  });

  // ── handleRequest — ping ──────────────────────────────────────────────────

  describe("handleRequest — ping", () => {
    it("§2.1: ping returns a pong result", async () => {
      // req-hub §2.1: ping ↔ liveness check
      const req = makeRequest("ping");
      const response = await handler.handleRequest(req, session);
      expect(response?.error).toBeUndefined();
      expect(response?.result).toBeDefined();
    });
  });

  // ── handleRequest — tools/call ────────────────────────────────────────────

  describe("handleRequest — tools/call", () => {
    // tools/call routes through BridgeServer and requires a live WS connection.
    // Full unit tests land in Week 2 once BridgeServer.invoke() is wired.
    it.todo("§2.1: tools/call routes tool invocation through bridge-server (Week 2)");
    it.todo("§2.1: tools/call returns error -32603 when bridge not connected (Week 2)");
  });

  // ── handleRequest — unknown method ────────────────────────────────────────

  describe("handleRequest — unknown method", () => {
    it("§6: unknown method returns JSON-RPC error -32601", async () => {
      // JSON-RPC 2.0 spec: unknown method → error code -32601 (Method not found)
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

  // ── handleRequest — invalid request ──────────────────────────────────────

  describe("handleRequest — malformed request", () => {
    it("§6: empty method string returns JSON-RPC error -32600 (Invalid request)", async () => {
      // req-hub §6: "Invalid JSON-RPC request → { code: -32600, message: 'Invalid request' }"
      const req = { jsonrpc: "2.0" as const, id: "bad", method: "" };
      const response = await handler.handleRequest(req, session);
      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(-32600);
    });
  });
});
