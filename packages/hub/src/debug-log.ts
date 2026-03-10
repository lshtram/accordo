/**
 * MCP Debug Logger
 *
 * Records every detail of the communication between AI agents (Copilot,
 * OpenCode, etc.) and the Hub's MCP endpoint.
 *
 * What is captured:
 *   - Raw HTTP layer: method, URL, remote IP, all relevant headers (esp.
 *     User-Agent so we can identify which agent connected)
 *   - Every JSON-RPC request received: method + params (tools/call args are
 *     preserved in full)
 *   - Every JSON-RPC response sent: result or error, duration in ms
 *   - Session lifecycle: create / expire
 *   - SSE connections: connect / disconnect
 *   - tools/list detail: exactly how many tools were returned and their names
 *   - initialize detail: the full tool list embedded in the `instructions`
 *     field so we can confirm what the agent's system prompt contained
 *
 * Output format: JSONL (one JSON object per line) → easy to grep / stream.
 * File: ~/.accordo/mcp-debug.jsonl  (override with ACCORDO_DEBUG_LOG env var
 *       or the debugLogFile constructor option)
 *
 * Console output:  every entry is ALSO written to stderr so it appears in
 *                  the server terminal in real time.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Entry types ────────────────────────────────────────────────────────────

export type DebugEntryKind =
  | "http_request"      // raw HTTP request arrived at /mcp
  | "session_created"   // new MCP session
  | "session_expired"   // session cleaned up
  | "rpc_received"      // JSON-RPC method received from agent
  | "rpc_responded"     // JSON-RPC response sent back to agent
  | "tools_list_sent"   // detail: tools/list payload
  | "initialize_sent"   // detail: initialize result (proto version, instructions)
  | "sse_connect"        // agent opened GET /mcp SSE stream
  | "sse_disconnect"     // SSE stream closed
  | "sse_notification"  // notification pushed to SSE clients
  | "error";            // unexpected error in logging path

export interface DebugEntry {
  /** ISO-8601 timestamp */
  ts: string;
  kind: DebugEntryKind;
  /** MCP session identifier (present on session/rpc entries) */
  sessionId?: string;
  /** SSE connection identifier */
  connId?: string;
  /** Detected agent (from User-Agent header) */
  agent?: string;
  /** Remote IP address */
  remoteIp?: string;
  /** HTTP method (GET/POST) */
  httpMethod?: string;
  /** URL path */
  url?: string;
  /** Relevant request headers */
  headers?: Record<string, string>;
  /** JSON-RPC method name */
  rpcMethod?: string;
  /** JSON-RPC params (full) */
  rpcParams?: unknown;
  /** JSON-RPC result (full) */
  rpcResult?: unknown;
  /** JSON-RPC error */
  rpcError?: { code: number; message: string; data?: unknown };
  /** Duration of the RPC call in milliseconds */
  durationMs?: number;
  /** Tool names returned in tools/list */
  toolNames?: string[];
  /** Number of tools returned */
  toolCount?: number;
  /** MCP protocol version from initialize response */
  protocolVersion?: string;
  /** Whether the initialize response included an instructions field */
  instructionsIncluded?: boolean;
  /** Number of tools listed in the instructions field */
  instructionsToolCount?: number;
  /** Preview of the instructions text (first 500 chars) */
  instructionsPreview?: string;
  /** Free-form message for errors / notes */
  message?: string;
}

// ─── Logger ─────────────────────────────────────────────────────────────────

export class McpDebugLogger {
  private logFile: string;
  private enabled: boolean;

