/**
 * Transport layer — StubBridge and McpSession for E2E harness.
 * Shared by all vscode-command E2E test files.
 */

import WebSocket from "ws";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import type { ToolRegistration } from "@accordo/bridge-types";

export const E2E_SECRET = "e2e-gateway-secret";

export type InvokeFrame = { type: "invoke"; id: string; tool: string; args: Record<string, unknown> };

export class StubBridge {
  private ws: WebSocket | null = null;
  private invokeQueue: InvokeFrame[] = [];
  private _autoResponder: ((tool: string, args: Record<string, unknown>) => { success: boolean; data?: unknown; error?: string }) | null = null;
  private _onInvoke: (() => void) | null = null;

  async connect(baseUrl: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = baseUrl.replace("http://", "ws://") + "/bridge";
      const ws = new WebSocket(url, { headers: { "x-accordo-secret": E2E_SECRET } });
      ws.on("open", () => { this.ws = ws; resolve(); });
      ws.on("message", (data: Buffer) => {
        const frame = JSON.parse(data.toString()) as Record<string, unknown>;
        if (frame["type"] === "invoke") {
          const inv = frame as unknown as InvokeFrame;
          this.invokeQueue.push(inv);
          this._onInvoke?.();
          if (this._autoResponder) {
            const result = this._autoResponder(inv.tool, inv.args);
            this.send({ type: "result", id: inv.id, ...result });
          }
        }
      });
      ws.on("error", reject);
    });
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  registerTools(tools: ToolRegistration[]): void {
    this.send({ type: "toolRegistry", tools });
  }

  setAutoResponder(fn: (tool: string, args: Record<string, unknown>) => { success: boolean; data?: unknown; error?: string }): void {
    this._autoResponder = fn;
  }

  async waitForInvokes(n: number, ms = 500): Promise<InvokeFrame[]> {
    return new Promise<InvokeFrame[]>((resolve, reject) => {
      const check = () => { if (this.invokeQueue.length >= n) resolve(this.invokeQueue.slice(0, n)); };
      check();
      this._onInvoke = check;
      setTimeout(() => { this._onInvoke = null; reject(new Error(`timeout waiting for ${n} invokes`)); }, ms);
    });
  }

  clearInvokes(): void { this.invokeQueue = []; }
  disconnect(): void { this.ws?.close(); this.ws = null; }
}

export class McpSession {
  sessionId: string | null = null;
  constructor(private baseUrl: string, private token: string) {}

  async call(method: string, params?: Record<string, unknown>, id: string | number | null = 1) {
    const hdrs: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` };
    if (this.sessionId) hdrs["Mcp-Session-Id"] = this.sessionId;
    const res = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const retSession = res.headers.get("mcp-session-id");
    if (retSession) this.sessionId = retSession;
    let body: Record<string, unknown> | null = null;
    const text = await res.text();
    if (text) { try { body = JSON.parse(text); } catch { /* ok */ } }
    return { status: res.status, body };
  }

  async initialize(): Promise<void> {
    await this.call("initialize", { protocolVersion: ACCORDO_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "vcg-e2e", version: "0.0.1" } });
    await this.call("initialized", {}, null);
  }
}
