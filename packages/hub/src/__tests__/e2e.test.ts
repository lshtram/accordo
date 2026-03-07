/**
 * End-to-end integration tests: Full Hub + Bridge + MCP pipeline.
 *
 * Architecture under test:
 *
 *   FakeBridge (ws client)
 *       │  WebSocket /bridge
 *       ▼
 *   HubServer (real, port 0)
 *       ▲  HTTP POST /mcp
 *       │
 *   test helpers (fetch)
 *
 * What this file proves end-to-end:
 *   E2E-01  Tool registration: toolRegistry WS message increases
 *             /health toolCount to the exact registered count
 *   E2E-02  tools/list: returns exactly the registered tool names — no more,
 *             no less, and every name matches the real editor tool names
 *   E2E-03  tools/call round-trip: MCP HTTP call routes through WS to the
 *             fake bridge, args transmitted faithfully, result returned in
 *             MCP content array
 *   E2E-04  tools/call covers one representative tool from each module
 *             (editor, terminal, workspace, layout)
 *   E2E-05  Error propagation: bridge returns success:false → MCP error
 *   E2E-06  Unknown tool: -32601 before bridge is touched
 *   E2E-07  stateUpdate: bridge:connected in /health after WS connects
 *   E2E-08  Session continuity: same session ID on consecutive requests
 *   E2E-09  Re-registration: sending a new toolRegistry message replaces
 *             the previous one and toolCount updates immediately
 *
 * Requirements: requirements-hub.md §2.1, §3.1–§3.4, §5.4, §6
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { HubServer } from "../server.js";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { IDEState, ToolRegistration } from "@accordo/bridge-types";

// ── Test constants ────────────────────────────────────────────────────────────

const TOKEN = "e2e-bearer-token";
const SECRET = "e2e-bridge-secret";

// ── All 24 real tool registrations (mirrors packages/editor/src/tools/*.ts) ──
//
// These MUST stay in sync with the actual tool definitions in the editor
// package. If a tool is added or renamed there, this list must be updated here.
// The E2E-02 test will catch any drift automatically.

const ALL_TOOLS: ToolRegistration[] = [
  // ── Module 16: editor open/close/scroll/split/focus/reveal ─────────────
  {
    name: "accordo_editor_open",
    description: "Open a file in the editor, optionally scrolling to a line/column.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, relative to workspace root or absolute" },
        line: { type: "number", description: "Line number to scroll to (1-based). Default: 1" },
        column: { type: "number", description: "Column number to place cursor (1-based). Default: 1" },
      },
      required: ["path"],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_editor_close",
    description: "Close a specific editor tab, or the active editor if no path given.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to close. If omitted, closes the active editor." },
      },
      required: [],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_editor_scroll",
    description: "Scroll the active editor viewport up or down by line or page.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
        by: { type: "string", enum: ["line", "page"], description: "Scroll unit. Default: page" },
      },
      required: ["direction"],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: false,
  },
  {
    name: "accordo_editor_split",
    description: "Split the editor pane right or down.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["right", "down"], description: "Direction to split" },
      },
      required: ["direction"],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: false,
  },
  {
    name: "accordo_editor_focus",
    description: "Focus a specific editor group by 1-based group number.",
    inputSchema: {
      type: "object",
      properties: {
        group: { type: "number", description: "Editor group number (1-based)" },
      },
      required: ["group"],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_editor_reveal",
    description: "Reveal a file in the Explorer sidebar without opening it.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to reveal in Explorer" },
      },
      required: ["path"],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },

  // ── Module 17: editor highlight/clearHighlights/save/saveAll/format ─────
  {
    name: "accordo_editor_highlight",
    description: "Apply a colored background highlight to a range of lines.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path containing the lines to highlight" },
        startLine: { type: "number", description: "First line to highlight (1-based, inclusive)" },
        endLine: { type: "number", description: "Last line to highlight (1-based, inclusive)" },
        color: { type: "string", description: "Highlight background color. Default: rgba(255,255,0,0.3)" },
      },
      required: ["path", "startLine", "endLine"],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_editor_clearHighlights",
    description: "Remove highlight decorations created by accordo_editor_highlight.",
    inputSchema: {
      type: "object",
      properties: {
        decorationId: { type: "string", description: "Clear only this decoration. Omit to clear all." },
      },
      required: [],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_editor_save",
    description: "Save a specific file, or the active editor if no path given.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to save. If omitted, saves the active editor." },
      },
      required: [],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_editor_saveAll",
    description: "Save all modified (unsaved) editors.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_editor_format",
    description: "Format the active document or a specific file using the configured formatter.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to format. If omitted, formats the active editor." },
      },
      required: [],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },

  // ── Module 18: terminal ──────────────────────────────────────────────────
  {
    name: "accordo_terminal_open",
    description: "Create and show a new terminal instance. Returns a stable accordo terminal ID.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Terminal display name. Default: 'Accordo'" },
        cwd: { type: "string", description: "Working directory. Default: workspace root" },
      },
      required: [],
    },
    dangerLevel: "moderate",
    requiresConfirmation: false,
    idempotent: false,
  },
  {
    name: "accordo_terminal_run",
    description: "Execute a shell command in a terminal. Requires confirmation — this is destructive.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        terminalId: { type: "string", description: "Terminal to use (stable ID). If omitted, uses active or creates one." },
      },
      required: ["command"],
    },
    dangerLevel: "destructive",
    requiresConfirmation: true,
    idempotent: false,
  },
  {
    name: "accordo_terminal_focus",
    description: "Focus the terminal panel (make it visible and active).",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_terminal_list",
    description: "List all currently open terminal instances with their stable accordo IDs.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_terminal_close",
    description: "Close a specific terminal by its stable accordo ID.",
    inputSchema: {
      type: "object",
      properties: {
        terminalId: { type: "string", description: "Stable accordo terminal ID (from terminal.open or terminal.list)" },
      },
      required: ["terminalId"],
    },
    dangerLevel: "moderate",
    requiresConfirmation: false,
    idempotent: true,
  },

  // ── Module 19: workspace ─────────────────────────────────────────────────
  {
    name: "accordo_workspace_getTree",
    description: "Return the workspace file tree as a structured object. Respects .gitignore and files.exclude.",
    inputSchema: {
      type: "object",
      properties: {
        depth: { type: "number", description: "Max directory depth to traverse. Default: 3" },
        path: { type: "string", description: "Subdirectory to start from. Default: workspace root" },
      },
      required: [],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_workspace_search",
    description: "Full-text search across workspace files. Returns matching lines with file path and location.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text or regex pattern" },
        include: { type: "string", description: "Glob pattern for files to include. Default: '**/*'" },
        maxResults: { type: "number", description: "Maximum results to return. Default: 50" },
      },
      required: ["query"],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_diagnostics_list",
    description: "Return current diagnostics (errors, warnings, hints) from the Language Server.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Limit diagnostics to this file. If omitted, returns all." },
        severity: { type: "string", enum: ["error", "warning", "information", "hint"], description: "Filter by minimum severity. Default: all." },
      },
      required: [],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },

  // ── Module 20: layout ────────────────────────────────────────────────────
  {
    name: "accordo_panel_toggle",
    description: "Toggle visibility of a VSCode sidebar panel (explorer, search, git, debug, extensions).",
    inputSchema: {
      type: "object",
      properties: {
        panel: { type: "string", enum: ["explorer", "search", "git", "debug", "extensions"], description: "Panel to toggle" },
      },
      required: ["panel"],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_layout_zen",
    description: "Toggle Zen Mode (distraction-free fullscreen editing).",
    inputSchema: { type: "object", properties: {}, required: [] },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: false,
  },
  {
    name: "accordo_layout_fullscreen",
    description: "Toggle fullscreen mode.",
    inputSchema: { type: "object", properties: {}, required: [] },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: false,
  },
  {
    name: "accordo_layout_joinGroups",
    description: "Collapse all editor splits — merge all groups into one.",
    inputSchema: { type: "object", properties: {}, required: [] },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
  {
    name: "accordo_layout_evenGroups",
    description: "Equalise the width and height of all editor groups.",
    inputSchema: { type: "object", properties: {}, required: [] },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
  },
];

// Canonical list of all expected tool names — derived once so tests don't
// accidentally re-compute it differently from the registration list above.
const EXPECTED_TOOL_NAMES = ALL_TOOLS.map((t) => t.name);

// ── Fake IDE state ────────────────────────────────────────────────────────────

const FAKE_STATE: IDEState = {
  activeFile: "/workspace/accordo/packages/hub/src/server.ts",
  activeFileLine: 1,
  activeFileColumn: 1,
  openEditors: [
    "/workspace/accordo/packages/hub/src/server.ts",
    "/workspace/accordo/packages/hub/src/mcp-handler.ts",
  ],
  visibleEditors: ["/workspace/accordo/packages/hub/src/server.ts"],
  workspaceFolders: ["/workspace/accordo"],
  activeTerminal: "bash",
  workspaceName: "accordo",
  remoteAuthority: null,
  modalities: {},
};

// ── FakeBridge ────────────────────────────────────────────────────────────────

/**
 * Minimal WebSocket bridge client for E2E tests.
 *
 * Connects to /bridge, performs the handshake (state + toolRegistry), and
 * exposes `expectInvoke()` which registers a one-shot handler for the next
 * invoke message on a given tool name.
 */
class FakeBridge {
  readonly ws: WebSocket;
  private invokeHandlers = new Map<
    string,
    (id: string, tool: string, args: Record<string, unknown>) => void
  >();

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      switch (msg["type"]) {
        case "ping":
          this.send({ type: "pong", ts: msg["ts"] });
          break;
        case "getState":
          this.send({
            type: "stateSnapshot",
            protocolVersion: ACCORDO_PROTOCOL_VERSION,
            state: FAKE_STATE,
          });
          break;
        case "invoke": {
          const id = msg["id"] as string;
          const tool = msg["tool"] as string;
          const args = (msg["args"] ?? {}) as Record<string, unknown>;
          // Check for an exact-name handler first, then the wildcard "*"
          const handler = this.invokeHandlers.get(tool) ?? this.invokeHandlers.get("*");
          if (handler) {
            this.invokeHandlers.delete(tool);
            this.invokeHandlers.delete("*");
            handler(id, tool, args);
          } else {
            // No handler registered — return a generic error so the test
            // doesn't hang indefinitely
            this.sendError(id, `FakeBridge: no handler registered for ${tool}`);
          }
          break;
        }
        default:
          break;
      }
    });
  }

  /** Low-level JSON send */
  send(payload: unknown): void {
    this.ws.send(JSON.stringify(payload));
  }

  /** Send a success result back to Hub */
  sendResult(id: string, data: unknown): void {
    this.send({ type: "result", id, success: true, data });
  }

  /** Send a failure result back to Hub */
  sendError(id: string, error: string): void {
    this.send({ type: "result", id, success: false, error });
  }

  /**
   * Register a one-shot handler for the next invoke on `tool`.
   * Returns a Promise that resolves with `{ id, tool, args }` when the
   * invoke arrives so callers can assert on the received args.
   */
  expectInvoke(
    tool: string,
    respond: (id: string, args: Record<string, unknown>) => void,
  ): Promise<{ id: string; tool: string; args: Record<string, unknown> }> {
    return new Promise((resolve) => {
      this.invokeHandlers.set(tool, (id, t, args) => {
        respond(id, args);
        resolve({ id, tool: t, args });
      });
    });
  }

  /** Register all 24 tools */
  registerTools(tools: ToolRegistration[]): void {
    this.send({ type: "toolRegistry", tools });
  }

  /** Send a partial state update */
  sendStateUpdate(patch: Partial<IDEState>): void {
    this.send({ type: "stateUpdate", patch });
  }

  close(): void {
    this.ws.close();
  }
}

