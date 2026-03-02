/**
 * Hub MCP stdio Transport
 *
 * Reads newline-delimited JSON-RPC from stdin, writes responses to stdout.
 * No HTTP server. No authentication (process-level trust).
 * Logging goes to stderr only — stdout is reserved for protocol messages.
 *
 * Requirements: requirements-hub.md §2.2
 */

import type { Readable, Writable } from "node:stream";
import type { McpHandler } from "./mcp-handler.js";
import type { Session, JsonRpcRequest, JsonRpcResponse } from "./mcp-handler.js";

/**
 * Options for creating a StdioTransport.
 */
export interface StdioTransportOptions {
  /** The MCP handler to dispatch requests to */
  handler: McpHandler;
  /** Input stream. Default: process.stdin */
  input?: Readable;
  /** Output stream. Default: process.stdout */
  output?: Writable;
  /** Error/log stream. Default: process.stderr */
  logStream?: Writable;
}

/**
 * MCP stdio transport.
 *
 * Implements requirements-hub.md §2.2:
 * - Read newline-delimited JSON-RPC from stdin
 * - Write newline-delimited JSON-RPC to stdout
 * - Same MCP methods as Streamable HTTP
 * - No authentication (process-level trust)
 * - Log to stderr only (never pollute stdout)
 */
export class StdioTransport {
  private handler: McpHandler;
  private input: Readable;
  private output: Writable;
  private logStream: Writable;
  private session: Session;
  private running = false;
  private buffer = "";

  constructor(options: StdioTransportOptions) {
    this.handler = options.handler;
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.logStream = options.logStream ?? process.stderr;
    // Single session for stdio mode — one process = one client
    this.session = this.handler.createSession();
  }

  /**
   * Start listening on the input stream.
   * Reads newline-delimited JSON-RPC messages and dispatches them.
   *
   * @returns Promise that resolves when the input stream ends
   */
  async start(): Promise<void> {
    this.running = true;
    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (!settled) {
          settled = true;
          this.running = false;
          resolve();
        }
      };

      const processLine = (line: string): void => {
        let request: JsonRpcRequest;
        try {
          request = JSON.parse(line) as JsonRpcRequest;
        } catch {
          this.writeResponse({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          });
          return;
        }
        void this.handler
          .handleRequest(request, this.session)
          .then((response) => {
            this.writeResponse(response);
          });
      };

      this.input.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString();
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            processLine(trimmed);
          }
        }
      });

      this.input.once("end", settle);
      this.input.once("close", settle);
    });
  }

  /**
   * Stop the transport. Closes streams if needed.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.input.destroy();
  }

  /**
   * Check if the transport is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Write a JSON-RPC response to the output stream as a newline-delimited JSON line.
   * Notifications (null responses) are not written.
   *
   * @param response - The JSON-RPC response to send
   */
  writeResponse(response: JsonRpcResponse | null): void {
    if (response === null) return;
    this.output.write(JSON.stringify(response) + "\n");
  }

  /**
   * Log a message to the log stream (stderr).
   * Never writes to stdout — stdout is reserved for protocol.
   *
   * @param level - Log level
   * @param message - Message text
   */
  log(level: "debug" | "info" | "warn" | "error", message: string): void {
    this.logStream.write(`[${level}] ${message}\n`);
  }
}
