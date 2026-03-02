/**
 * Tests for index.ts (CLI entry)
 * Requirements: requirements-hub.md §4.1 (CLI flags), §4.2 (env vars)
 *
 * CliArgs has: port, host, stdio, logLevel only.
 * Token/bridgeSecret/maxConcurrent/auditFile are sourced from env vars (§4.2),
 * NOT from CLI flags — they are never accepted as CLI arguments.
 */

import { describe, it, expect, afterEach } from "vitest";
import { parseArgs, resolveConfig } from "../index.js";
import type { CliArgs } from "../index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Default valid CliArgs for resolveConfig tests. */
function baseArgs(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    port: 3000,
    host: "127.0.0.1",
    stdio: false,
    logLevel: "info",
    ...overrides,
  };
}

// Track env vars mutated in tests so we can restore them
const ENV_KEYS = [
  "ACCORDO_TOKEN",
  "ACCORDO_BRIDGE_SECRET",
  "ACCORDO_MAX_CONCURRENT_INVOCATIONS",
  "ACCORDO_AUDIT_FILE",
  "ACCORDO_HUB_PORT",
];
const savedEnv: Record<string, string | undefined> = {};

function saveEnv() {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

// ── parseArgs ─────────────────────────────────────────────────────────────────

describe("parseArgs", () => {
  it("§4.1: returns a CliArgs object for an empty argv", () => {
    const args = parseArgs([]);
    expect(args).toBeDefined();
  });

  it("§4.1: --port is parsed as a number", () => {
    const args = parseArgs(["--port", "4000"]);
    expect(args.port).toBe(4000);
  });

  it("§4.1: --host is parsed as a string", () => {
    const args = parseArgs(["--host", "0.0.0.0"]);
    expect(args.host).toBe("0.0.0.0");
  });

  it("§4.1: --stdio sets stdio: true", () => {
    const args = parseArgs(["--stdio"]);
    expect(args.stdio).toBe(true);
  });

  it("§4.1: stdio defaults to false when flag is absent", () => {
    const args = parseArgs([]);
    expect(args.stdio).toBe(false);
  });

  it("§4.1: --log-level is parsed", () => {
    const args = parseArgs(["--log-level", "debug"]);
    expect(args.logLevel).toBe("debug");
  });

  it("§4.1: multiple flags parsed together", () => {
    const args = parseArgs([
      "--port", "8080",
      "--host", "127.0.0.1",
      "--log-level", "warn",
    ]);
    expect(args.port).toBe(8080);
    expect(args.host).toBe("127.0.0.1");
    expect(args.logLevel).toBe("warn");
  });

  it("§4.1: --port defaults to 3000 when not specified", () => {
    const args = parseArgs([]);
    expect(args.port).toBe(3000);
  });

  it("§4.1: --host defaults to 127.0.0.1 when not specified", () => {
    const args = parseArgs([]);
    expect(args.host).toBe("127.0.0.1");
  });

  it("§4.1: --log-level defaults to info when not specified", () => {
    const args = parseArgs([]);
    expect(args.logLevel).toBe("info");
  });
});

// ── resolveConfig ─────────────────────────────────────────────────────────────

describe("resolveConfig", () => {
  afterEach(() => restoreEnv());

  it("§4.2: requires ACCORDO_TOKEN — throws when env var is absent", () => {
    // req-hub §4.2: ACCORDO_TOKEN is set by Bridge on Hub spawn; Hub cannot run without it
    saveEnv();
    delete process.env["ACCORDO_TOKEN"];
    delete process.env["ACCORDO_BRIDGE_SECRET"];
    expect(() => resolveConfig(baseArgs())).toThrow();
  });

  it("§4.2: reads token from ACCORDO_TOKEN env var", () => {
    saveEnv();
    process.env["ACCORDO_TOKEN"] = "env-token-value";
    process.env["ACCORDO_BRIDGE_SECRET"] = "env-secret";
    const config = resolveConfig(baseArgs());
    expect(config.token).toBe("env-token-value");
  });

  it("§4.2: reads bridgeSecret from ACCORDO_BRIDGE_SECRET env var", () => {
    saveEnv();
    process.env["ACCORDO_TOKEN"] = "t";
    process.env["ACCORDO_BRIDGE_SECRET"] = "my-ws-secret";
    const config = resolveConfig(baseArgs());
    expect(config.bridgeSecret).toBe("my-ws-secret");
  });

  it("§4.2: reads maxConcurrent from ACCORDO_MAX_CONCURRENT_INVOCATIONS env var", () => {
    saveEnv();
    process.env["ACCORDO_TOKEN"] = "t";
    process.env["ACCORDO_BRIDGE_SECRET"] = "s";
    process.env["ACCORDO_MAX_CONCURRENT_INVOCATIONS"] = "8";
    const config = resolveConfig(baseArgs());
    expect(config.maxConcurrent).toBe(8);
  });

  it("§4.2: defaults maxConcurrent to 16 when env var is unset", () => {
    saveEnv();
    process.env["ACCORDO_TOKEN"] = "t";
    process.env["ACCORDO_BRIDGE_SECRET"] = "s";
    delete process.env["ACCORDO_MAX_CONCURRENT_INVOCATIONS"];
    const config = resolveConfig(baseArgs());
    expect(config.maxConcurrent).toBe(16);
  });

  it("§4.2: reads auditFile from ACCORDO_AUDIT_FILE env var", () => {
    saveEnv();
    process.env["ACCORDO_TOKEN"] = "t";
    process.env["ACCORDO_BRIDGE_SECRET"] = "s";
    process.env["ACCORDO_AUDIT_FILE"] = "/var/log/audit.jsonl";
    const config = resolveConfig(baseArgs());
    expect(config.auditFile).toBe("/var/log/audit.jsonl");
  });

  it("§4.2: auditFile is not undefined when env var is unset", () => {
    saveEnv();
    process.env["ACCORDO_TOKEN"] = "t";
    process.env["ACCORDO_BRIDGE_SECRET"] = "s";
    delete process.env["ACCORDO_AUDIT_FILE"];
    const config = resolveConfig(baseArgs());
    expect(config.auditFile).not.toBeUndefined();
  });

  it("§4.1+§4.2: CLI --port wins over ACCORDO_HUB_PORT env var", () => {
    saveEnv();
    process.env["ACCORDO_TOKEN"] = "t";
    process.env["ACCORDO_BRIDGE_SECRET"] = "s";
    process.env["ACCORDO_HUB_PORT"] = "5000";
    const config = resolveConfig(baseArgs({ port: 9000 }));
    expect(config.port).toBe(9000);
  });

  it("§4.2: ACCORDO_HUB_PORT is used when no explicit --port flag", () => {
    // req-hub §4.2: env var port fallback when CLI uses the default
    saveEnv();
    process.env["ACCORDO_TOKEN"] = "t";
    process.env["ACCORDO_BRIDGE_SECRET"] = "s";
    process.env["ACCORDO_HUB_PORT"] = "5555";
    const config = resolveConfig(baseArgs()); // args.port === DEFAULT_HUB_PORT
    expect(config.port).toBe(5555);
  });

  it("§4.1: port passes through from CliArgs", () => {
    saveEnv();
    process.env["ACCORDO_TOKEN"] = "t";
    process.env["ACCORDO_BRIDGE_SECRET"] = "s";
    delete process.env["ACCORDO_HUB_PORT"];
    const config = resolveConfig(baseArgs({ port: 4321 }));
    expect(config.port).toBe(4321);
  });

  it("§4.1: host passes through from CliArgs", () => {
    saveEnv();
    process.env["ACCORDO_TOKEN"] = "t";
    process.env["ACCORDO_BRIDGE_SECRET"] = "s";
    const config = resolveConfig(baseArgs({ host: "0.0.0.0" }));
    expect(config.host).toBe("0.0.0.0");
  });

  it("§4.1: logLevel passes through from CliArgs", () => {
    saveEnv();
    process.env["ACCORDO_TOKEN"] = "t";
    process.env["ACCORDO_BRIDGE_SECRET"] = "s";
    const config = resolveConfig(baseArgs({ logLevel: "debug" }));
    expect(config.logLevel).toBe("debug");
  });
});