  constructor(logFile?: string) {
    this.logFile = logFile ?? McpDebugLogger.defaultPath();
    this.enabled = true;

    // Ensure the directory exists
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      // Write session separator so it's easy to find where current run starts
      const sep: DebugEntry = {
        ts: new Date().toISOString(),
        kind: "error", // reused as a structural marker; kind is overridden below
        message: `═══ Accordo Hub debug session started ═ log: ${this.logFile} ═══`,
      };
      // Write a visible banner line directly (not as JSON so grep is easy)
      fs.appendFileSync(
        this.logFile,
        `\n${sep.ts}  ▶ Accordo Hub debug session started ────────────────────────────────\n`,
      );
    } catch (e) {
      // If we can't create the log dir/file, disable file logging gracefully
      this.enabled = false;
      console.error(`[accordo-debug] Cannot open debug log at ${this.logFile}:`, e);
    }
  }

  static defaultPath(): string {
    return (
      process.env["ACCORDO_DEBUG_LOG"] ??
      path.join(os.homedir(), ".accordo", "mcp-debug.jsonl")
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Log a raw HTTP request arriving at the MCP endpoint. */
  logHttpRequest(opts: {
    httpMethod: string;
    url: string;
    remoteIp: string | undefined;
    headers: Record<string, string | string[] | undefined>;
    body?: string;
    sessionId?: string;
  }): void {
    const interesting = this.pickHeaders(opts.headers);
    const agent = this.detectAgent(interesting["user-agent"]);
    this.write({
      kind: "http_request",
      sessionId: opts.sessionId,
      agent,
      remoteIp: opts.remoteIp,
      httpMethod: opts.httpMethod,
      url: opts.url,
      headers: interesting,
      // Include body for POST so we see the raw JSON-RPC
      ...(opts.body !== undefined ? { rpcParams: this.tryParseBody(opts.body) } : {}),
    });
  }

  /** Log a newly created MCP session. */
  logSessionCreated(sessionId: string, agentHint?: string): void {
    this.write({ kind: "session_created", sessionId, agent: agentHint });
  }

  /** Log an expired / removed session. */
  logSessionExpired(sessionId: string): void {
    this.write({ kind: "session_expired", sessionId });
  }

  /** Log a JSON-RPC method received from the agent. */
  logRpcReceived(opts: {
    sessionId: string;
    rpcMethod: string;
    rpcParams?: unknown;
    agent?: string;
  }): void {
    this.write({
      kind: "rpc_received",
      sessionId: opts.sessionId,
      rpcMethod: opts.rpcMethod,
      // For tools/call log full params (tool name + arguments) — critical for debugging
      rpcParams: opts.rpcParams,
      agent: opts.agent,
    });
  }

  /** Log the JSON-RPC response that was sent back. */
  logRpcResponded(opts: {
    sessionId: string;
    rpcMethod: string;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
    durationMs: number;
  }): void {
    this.write({
      kind: "rpc_responded",
      sessionId: opts.sessionId,
      rpcMethod: opts.rpcMethod,
      rpcResult: opts.result,
      rpcError: opts.error,
      durationMs: opts.durationMs,
    });
  }

  /** Detailed log for tools/list responses — records exact tool names. */
  logToolsListSent(opts: { sessionId: string; tools: Array<{ name: string }> }): void {
    const names = opts.tools.map((t) => t.name);
    this.write({
      kind: "tools_list_sent",
      sessionId: opts.sessionId,
      toolNames: names,
      toolCount: names.length,
    });
  }

  /** Detailed log for initialize responses. */
  logInitializeSent(opts: {
    sessionId: string;
    protocolVersion: string;
    instructions?: string;
    capabilities?: unknown;
  }): void {
    const instructions = opts.instructions ?? "";
    // Extract tool count from the instructions text (lines starting with "  - ")
    const toolLines = instructions.split("\n").filter((l) => l.startsWith("  - "));
    this.write({
      kind: "initialize_sent",
      sessionId: opts.sessionId,
      protocolVersion: opts.protocolVersion,
      instructionsIncluded: instructions.length > 0,
      instructionsToolCount: toolLines.length,
      instructionsPreview: instructions.slice(0, 500),
    });
  }

  /** Log an SSE client connecting. */
  logSseConnect(connId: string, agentHint?: string): void {
    this.write({ kind: "sse_connect", connId, agent: agentHint });
  }

  /** Log an SSE client disconnecting. */
  logSseDisconnect(connId: string): void {
    this.write({ kind: "sse_disconnect", connId });
  }

  /** Log a notification pushed over SSE. */
  logSseNotification(method: string, connCount: number): void {
    this.write({ kind: "sse_notification", rpcMethod: method, message: `pushed to ${connCount} SSE client(s)` });
  }

  /** Log a generic error message. */
  logError(message: string): void {
    this.write({ kind: "error", message });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private write(fields: Omit<DebugEntry, "ts">): void {
    const entry: DebugEntry = { ts: new Date().toISOString(), ...fields };
    const line = JSON.stringify(entry);

    if (!this.enabled) return;
    try {
      fs.appendFileSync(this.logFile, line + "\n");
    } catch {
      // Swallow — don't let logging break the server
    }
  }

  /** Pick the most useful request headers and flatten multi-value ones. */
  private pickHeaders(
    raw: Record<string, string | string[] | undefined>,
  ): Record<string, string> {
    const keys = [
      "user-agent",
      "content-type",
      "accept",
      "authorization",      // ← redacted below
      "mcp-session-id",
      "origin",
      "host",
      "x-forwarded-for",
    ];
    const out: Record<string, string> = {};
    for (const k of keys) {
      const v = raw[k];
      if (v === undefined) continue;
      const str = Array.isArray(v) ? v.join(", ") : v;
      // Redact the actual token while still showing it's present
      out[k] = k === "authorization" ? this.redactBearer(str) : str;
    }
    return out;
  }

  /** Show "Bearer <first8chars>…" instead of the full token. */
  private redactBearer(header: string): string {
    return header.replace(
      /^(Bearer\s+)(.{8})(.*)$/i,
      (_, prefix: string, first: string, _rest: string) =>
        `${prefix}${first}…[redacted]`,
    );
  }

  /** Map User-Agent strings to friendly agent names. */
  private detectAgent(ua?: string): string | undefined {
    if (!ua) return undefined;
    const lower = ua.toLowerCase();
    if (lower.includes("github-copilot")) return "copilot";
    if (lower.includes("opencode")) return "opencode";
    if (lower.includes("claude")) return "claude";
    if (lower.includes("cursor")) return "cursor";
    if (lower.includes("vscode")) return "vscode";
    if (lower.includes("python-httpx") || lower.includes("python-requests")) return "python-client";
    if (lower.includes("node")) return "node-client";
    return ua.slice(0, 60);
  }

  /** Try to JSON-parse the request body; return raw string on failure. */
  private tryParseBody(body: string): unknown {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }

  /** Return the path where debug entries are written. */
  getLogFile(): string {
    return this.logFile;
  }
}
