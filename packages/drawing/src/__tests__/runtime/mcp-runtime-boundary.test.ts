/**
 * Real MCP boundary proof for accordo-drawing.
 *
 * Executes real Hub server + WebSocket Bridge transport + MCP HTTP calls.
 * No mocked activate()/registerTools unit seam.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubServer } from "../../../../hub/src/server.js";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { IDEState, ToolRegistration } from "@accordo/bridge-types";
import type { DrawingPanelLike, DrawingToolContext } from "../../core/types.js";
import { createDrawingTools } from "../../tools/drawing-tools.js";
import { WsClient } from "../../../../bridge/src/ws-client.js";

const TOKEN = "drawing-e2e-token";
const SECRET = "drawing-e2e-secret";

class McpSession {
  private sessionId: string | null = null;

  constructor(private readonly baseUrl: string) {}

  async initialize(): Promise<void> {
    await this.call("initialize", {
      protocolVersion: ACCORDO_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "drawing-runtime-e2e", version: "0.0.1" },
    });
    await this.call("initialized", {}, null);
  }

  async call(method: string, params?: Record<string, unknown>, id: string | number | null = 1): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const response = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });

    const sid = response.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    const raw = await response.text();
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
  }
}

function extractToolData<T>(response: Record<string, unknown>): T {
  const result = response.result as { content?: Array<{ type: string; text?: string }> } | undefined;
  const text = result?.content?.[0]?.text;
  if (!text) throw new Error("Missing tools/call text payload");
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

describe("runtime/mcp-runtime-boundary", () => {
  let tempRoot: string;
  let server: HubServer;
  let baseUrl: string;
  let bridge: WsClient;
  let session: McpSession;
  let panelRegistry: Map<string, DrawingPanelLike>;

  beforeEach(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "drawing-runtime-e2e-"));
    panelRegistry = new Map<string, DrawingPanelLike>();
    server = new HubServer({
      port: 0,
      token: TOKEN,
      bridgeSecret: SECRET,
      insecureNoAuth: false,
      toolCallTimeout: 1200,
    });
    await server.start();
    const address = server.getAddress();
    if (!address) throw new Error("Hub server did not expose a bound address");
    const host = address.host === "::" ? "127.0.0.1" : address.host;
    baseUrl = `http://${host}:${address.port}`;

    const ctx: DrawingToolContext = {
      workspaceRoot: tempRoot,
      getPanel: (path: string) => panelRegistry.get(path),
    };
    const extensionTools = createDrawingTools(ctx);
    const toolRegistrations: ToolRegistration[] = extensionTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      dangerLevel: tool.dangerLevel,
      requiresConfirmation: tool.requiresConfirmation ?? false,
      idempotent: tool.idempotent ?? true,
    }));
    const handlers = new Map(
      extensionTools.map((tool) => [tool.name, async (args: Record<string, unknown>) => tool.handler(args)])
    );

    const connected = new Promise<void>((resolve) => {
      let resolved = false;
      bridge = new WsClient(address.port, SECRET, {
        onConnected: () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        },
        onDisconnected: () => {},
        onAuthFailure: () => {},
        onProtocolMismatch: () => {},
        onCancel: () => {},
        onGetState: () => {},
        onInvoke: (invoke) => {
          const handler = handlers.get(invoke.tool);
          if (!handler) {
            bridge.sendResult({ type: "result", id: invoke.id, success: false, error: `Tool not found: ${invoke.tool}` });
            return;
          }
          handler(invoke.args)
            .then((data) => bridge.sendResult({ type: "result", id: invoke.id, success: true, data }))
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              const code = (error as { code?: string })?.code;
              bridge.sendResult({ type: "result", id: invoke.id, success: false, error: code ? `${code}:${message}` : message });
            });
        },
      });
    });

    const state: IDEState = {
      openedFiles: [],
      activeFile: null,
      cursor: null,
      selection: null,
      diagnostics: [],
      terminals: [],
      activeTerminal: null,
      workspaceFolders: [tempRoot],
      gitBranch: null,
      gitChanges: 0,
      ui: {
        focusedPanel: "editor",
        visiblePanels: ["editor"],
      },
    } as IDEState;
    await bridge.connect(state, toolRegistrations);
    await connected;
    expect(server.getHealth().bridge).toBe("connected");

    session = new McpSession(baseUrl);
    await session.initialize();
  });

  afterEach(async () => {
    await bridge?.disconnect();
    await server?.stop();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("proves tools/list + create + merge + render across real MCP boundary", async () => {
    let tools: string[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      const list = await session.call("tools/list", {});
      tools = ((list.result as { tools?: Array<{ name: string }> })?.tools ?? []).map((tool) => tool.name);
      if (tools.some((name) => name.startsWith("accordo_drawing_"))) break;
      await sleep(25);
    }
    expect(tools.filter((name) => name.startsWith("accordo_drawing_"))).toEqual([
      "accordo_drawing_create",
      "accordo_drawing_merge",
      "accordo_drawing_query",
      "accordo_drawing_patch",
      "accordo_drawing_render",
    ]);

    const mmdPath = join(tempRoot, "runtime-proof.mmd");
    const create = await session.call("tools/call", {
      name: "accordo_drawing_create",
      arguments: { path: mmdPath, content: "flowchart TD\nA-->B\n" },
    });
    const createData = extractToolData<{ scenePath: string }>(create);
    expect(createData?.scenePath).toBeDefined();
    await expect(access(mmdPath)).resolves.toBeUndefined();
    await expect(access(createData!.scenePath)).resolves.toBeUndefined();

    const query = await session.call("tools/call", {
      name: "accordo_drawing_query",
      arguments: { path: mmdPath },
    });
    const queryData = extractToolData<{ status: string }>(query);
    expect(queryData?.status).toBe("needs-merge");

    const merge = await session.call("tools/call", {
      name: "accordo_drawing_merge",
      arguments: { path: mmdPath, content: "flowchart TD\nA-->B\nC-->D\n" },
    });
    const mergeData = extractToolData<{ placementEngine: string }>(merge);
    expect(mergeData?.placementEngine).toBe("bootstrap");

    const renderClosed = await session.call("tools/call", {
      name: "accordo_drawing_render",
      arguments: { path: mmdPath, format: "png" },
    });
    const renderClosedError = extractToolData<string>(renderClosed);
    expect(renderClosedError).toContain("panel-not-open");

    panelRegistry.set(mmdPath, {
      mmdPath,
      requestExport: async () => Buffer.from("runtime-export"),
    });

    const renderOpen = await session.call("tools/call", {
      name: "accordo_drawing_render",
      arguments: { path: mmdPath, format: "png" },
    });
    const renderOpenData = extractToolData<{ outputPath: string }>(renderOpen);
    expect(renderOpenData?.outputPath).toMatch(/\.png$/);
    const renderedOutput = await readFile(renderOpenData!.outputPath, "utf8");
    expect(renderedOutput).toBe("runtime-export");
  });
});
