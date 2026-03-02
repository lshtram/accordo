/**
 * Tests for stdio-transport.ts
 * Requirements: requirements-hub.md §2.2
 *
 * API checklist:
 * ✓ start() — 3 tests
 * ✓ stop() — 2 tests
 * ✓ isRunning() — 2 tests
 * ✓ writeResponse() — 4 tests
 * ✓ log() — 3 tests
 * ✓ end-to-end: reads JSON-RPC, dispatches, writes — 4 tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PassThrough } from "node:stream";
import { StdioTransport } from "../stdio-transport.js";
import { McpHandler } from "../mcp-handler.js";
import { ToolRegistry } from "../tool-registry.js";
import { BridgeServer } from "../bridge-server.js";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMcpHandler(): McpHandler {
  return new McpHandler({
    toolRegistry: new ToolRegistry(),
    bridgeServer: new BridgeServer({ secret: "s", maxConcurrent: 16, maxQueueDepth: 64 }),
  });
}

function createTransport(opts?: {
  handler?: McpHandler;
}): {
  transport: StdioTransport;
  input: PassThrough;
  output: PassThrough;
  log: PassThrough;
  outputLines: () => string[];
  logLines: () => string[];
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const log = new PassThrough();
  const outChunks: string[] = [];
  const logChunks: string[] = [];

  output.on("data", (chunk: Buffer) => {
    outChunks.push(...(chunk.toString() as string).split("\n").filter(Boolean));
  });
  log.on("data", (chunk: Buffer) => {
    logChunks.push(chunk.toString());
  });

  const transport = new StdioTransport({
    handler: opts?.handler ?? createMcpHandler(),
    input,
    output,
    logStream: log,
  });

  return {
    transport,
    input,
    output,
    log,
    outputLines: () => outChunks,
    logLines: () => logChunks,
  };
}

function writeLine(stream: PassThrough, obj: unknown): void {
  stream.write(JSON.stringify(obj) + "\n");
}

// ── StdioTransport ────────────────────────────────────────────────────────────

describe("StdioTransport", () => {
  let { transport, input, output, outputLines, logLines } = createTransport();

  beforeEach(() => {
    ({ transport, input, output, outputLines, logLines } = createTransport());
  });

  afterEach(async () => {
    await transport.stop().catch(() => {});
  });

  // ── isRunning ─────────────────────────────────────────────────────────────

  describe("isRunning", () => {
    it("§2.2: isRunning returns false before start()", () => {
      // req-hub §2.2: stdio mode starts explicitly with start()
      expect(transport.isRunning()).toBe(false);
    });

    it("§2.2: isRunning returns true after start()", async () => {
      const started = transport.start();
      started.catch(() => {}); // prevent unhandled rejection
      expect(transport.isRunning()).toBe(true);
      input.end();
      await started;
    });
  });

  // ── start ─────────────────────────────────────────────────────────────────

  describe("start", () => {
    it("§2.2: start() returns a Promise", () => {
      const result = transport.start();
      expect(result instanceof Promise).toBe(true);
      input.end();
      return result;
    });

    it("§2.2: start() resolves when input stream ends", async () => {
      const p = transport.start();
      input.end();
      await expect(p).resolves.toBeUndefined();
    });

    it("§2.2: stop() sets isRunning to false", async () => {
      const p = transport.start();
      p.catch(() => {}); // prevent unhandled rejection
      await transport.stop();
      expect(transport.isRunning()).toBe(false);
      await p.catch(() => {});
    });
  });

  // ── stop ─────────────────────────────────────────────────────────────────

  describe("stop", () => {
    it("§2.2: stop() returns a Promise", () => {
      const result = transport.stop();
      expect(result instanceof Promise).toBe(true);
      return result;
    });

    it("§2.2: stop() resolves even when not started", async () => {
      await expect(transport.stop()).resolves.toBeUndefined();
    });
  });

  // ── writeResponse ─────────────────────────────────────────────────────────

  describe("writeResponse", () => {
    it("§2.2: writeResponse writes newline-delimited JSON to output stream", () => {
      // req-hub §2.2: write newline-delimited JSON-RPC to stdout
      transport.writeResponse({ jsonrpc: "2.0", id: "1", result: {} });
      const lines = outputLines();
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(parsed["jsonrpc"]).toBe("2.0");
      expect(parsed["id"]).toBe("1");
    });

    it("§2.2: writeResponse — null (notification) is not written", () => {
      // req-hub §2.2: notifications produce null — must NOT be written to stdout
      transport.writeResponse(null);
      expect(outputLines()).toHaveLength(0);
    });

    it("§2.2: writeResponse writes one JSON object per line", () => {
      transport.writeResponse({ jsonrpc: "2.0", id: "1", result: { a: 1 } });
      transport.writeResponse({ jsonrpc: "2.0", id: "2", result: { b: 2 } });
      const lines = outputLines();
      expect(lines).toHaveLength(2);
    });

    it("§2.2: writeResponse output is valid JSON on each line", () => {
      transport.writeResponse({ jsonrpc: "2.0", id: "x", result: { key: "val" } });
      expect(() => JSON.parse(outputLines()[0])).not.toThrow();
    });
  });

  // ── log ──────────────────────────────────────────────────────────────────

  describe("log", () => {
    it("§2.2: log() writes to logStream (stderr), not output (stdout)", () => {
      transport.log("info", "test message");
      expect(logLines().join("")).toContain("test message");
      // output must remain empty
      expect(outputLines()).toHaveLength(0);
    });

    it("§2.2: log() includes the log level in the output", () => {
      transport.log("error", "something broke");
      const logOutput = logLines().join("");
      expect(logOutput).toContain("error");
    });

    it("§2.2: log() with warn level writes to logStream", () => {
      transport.log("warn", "watch out");
      expect(logLines().join("")).toContain("watch out");
    });
  });

  // ── end-to-end: read → dispatch → write ──────────────────────────────────

  describe("end-to-end message flow", () => {
    it("§2.2: dispatches initialize request and writes response to stdout", async () => {
      const p = transport.start();
      p.catch(() => {}); // prevent unhandled rejection while awaiting timer
      writeLine(input, {
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          protocolVersion: ACCORDO_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      });
      // Wait briefly for async processing
      await new Promise((r) => setTimeout(r, 20));
      input.end();
      await p;

      const lines = outputLines();
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const resp = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(resp["id"]).toBe("init-1");
      expect(resp["error"]).toBeUndefined();
    });

    it("§2.2: notification (initialized) produces no output line", async () => {
      const p = transport.start();
      p.catch(() => {}); // prevent unhandled rejection
      writeLine(input, { jsonrpc: "2.0", method: "initialized", params: {} });
      await new Promise((r) => setTimeout(r, 20));
      input.end();
      await p;
      // No response written for notifications
      expect(outputLines()).toHaveLength(0);
    });

    it("§2.2: malformed JSON line produces error response on stdout", async () => {
      const p = transport.start();
      p.catch(() => {}); // prevent unhandled rejection
      input.write("not-valid-json\n");
      await new Promise((r) => setTimeout(r, 20));
      input.end();
      await p;

      const lines = outputLines();
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const resp = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(resp["error"]).toBeDefined();
    });

    it("§2.2: responds to ping over stdio", async () => {
      const p = transport.start();
      p.catch(() => {}); // prevent unhandled rejection
      writeLine(input, { jsonrpc: "2.0", id: "ping-1", method: "ping" });
      await new Promise((r) => setTimeout(r, 20));
      input.end();
      await p;

      const lines = outputLines();
      const resp = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(resp["id"]).toBe("ping-1");
      expect(resp["error"]).toBeUndefined();
    });
  });
});
