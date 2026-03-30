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
import net from "node:net";
import { pathToFileURL } from "node:url";
import { DEFAULT_HUB_PORT } from "@accordo/bridge-types";
import { HubServer } from "./server.js";
import { McpHandler } from "./mcp-handler.js";
import { ToolRegistry } from "./tool-registry.js";
import { BridgeServer } from "./bridge-server.js";
import { StdioTransport } from "./stdio-transport.js";

// ---------------------------------------------------------------------------
// Dynamic port selection
// ---------------------------------------------------------------------------

/**
 * Check if a TCP port is free by attempting to bind to it.
 * Injectable probe function enables unit testing without real sockets.
 */
export function isPortFree(
  port: number,
  host: string,
  _net: typeof net = net,
): Promise<boolean> {
  return new Promise((resolve) => {
    const server = _net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

/**
 * Find the first free TCP port starting from `preferred`.
 * Tries up to `maxTries` consecutive ports.
 *
 * @param preferred - First port to try (e.g. 3000)
 * @param host      - Interface to bind on (e.g. "127.0.0.1")
 * @param maxTries  - How many ports to attempt before giving up (default: 20)
 * @param probe     - Injectable probe function (default: isPortFree)
 */
export async function findFreePort(
  preferred: number,
  host: string,
  maxTries = 20,
  probe: (port: number, host: string) => Promise<boolean> = isPortFree,
): Promise<number> {
  for (let i = 0; i < maxTries; i++) {
    const candidate = preferred + i;
    if (await probe(candidate, host)) {
      return candidate;
    }
  }
  throw new Error(`No free port found in range ${preferred}–${preferred + maxTries - 1}`);
}

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
  /** Empty string disables debug logging; undefined uses default path. */
  debugLogFile: string | undefined;
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

  // Debug log path — disabled when env var is set to "false" or "off" or ""
  const debugLogEnv = process.env["ACCORDO_DEBUG_LOG"];
  const debugLogFile =
    debugLogEnv === "false" || debugLogEnv === "off" || debugLogEnv === ""
      ? ""    // empty string → HubServer will disable the logger
      : (debugLogEnv ?? undefined);  // undefined → HubServer uses default path

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
    debugLogFile,
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
    // In HTTP mode stdin is unused.  Unref it so a dead PTY file descriptor
    // (parent VS Code killed) does not keep libuv polling an invalid fd.
    if (process.stdin.unref) {
      process.stdin.unref();
    }

    const accordoDir = path.join(os.homedir(), ".accordo");

    // Dynamic port selection: find first free port starting from config.port.
    // This prevents EADDRINUSE when another process (e.g. SSH tunnel, VS Code
    // port forward) has grabbed the preferred port.
    const actualPort = await findFreePort(config.port, config.host);
    if (actualPort !== config.port) {
      console.error(`[hub] Port ${config.port} in use — using ${actualPort}`);
    }

    const server = new HubServer({
      ...config,
      port: actualPort,
      // M30-hub: path where updateToken() writes the rotated token on reauth
      tokenFilePath: path.join(accordoDir, "token"),
    });
    await server.start();

    // §4.2 + §8: Write token, PID, and actual port to ~/.accordo/
    // (mode 0700 dir, 0600 files). The Bridge reads hub.port to discover the
    // actual bound port when it differs from the configured default.
    fs.mkdirSync(accordoDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(accordoDir, "token"), config.token, { mode: 0o600 });
    fs.writeFileSync(path.join(accordoDir, "hub.pid"), String(process.pid), { mode: 0o600 });
    fs.writeFileSync(path.join(accordoDir, "hub.port"), String(actualPort), { mode: 0o600 });
    console.error(`[hub] Listening on ${config.host}:${actualPort}`);

    // Keep alive until signal
    await new Promise<void>((resolve) => {
      const shutdown = (): void => {
        server.stop().catch(() => {}).finally(() => {
          // Remove PID and port files on clean shutdown
          const pidFile = path.join(os.homedir(), ".accordo", "hub.pid");
          const portFile = path.join(os.homedir(), ".accordo", "hub.port");
          try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
          try { fs.unlinkSync(portFile); } catch { /* ignore */ }
          resolve();
        });
      };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    });
  }
}

// Run when executed directly; skip when imported by tests.
// Use pathToFileURL so the comparison works cross-platform (Windows backslashes).
// Resolve argv[1] through fs.realpathSync so symlinks (e.g. pnpm workspace
// links from packages/bridge/node_modules/accordo-hub → packages/hub) match
// the real path that Node.js uses for import.meta.url.
const _argv1 = process.argv[1] ?? "";
let _resolvedArgv1Href = pathToFileURL(_argv1).href;
try {
  _resolvedArgv1Href = pathToFileURL(fs.realpathSync(_argv1)).href;
} catch { /* file may not exist when running from a non-file context */ }

if (import.meta.url === _resolvedArgv1Href) {
  // ── Orphan-prevention: close IPC channel ────────────────────────────────
  // When VS Code launches the Hub via its Electron "Code Helper (Plugin)"
  // child process, an IPC channel is implicitly opened.  If the parent
  // VS Code process dies (e.g. debug session killed, window closed), the
  // IPC file descriptor breaks and libuv spins at 100 % CPU because the
  // Electron event-loop integration continuously polls the dead fd.
  // The Hub never uses Node.js IPC (process.send / process.on('message')),
  // so we proactively disconnect the channel at startup.  This must happen
  // BEFORE the event loop can enter the spin state.
  if (typeof process.disconnect === "function") {
    try { process.disconnect(); } catch { /* already disconnected */ }
  }

  // ── SIGHUP: terminal session death ──────────────────────────────────────
  // When the controlling terminal (VS Code integrated terminal, PTY) closes,
  // the OS delivers SIGHUP.  Shut down cleanly instead of becoming orphaned.
  process.on("SIGHUP", () => {
    console.error("[hub] SIGHUP received — shutting down");
    process.exit(0);
  });

  // ── Process-level crash guards ──────────────────────────────────────────
  // An unhandled exception or rejection should NEVER silently kill the Hub.
  // Log the error and keep running — the Bridge will reconnect, and the MCP
  // clients will retry.  Only a truly unrecoverable state (OOM, SIGKILL)
  // should take the process down.
  process.on("uncaughtException", (err) => {
    console.error("[hub] UNCAUGHT EXCEPTION (process kept alive):", err);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[hub] UNHANDLED REJECTION (process kept alive):", reason);
  });

  main().catch((err: unknown) => {
    console.error("[hub] Fatal:", err);
    process.exit(1);
  });
}