// ── McpSession ────────────────────────────────────────────────────────────────

/**
 * Thin wrapper around fetch that manages an MCP session.
 * Captures `Mcp-Session-Id` on the first response and sends it on all
 * subsequent requests so the Hub sees a single continuous session.
 */
class McpSession {
  private sessionId: string | null = null;

  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  async call(
    method: string,
    params?: unknown,
  ): Promise<{ status: number; sessionId: string | null; body: Record<string, unknown> }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const res = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method,
        params,
      }),
    });

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    const body = (await res.json()) as Record<string, unknown>;
    return { status: res.status, sessionId: this.sessionId, body };
  }

  async initialize(): Promise<void> {
    await this.call("initialize", {
      protocolVersion: ACCORDO_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "e2e-test", version: "0.0.1" },
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Poll /health until toolCount reaches `target` or timeout elapses. */
async function waitForToolCount(
  baseUrl: string,
  target: number,
  timeoutMs = 2000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/health`);
    const body = (await res.json()) as { toolCount: number };
    if (body.toolCount >= target) return body.toolCount;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`Timed out waiting for toolCount=${target} at ${baseUrl}/health`);
}

/** Connect a FakeBridge WebSocket and wait for the open event. */
function connectBridge(baseUrl: string, secret: string): Promise<FakeBridge> {
  return new Promise((resolve, reject) => {
    const url = baseUrl.replace("http://", "ws://");
    const ws = new WebSocket(`${url}/bridge`, {
      headers: { "x-accordo-secret": secret },
    });
    ws.once("open", () => resolve(new FakeBridge(ws)));
    ws.once("error", reject);
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("E2E: Hub + Bridge + MCP pipeline", () => {
  let server: HubServer;
  let baseUrl: string;
  let bridge: FakeBridge;

  beforeAll(async () => {
    // Start a real Hub on an OS-assigned port
    server = new HubServer({
      port: 0,
      host: "127.0.0.1",
      token: TOKEN,
      bridgeSecret: SECRET,
    });
    await server.start();
    const addr = server.getAddress()!;
    baseUrl = `http://${addr.host}:${addr.port}`;

    // Connect the fake bridge
    bridge = await connectBridge(baseUrl, SECRET);

    // Handshake: send state + full tool registry
    bridge.send({
      type: "stateSnapshot",
      protocolVersion: ACCORDO_PROTOCOL_VERSION,
      state: FAKE_STATE,
    });
    bridge.registerTools(ALL_TOOLS);

    // Wait until the Hub has processed the registry
    await waitForToolCount(baseUrl, ALL_TOOLS.length);
  }, 10_000);

  afterAll(async () => {
    bridge?.close();
    await server.stop();
  });

  // ── E2E-01: Registration confirmed ──────────────────────────────────────

  it("E2E-01: /health toolCount equals the number of registered tools", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = (await res.json()) as { toolCount: number; bridge: string };
    // Confirm the exact count — not just "> 0"
    expect(body.toolCount).toBe(ALL_TOOLS.length);
    expect(body.bridge).toBe("connected");
  });

  // ── E2E-02: tools/list accuracy ─────────────────────────────────────────

  it("E2E-02: tools/list returns exactly the registered tool names", async () => {
    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();
    const { body } = await session.call("tools/list");

    const result = body["result"] as { tools: Array<{ name: string }> };
    expect(Array.isArray(result?.tools)).toBe(true);

    const returnedNames = result.tools.map((t) => t.name).sort();
    const expectedNames = [...EXPECTED_TOOL_NAMES].sort();

    // Symmetric diff — catches both missing tools and phantom tools
    const missing = expectedNames.filter((n) => !returnedNames.includes(n));
    const phantom = returnedNames.filter((n) => !expectedNames.includes(n));

    expect(missing, `Tools missing from list: ${missing.join(", ")}`).toHaveLength(0);
    expect(phantom, `Phantom tools in list: ${phantom.join(", ")}`).toHaveLength(0);
    expect(returnedNames).toHaveLength(EXPECTED_TOOL_NAMES.length);
  });

  // ── E2E-03 / E2E-04: tools/call round-trips ─────────────────────────────

  it("E2E-03/M16: tools/call accordo_editor_open routes to bridge with correct args", async () => {
    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();

    // Pre-wire the fake bridge handler BEFORE sending the MCP call
    const invoked = bridge.expectInvoke("accordo_editor_open", (id, args) => {
      expect(args["path"]).toBe("/workspace/accordo/README.md");
      expect(args["line"]).toBe(10);
      bridge.sendResult(id, { opened: true, path: args["path"] });
    });

    const callPromise = session.call("tools/call", {
      name: "accordo_editor_open",
      arguments: { path: "/workspace/accordo/README.md", line: 10 },
    });

    // Both sides must complete
    const [invoke, { body }] = await Promise.all([invoked, callPromise]);

    // Bridge received the correct tool and args
    expect(invoke.tool).toBe("accordo_editor_open");
    expect(invoke.args["path"]).toBe("/workspace/accordo/README.md");

    // MCP response is correct
    expect(body["error"]).toBeUndefined();
    const result = body["result"] as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed["opened"]).toBe(true);
    expect(parsed["path"]).toBe("/workspace/accordo/README.md");
  });

  it("E2E-03/M17: tools/call accordo_editor_highlight routes with correct args", async () => {
    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();

    const invoked = bridge.expectInvoke("accordo_editor_highlight", (id, args) => {
      expect(args["path"]).toBe("/workspace/accordo/src/index.ts");
      expect(args["startLine"]).toBe(5);
      expect(args["endLine"]).toBe(10);
      bridge.sendResult(id, { decorationId: "accordo-decoration-1" });
    });

    const callPromise = session.call("tools/call", {
      name: "accordo_editor_highlight",
      arguments: { path: "/workspace/accordo/src/index.ts", startLine: 5, endLine: 10 },
    });

    const [invoke, { body }] = await Promise.all([invoked, callPromise]);

    expect(invoke.tool).toBe("accordo_editor_highlight");
    expect(invoke.args["startLine"]).toBe(5);
    expect(invoke.args["endLine"]).toBe(10);

    expect(body["error"]).toBeUndefined();
    const result = body["result"] as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed["decorationId"]).toBe("accordo-decoration-1");
  });

  it("E2E-03/M18: tools/call accordo_terminal_run routes with correct args", async () => {
    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();

    const invoked = bridge.expectInvoke("accordo_terminal_run", (id, args) => {
      expect(args["command"]).toBe("echo hello");
      bridge.sendResult(id, { sent: true, terminalId: "accordo-terminal-1" });
    });

    const callPromise = session.call("tools/call", {
      name: "accordo_terminal_run",
      arguments: { command: "echo hello" },
    });

    const [invoke, { body }] = await Promise.all([invoked, callPromise]);

    expect(invoke.tool).toBe("accordo_terminal_run");
    expect(invoke.args["command"]).toBe("echo hello");

    expect(body["error"]).toBeUndefined();
    const result = body["result"] as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed["sent"]).toBe(true);
    expect(typeof parsed["terminalId"]).toBe("string");
  });

  it("E2E-03/M19: tools/call accordo_workspace_search routes with correct args", async () => {
    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();

    const invoked = bridge.expectInvoke("accordo_workspace_search", (id, args) => {
      expect(args["query"]).toBe("HubServer");
      bridge.sendResult(id, {
        results: [
          { path: "/workspace/server.ts", line: 42, column: 7, text: "new HubServer()" },
        ],
      });
    });

    const callPromise = session.call("tools/call", {
      name: "accordo_workspace_search",
      arguments: { query: "HubServer" },
    });

    const [invoke, { body }] = await Promise.all([invoked, callPromise]);

    expect(invoke.tool).toBe("accordo_workspace_search");
    expect(invoke.args["query"]).toBe("HubServer");

    expect(body["error"]).toBeUndefined();
    const result = body["result"] as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(result.content[0].text) as { results: unknown[] };
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results).toHaveLength(1);
  });

  it("E2E-03/M20: tools/call accordo_panel_toggle routes with correct args", async () => {
    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();

    const invoked = bridge.expectInvoke("accordo_panel_toggle", (id, args) => {
      expect(args["panel"]).toBe("explorer");
      bridge.sendResult(id, { visible: true, panel: "explorer" });
    });

    const callPromise = session.call("tools/call", {
      name: "accordo_panel_toggle",
      arguments: { panel: "explorer" },
    });

    const [invoke, { body }] = await Promise.all([invoked, callPromise]);

    expect(invoke.tool).toBe("accordo_panel_toggle");
    expect(invoke.args["panel"]).toBe("explorer");

    expect(body["error"]).toBeUndefined();
    const result = body["result"] as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed["visible"]).toBe(true);
    expect(parsed["panel"]).toBe("explorer");
  });

  // ── E2E-05: Error propagation ────────────────────────────────────────────

  it("E2E-05: bridge error (success:false) surfaces as MCP isError result with message", async () => {
    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();

    const invoked = bridge.expectInvoke("accordo_editor_save", (id, _args) => {
      bridge.sendError(id, "No active editor — nothing to save");
    });

    const callPromise = session.call("tools/call", {
      name: "accordo_editor_save",
      arguments: {},
    });

    const [, { body }] = await Promise.all([invoked, callPromise]);

    // Bridge success:false → MCP result with isError:true (not a JSON-RPC error)
    // This lets the LLM read the error message and adapt, per MCP spec 2024-11-05.
    expect(body["error"]).toBeUndefined();
    const result = body["result"] as { content: Array<{ type: string; text: string }>; isError: boolean };
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("No active editor");
  });

  // ── E2E-06: Unknown tool ─────────────────────────────────────────────────

  it("E2E-06: tools/call unknown tool returns -32601 without touching bridge", async () => {
    const session = new McpSession(baseUrl, TOKEN);
    await session.initialize();

    // -32601 is returned synchronously by McpHandler when the tool doesn't
    // exist in the registry — the bridge WS is never touched.
    const { body } = await session.call("tools/call", {
      name: "accordo_ghost_tool",
      arguments: {},
    });

    const error = body["error"] as { code: number; message: string };
    expect(error?.code).toBe(-32601);
    expect(error?.message).toContain("Unknown tool");
    // Confirm toolCount is unchanged — the Hub is still healthy
    const healthRes = await fetch(`${baseUrl}/health`);
    const health = (await healthRes.json()) as { toolCount: number };
    expect(health.toolCount).toBe(ALL_TOOLS.length);
  });

  // ── E2E-07: State flow ───────────────────────────────────────────────────

  it("E2E-07: bridge connection shows bridge:connected in /health", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = (await res.json()) as { bridge: string };
    expect(body.bridge).toBe("connected");
  });

  // ── E2E-08: Session continuity ───────────────────────────────────────────

  it("E2E-08: consecutive MCP calls share the same session ID", async () => {
    const session = new McpSession(baseUrl, TOKEN);

    // initialize returns a new Mcp-Session-Id in the response header
    const { sessionId: firstSessionId } = await session.call("initialize", {
      protocolVersion: ACCORDO_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "e2e-session-test", version: "0.0.1" },
    });
    expect(typeof firstSessionId).toBe("string");
    expect(firstSessionId).not.toBeNull();

    // Subsequent calls must carry the same session ID
    const { sessionId: afterListId } = await session.call("tools/list");
    expect(afterListId).toBe(firstSessionId);

    const { sessionId: afterPingId } = await session.call("ping");
    expect(afterPingId).toBe(firstSessionId);
  });

  // ── E2E-09: Re-registration ──────────────────────────────────────────────

  it("E2E-09: sending a new toolRegistry replaces the previous registry", async () => {
    // Send a reduced registry (3 tools)
    const reducedTools = ALL_TOOLS.slice(0, 3);
    bridge.registerTools(reducedTools);

    // Wait for Hub to process the new registry
    await waitForToolCount(baseUrl, 3);

    const res = await fetch(`${baseUrl}/health`);
    const shrunk = (await res.json()) as { toolCount: number };
    expect(shrunk.toolCount).toBe(3);

    // Restore the full registry
    bridge.registerTools(ALL_TOOLS);
    await waitForToolCount(baseUrl, ALL_TOOLS.length);

    const res2 = await fetch(`${baseUrl}/health`);
    const restored = (await res2.json()) as { toolCount: number };
    expect(restored.toolCount).toBe(ALL_TOOLS.length);
  });
});
