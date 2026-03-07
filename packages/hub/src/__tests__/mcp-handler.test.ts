/**
 * Tests for mcp-handler.ts
 * Requirements: requirements-hub.md §2.1 (MCP methods), §5.5, §6
 *
 * API checklist:
 * ✓ handleRequest — 20 tests (existing) + 9 new (tools/list registry, tools/call)
 * ✓ createSession — 4 tests
 * ✓ getSession — 3 tests
 * ✓ M32 idempotent retry — 5 tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ACCORDO_PROTOCOL_VERSION, MCP_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { ToolRegistration } from "@accordo/bridge-types";
import { McpHandler } from "../mcp-handler.js";
import type { JsonRpcRequest, Session } from "../mcp-handler.js";
import { ToolRegistry } from "../tool-registry.js";
import { BridgeServer } from "../bridge-server.js";
import * as auditLog from "../audit-log.js";

// Mock audit-log so tests stay hermetic (no filesystem I/O)
vi.mock("../audit-log.js", () => ({
  writeAuditEntry: vi.fn(),
  hashArgs: vi.fn().mockReturnValue("mock-hash-64chars-----------------------------------"),
  rotateIfNeeded: vi.fn(),
  AUDIT_ROTATION_SIZE_BYTES: 10 * 1024 * 1024,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(
  method: string,
  params?: Record<string, unknown>,
  id: string | number | null = "req-1",
): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

const SAMPLE_TOOL: ToolRegistration = {
  name: "accordo_editor_open",
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

function createHandlerWithAudit(tools: ToolRegistration[] = []): {
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
    handler: new McpHandler({
      toolRegistry,
      bridgeServer,
      auditFile: "/tmp/test-audit.jsonl",
      toolCallTimeout: 100,
    }),
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
      expect(result).toHaveProperty("protocolVersion", MCP_PROTOCOL_VERSION);
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

    it("§2.1: initialize capabilities declares tools.listChanged:true for SSE notifications", async () => {
      const req = makeRequest("initialize", {
        protocolVersion: ACCORDO_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-agent", version: "1.0" },
      });
      const response = await handler.handleRequest(req, session);
      const result = response?.result as Record<string, unknown>;
      const caps = result["capabilities"] as Record<string, unknown>;
      const tools = caps["tools"] as Record<string, unknown>;
      expect(tools["listChanged"]).toBe(true);
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
      expect(t["name"]).toBe("accordo_editor_open");
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
        name: "accordo_editor_nonexistent",
        arguments: {},
      });
      const response = await handler.handleRequest(req, session);
      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(-32601);
      expect(response?.error?.message).toContain("accordo_editor_nonexistent");
    });

    it("§6: tools/call — bridge not connected returns error -32603", async () => {
      // req-hub §6: "Bridge not connected → { code: -32603 }"
      const { handler: h, toolRegistry } = createHandler([SAMPLE_TOOL]);
      const s = h.createSession();
      // Bridge is NOT connected (default state)
      const req = makeRequest("tools/call", {
        name: "accordo_editor_open",
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
        name: "accordo_editor_open",
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
        name: "accordo_editor_open",
        arguments: { path: "/foo.ts" },
      });
      const response = await h.handleRequest(req, s);
      expect(response?.error).toBeUndefined();
      const result = response?.result as { content: unknown[]; isError?: boolean };
      expect(Array.isArray(result?.content)).toBe(true);
      expect(result?.isError).toBeUndefined();
    });

    it("§6: tools/call — bridge returns success:false → MCP isError result (not JSON-RPC error)", async () => {
      // Per MCP spec 2024-11-05: tool execution errors surface as result.isError:true
      // so the LLM sees the error message and can adapt rather than treating it as
      // a protocol failure.
      const { handler: h, bridgeServer } = createHandler([SAMPLE_TOOL]);
      const s = h.createSession();
      vi.spyOn(bridgeServer, "isConnected").mockReturnValue(true);
      vi.spyOn(bridgeServer, "invoke").mockResolvedValue({
        type: "result",
        id: "r1",
        success: false,
        error: "No active editor",
      });
      const req = makeRequest("tools/call", {
        name: "accordo_editor_open",
        arguments: { path: "/foo.ts" },
      });
      const response = await h.handleRequest(req, s);
      // Must NOT be a JSON-RPC error field
      expect(response?.error).toBeUndefined();
      const result = response?.result as { content: Array<{ text: string }>; isError: boolean };
      expect(result?.isError).toBe(true);
      expect(result?.content[0]?.text).toContain("No active editor");
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
        name: "accordo_editor_open",
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

// ── §7: Audit log integration (M24) ──────────────────────────────────────────
//
// Tests require auditFile to be set on McpHandler and verify that
// writeAuditEntry is called with the correct outcome for each tools/call path.
// All are RED: handleToolsCall does not yet call writeAuditEntry.
// ─────────────────────────────────────────────────────────────────────────────

describe("McpHandler — §7 audit log integration (M24)", () => {
  let auditHandler: McpHandler;
  let auditBridgeServer: BridgeServer;
  let auditSession: Session;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply return value: vi.restoreAllMocks() in the outer describe's afterEach
    // resets vi.fn() implementations, so we restore it here for each §7 test.
    vi.mocked(auditLog.hashArgs).mockReturnValue("mock-hash-64chars-----------------------------------");
    const { handler, bridgeServer } = createHandlerWithAudit([SAMPLE_TOOL]);
    auditHandler = handler;
    auditBridgeServer = bridgeServer;
    auditSession = auditHandler.createSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("§7: successful tools/call writes audit entry with result='success'", async () => {
    vi.spyOn(auditBridgeServer, "invoke").mockResolvedValue({
      type: "result",
      id: "mock-id",
      success: true,
      data: { opened: true },
    });

    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/foo.ts" },
    });
    await auditHandler.handleRequest(req, auditSession);

    // RED: writeAuditEntry is never called in the stub
    expect(auditLog.writeAuditEntry).toHaveBeenCalledWith(
      "/tmp/test-audit.jsonl",
      expect.objectContaining({ result: "success", tool: "accordo_editor_open" }),
    );
  });

  it("§7: tools/call where Bridge returns success:false writes result='error'", async () => {
    vi.spyOn(auditBridgeServer, "invoke").mockResolvedValue({
      type: "result",
      id: "mock-id",
      success: false,
      error: "Tool execution failed",
    });

    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/foo.ts" },
    });
    await auditHandler.handleRequest(req, auditSession);

    // RED: writeAuditEntry not called
    expect(auditLog.writeAuditEntry).toHaveBeenCalledWith(
      "/tmp/test-audit.jsonl",
      expect.objectContaining({
        result: "error",
        tool: "accordo_editor_open",
        errorMessage: expect.any(String),
      }),
    );
  });

  it("§7: tools/call timeout writes result='timeout'", async () => {
    vi.spyOn(auditBridgeServer, "invoke").mockRejectedValue(
      Object.assign(new Error("Tool invocation timed out after 100ms"), { code: -32001 }),
    );

    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/foo.ts" },
    });
    await auditHandler.handleRequest(req, auditSession);

    // RED: writeAuditEntry not called
    expect(auditLog.writeAuditEntry).toHaveBeenCalledWith(
      "/tmp/test-audit.jsonl",
      expect.objectContaining({ result: "timeout", tool: "accordo_editor_open" }),
    );
  });

  it("§7: tools/call not-connected error writes result='error'", async () => {
    // Bridge not connected → JsonRpcError with code -32603
    const { JsonRpcError } = await import("../errors.js");
    vi.spyOn(auditBridgeServer, "invoke").mockRejectedValue(
      new JsonRpcError("Bridge not connected", -32603),
    );

    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/foo.ts" },
    });
    await auditHandler.handleRequest(req, auditSession);

    // RED: writeAuditEntry not called
    expect(auditLog.writeAuditEntry).toHaveBeenCalledWith(
      "/tmp/test-audit.jsonl",
      expect.objectContaining({ result: "error", tool: "accordo_editor_open" }),
    );
  });

  it("§7: audit entry includes argsHash from hashArgs", async () => {
    vi.spyOn(auditBridgeServer, "invoke").mockResolvedValue({
      type: "result",
      id: "mock-id",
      success: true,
      data: {},
    });

    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/file.ts" },
    });
    await auditHandler.handleRequest(req, auditSession);

    // RED: neither hashArgs nor writeAuditEntry are called
    expect(auditLog.hashArgs).toHaveBeenCalledWith({ path: "/file.ts" });
    expect(auditLog.writeAuditEntry).toHaveBeenCalledWith(
      "/tmp/test-audit.jsonl",
      expect.objectContaining({ argsHash: "mock-hash-64chars-----------------------------------" }),
    );
  });

  it("§7: audit entry includes sessionId from the MCP session", async () => {
    vi.spyOn(auditBridgeServer, "invoke").mockResolvedValue({
      type: "result",
      id: "mock-id",
      success: true,
      data: {},
    });

    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/file.ts" },
    });
    await auditHandler.handleRequest(req, auditSession);

    // RED
    expect(auditLog.writeAuditEntry).toHaveBeenCalledWith(
      "/tmp/test-audit.jsonl",
      expect.objectContaining({ sessionId: auditSession.id }),
    );
  });

  it("§7: when auditFile is not set, writeAuditEntry is NOT called", async () => {
    const { handler, bridgeServer } = createHandler([SAMPLE_TOOL]);
    vi.spyOn(bridgeServer, "invoke").mockResolvedValue({
      type: "result", id: "mock-id", success: true, data: {},
    });

    const sess = handler.createSession();
    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/file.ts" },
    });
    await handler.handleRequest(req, sess);

    expect(auditLog.writeAuditEntry).not.toHaveBeenCalled();
  });

  it("§7 M24: tools/call where data contains {error} writes result='error' and isError:true", async () => {
    // Editor tools catch VS Code errors and return { error: "..." } rather than
    // throwing.  The Bridge sends success:true but data:{ error: "..." }.
    // McpHandler must classify these as errors in the audit log and set
    // isError:true in the MCP response so agents know the tool failed.
    vi.spyOn(auditBridgeServer, "invoke").mockResolvedValue({
      type: "result",
      id: "mock-id",
      success: true,
      data: { error: "No such file: /nonexistent.ts" },
    });

    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/nonexistent.ts" },
    });
    const response = await auditHandler.handleRequest(req, auditSession);

    // Audit must record this as an error with the error message
    expect(auditLog.writeAuditEntry).toHaveBeenCalledWith(
      "/tmp/test-audit.jsonl",
      expect.objectContaining({
        result: "error",
        tool: "accordo_editor_open",
        errorMessage: "No such file: /nonexistent.ts",
      }),
    );

    // MCP response must carry isError:true so the LLM can adapt
    const result = (response as { result: { isError?: boolean; content: Array<{ text: string }> } }).result;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("No such file: /nonexistent.ts");
  });
});

// ── M32: Idempotent tool retry on timeout ─────────────────────────────────────
//
// architecture.md §8.3: Tools marked `idempotent: true` are retried ONCE by
// McpHandler when the Bridge invoke times out. McpHandler already has access to
// toolRegistry to check the idempotent flag. BridgeServer has no registry
// dependency, so retry MUST happen at the McpHandler layer.
// ─────────────────────────────────────────────────────────────────────────────

const IDEMPOTENT_TOOL: ToolRegistration = {
  name: "accordo_editor_open",
  description: "Open a file",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "File path" } },
    required: ["path"],
  },
  dangerLevel: "safe",
  requiresConfirmation: false,
  idempotent: true,
};

const NON_IDEMPOTENT_TOOL: ToolRegistration = {
  name: "accordo_terminal_run",
  description: "Run a command",
  inputSchema: {
    type: "object",
    properties: { command: { type: "string", description: "Command" } },
    required: ["command"],
  },
  dangerLevel: "destructive",
  requiresConfirmation: true,
  idempotent: false,
};

describe("McpHandler — M32: idempotent retry on timeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("M32: idempotent tool is retried once after timeout — retry succeeds", async () => {
    const { handler, bridgeServer } = createHandler([IDEMPOTENT_TOOL]);
    const session = handler.createSession();

    const invokeSpy = vi.spyOn(bridgeServer, "invoke");
    // First call: timeout. Second call: success.
    invokeSpy
      .mockRejectedValueOnce(
        Object.assign(new Error("Tool invocation timed out after 100ms"), { code: -32000 }),
      )
      .mockResolvedValueOnce({
        type: "result",
        id: "retry-1",
        success: true,
        data: { opened: true },
      });

    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/foo.ts" },
    });
    const response = await handler.handleRequest(req, session);

    // RED: current code does NOT retry — it returns the timeout error immediately
    expect(invokeSpy).toHaveBeenCalledTimes(2);
    expect(response?.error).toBeUndefined();
    const result = response?.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(result?.isError).toBeUndefined();
    expect(result?.content[0]?.text).toContain("opened");
  });

  it("M32: idempotent tool is retried once — retry also times out → returns timeout error", async () => {
    const { handler, bridgeServer } = createHandler([IDEMPOTENT_TOOL]);
    const session = handler.createSession();

    const invokeSpy = vi.spyOn(bridgeServer, "invoke");
    // Both calls timeout
    invokeSpy
      .mockRejectedValueOnce(
        Object.assign(new Error("Tool invocation timed out after 100ms"), { code: -32000 }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error("Tool invocation timed out after 100ms"), { code: -32000 }),
      );

    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/foo.ts" },
    });
    const response = await handler.handleRequest(req, session);

    // RED: invoke only called once today
    expect(invokeSpy).toHaveBeenCalledTimes(2);
    // Returns timeout error after retry exhaustion
    expect(response?.error?.code).toBe(-32001);
  });

  it("M32: retry does not happen more than once (no infinite loop)", async () => {
    const { handler, bridgeServer } = createHandler([IDEMPOTENT_TOOL]);
    const session = handler.createSession();

    const invokeSpy = vi.spyOn(bridgeServer, "invoke");
    // Always timeout
    invokeSpy.mockRejectedValue(
      Object.assign(new Error("Tool invocation timed out after 100ms"), { code: -32000 }),
    );

    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/foo.ts" },
    });
    await handler.handleRequest(req, session);

    // RED: called once today; after M32 should be exactly 2 (1 + 1 retry)
    expect(invokeSpy).toHaveBeenCalledTimes(2);
  });

  it("M32: audit log records both the original timeout and the retry result", async () => {
    vi.clearAllMocks();
    vi.mocked(auditLog.hashArgs).mockReturnValue("mock-hash-64chars-----------------------------------");

    const { handler, bridgeServer } = createHandlerWithAudit([IDEMPOTENT_TOOL]);
    const session = handler.createSession();

    const invokeSpy = vi.spyOn(bridgeServer, "invoke");
    // First: timeout. Second: success.
    invokeSpy
      .mockRejectedValueOnce(
        Object.assign(new Error("Tool invocation timed out after 100ms"), { code: -32000 }),
      )
      .mockResolvedValueOnce({
        type: "result",
        id: "retry-1",
        success: true,
        data: { opened: true },
      });

    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/foo.ts" },
    });
    await handler.handleRequest(req, session);

    // RED: only one writeAuditEntry call today (the timeout); after M32
    // there should be two: one for the timeout and one for the retry success.
    expect(auditLog.writeAuditEntry).toHaveBeenCalledTimes(2);
    expect(auditLog.writeAuditEntry).toHaveBeenCalledWith(
      "/tmp/test-audit.jsonl",
      expect.objectContaining({ result: "timeout" }),
    );
    expect(auditLog.writeAuditEntry).toHaveBeenCalledWith(
      "/tmp/test-audit.jsonl",
      expect.objectContaining({ result: "success" }),
    );
  });

  it("M32: retry succeeds → McpHandler returns the retry result (not an error)", async () => {
    const { handler, bridgeServer } = createHandler([IDEMPOTENT_TOOL]);
    const session = handler.createSession();

    vi.spyOn(bridgeServer, "invoke")
      .mockRejectedValueOnce(
        Object.assign(new Error("timed out"), { code: -32000 }),
      )
      .mockResolvedValueOnce({
        type: "result",
        id: "r2",
        success: true,
        data: { path: "/foo.ts" },
      });

    const req = makeRequest("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/foo.ts" },
    });
    const response = await handler.handleRequest(req, session);

    // RED: handler returns timeout error today, not the retry result
    expect(response?.error).toBeUndefined();
    const result = response?.result as { content: Array<{ text: string }> };
    expect(result?.content[0]?.text).toContain("/foo.ts");
  });
});

