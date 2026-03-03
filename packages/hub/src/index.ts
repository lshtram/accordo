#!/usr/bin/env node

/**
 * Hub CLI Entry Point
 *
 * Parses CLI arguments and environment variables, then starts the HubServer.
 *
 * Usage:
 *   accordo-hub [--port 3000] [--host 127.0.0.1] [--stdio] [--log-level info]
 *
 * Requirements: requirements-hub.md §4.1, §4.2
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DEFAULT_HUB_PORT } from "@accordo/bridge-types";
import { HubServer } from "./server.js";
import { McpHandler } from "./mcp-handler.js";
import { ToolRegistry } from "./tool-registry.js";
import { BridgeServer } from "./bridge-server.js";
import { StdioTransport } from "./stdio-transport.js";

export interface CliArgs {
  port: number;
  host: string;
  stdio: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

/**
 * Parse CLI arguments from process.argv.
 */
export function parseArgs(argv: string[]): CliArgs {
  let port = DEFAULT_HUB_PORT;
  let host = "127.0.0.1";
  let stdio = false;
  let logLevel: CliArgs["logLevel"] = "info";

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--port": {
        const v = argv[++i];
        if (!v) throw new Error("--port requires a value");
        port = Number(v);
        break;
      }
      case "--host": {
        const v = argv[++i];
        if (!v) throw new Error("--host requires a value");
        host = v;
        break;
      }
      case "--stdio":
        stdio = true;
        break;
      case "--log-level": {
        const v = argv[++i];
        if (!v) throw new Error("--log-level requires a value");
        logLevel = v as CliArgs["logLevel"];
        break;
      }
    }
  }

  return { port, host, stdio, logLevel };
}

/**
 * Resolve the final configuration from CLI args + env vars.
 * CLI flags take precedence over env vars.
 * Env vars take precedence over defaults.
 */
export function resolveConfig(args: CliArgs): {
  port: number;
  host: string;
  token: string;
  bridgeSecret: string;
  maxConcurrent: number;
  auditFile: string;
  logLevel: "debug" | "info" | "warn" | "error";
} {
  const token = process.env["ACCORDO_TOKEN"];
  if (!token) {
    throw new Error(
      "ACCORDO_TOKEN environment variable is required but was not set",
    );
  }

  const bridgeSecret = process.env["ACCORDO_BRIDGE_SECRET"] ?? "";

  const maxConcurrentRaw = process.env["ACCORDO_MAX_CONCURRENT_INVOCATIONS"];
  const maxConcurrent = maxConcurrentRaw ? Number(maxConcurrentRaw) : 16;

  const defaultAuditFile = path.join(
    os.homedir(),
    ".accordo",
    "audit.jsonl",
  );
  const auditFile = process.env["ACCORDO_AUDIT_FILE"] ?? defaultAuditFile;

  // §4.2: ACCORDO_HUB_PORT is the env-var fallback for port.
  // CLI --port wins when explicitly set (differs from DEFAULT_HUB_PORT);
  // env var wins over the compile-time default.
  const envPort = process.env["ACCORDO_HUB_PORT"];
  const port =
    args.port !== DEFAULT_HUB_PORT || !envPort
      ? args.port
      : Number(envPort);

  return {
    port,
    host: args.host,
    token,
    bridgeSecret,
    maxConcurrent,
    auditFile,
    logLevel: args.logLevel,
  };
}

/**
 * Start the Hub. In stdio mode, run a StdioTransport. Otherwise start the
 * HTTP server and wait until a SIGTERM/SIGINT asks for graceful shutdown.
 *
 * @param argv - CLI argument array (defaults to process.argv.slice(2))
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const config = resolveConfig(args);

  if (args.stdio) {
    const toolRegistry = new ToolRegistry();
    const bridgeServer = new BridgeServer({
      secret: config.bridgeSecret,
      maxConcurrent: config.maxConcurrent,
    });
    const mcpHandler = new McpHandler({ toolRegistry, bridgeServer });
    const transport = new StdioTransport({ handler: mcpHandler });
    await transport.start();
  } else {
    const accordoDir = path.join(os.homedir(), ".accordo");
    const server = new HubServer({
      ...config,
      // M30-hub: path where updateToken() writes the rotated token on reauth
      tokenFilePath: path.join(accordoDir, "token"),
    });
    await server.start();

    // §4.2 + §8: Write token and PID to ~/.accordo/ (mode 0700 dir, 0600 files)
    fs.mkdirSync(accordoDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(accordoDir, "token"), config.token, { mode: 0o600 });
    fs.writeFileSync(path.join(accordoDir, "hub.pid"), String(process.pid), { mode: 0o600 });

    // Keep alive until signal
    await new Promise<void>((resolve) => {
      const shutdown = () => {
        server.stop().catch(() => {}).finally(() => {
          // Remove PID file on clean shutdown
          try { fs.unlinkSync(path.join(os.homedir(), ".accordo", "hub.pid")); } catch { /* ignore */ }
          resolve();
        });
      };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    });
  }
}

// Run when executed directly; skip when imported by tests
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error("[hub] Fatal:", err);
    process.exit(1);
  });
}
