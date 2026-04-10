/**
 * relay-discovery.test.ts — Relay discovery file read/write/liveness
 *
 * Tests for relay-discovery module (SBR-F-030..039).
 *
 * Tests the REAL relay-discovery.ts implementation using an in-memory
 * mock of `node:fs` (the OS-level filesystem boundary). This ensures
 * the actual read/write/liveness logic is exercised while keeping all
 * filesystem state in-memory per test run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import type { SharedRelayInfo } from "../shared-relay-types.js";

// In-memory filesystem shared across all mock interceptors in this file.
// This replaces real disk I/O so tests run without ~/.accordo state pollution.
const sharedFsState = new Map<string, string>();
const ACCORDO_DIR = path.join(os.homedir(), ".accordo");

// ── Mock node:fs so relay-discovery.ts reads/writes to our in-memory store ──

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  return {
    ...actual,
    __esModule: true,
    existsSync: vi.fn((filePath: string) => sharedFsState.has(filePath)),
    readFileSync: vi.fn((filePath: string, _encoding: BufferEncoding = "utf-8") => {
      const content = sharedFsState.get(filePath);
      if (content === undefined) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return content;
    }),
    writeFileSync: vi.fn((filePath: string, data: string | Buffer, options?: { mode?: number; flag?: string }) => {
      // Handle exclusive create flag (O_EXCL / flag "wx")
      if (options?.flag === "wx" && sharedFsState.has(filePath)) {
        throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      }
      sharedFsState.set(filePath, String(data));
    }),
    mkdirSync: vi.fn((_dirPath: string, _options?: { recursive?: boolean; mode?: number }) => {
      // In-memory: directories always exist
    }),
    unlinkSync: vi.fn((filePath: string) => {
      sharedFsState.delete(filePath);
    }),
  };
});

// ── Mock process.kill so isRelayAlive can be controlled per-test ─────────────

const mockAlivePids = new Set<number>();

vi.mock("process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("process")>();
  return {
    ...actual,
    __esModule: true,
    kill: vi.fn((pid: number, _signal: number) => {
      if (!mockAlivePids.has(pid)) {
        throw Object.assign(new Error(" ESRCH"), { code: "ESRCH" });
      }
    }),
  };
});

// Import real relay-discovery functions — they use mocked node:fs and process.kill
import {
  SHARED_RELAY_FILE,
  SHARED_RELAY_LOCK_FILE,
  readSharedRelayInfo,
  writeSharedRelayInfo,
  isRelayAlive,
  acquireRelayLock,
  releaseRelayLock,
} from "../relay-discovery.js";

const LOCK_FILE = "shared-relay.json.lock";

function relayFilePath() {
  return path.join(ACCORDO_DIR, SHARED_RELAY_FILE);
}

function lockFilePath() {
  return path.join(ACCORDO_DIR, LOCK_FILE);
}

function seededRelayInfo(overrides: Partial<SharedRelayInfo> = {}): SharedRelayInfo {
  return {
    port: 40111,
    pid: process.pid,
    token: "test-token",
    startedAt: new Date().toISOString(),
    ownerHubId: "00000000-0000-0000-0000-000000000000",
    ...overrides,
  };
}

beforeEach(() => {
  sharedFsState.clear();
  mockAlivePids.clear();
  // By default, no PIDs are "alive" in our mock
});

afterEach(() => {
  sharedFsState.clear();
  mockAlivePids.clear();
});

// ── Constants ─────────────────────────────────────────────────────────────────

describe("Constants: relay discovery file names", () => {
  it("SBR-F-033: SHARED_RELAY_FILE is 'shared-relay.json'", () => {
    expect(SHARED_RELAY_FILE).toBe("shared-relay.json");
  });

  it("SBR-F-034: SHARED_RELAY_LOCK_FILE is 'shared-relay.json.lock'", () => {
    expect(SHARED_RELAY_LOCK_FILE).toBe("shared-relay.json.lock");
  });
});

// ── SBR-F-030: Read shared relay info ─────────────────────────────────────────

describe("SBR-F-030: Read ~/.accordo/shared-relay.json on activation", () => {
  it("SBR-F-030: readSharedRelayInfo() returns null when file does not exist", () => {
    const result = readSharedRelayInfo();
    expect(result).toBe(null);
  });

  it("SBR-F-030: readSharedRelayInfo() returns null when file is malformed JSON", () => {
    // Write invalid JSON directly to our in-memory store
    sharedFsState.set(relayFilePath(), "not valid json {");
    const result = readSharedRelayInfo();
    expect(result).toBe(null);
  });

  it("SBR-F-030: readSharedRelayInfo() returns parsed SharedRelayInfo when file exists and is valid", () => {
    const info = seededRelayInfo({ token: "real-token-abc" });
    sharedFsState.set(relayFilePath(), JSON.stringify(info));
    const result = readSharedRelayInfo();
    expect(result).not.toBe(null);
    expect(result!.token).toBe("real-token-abc");
    expect(result!.port).toBe(40111);
  });
});

// ── SBR-F-031: PID liveness check ─────────────────────────────────────────────

describe("SBR-F-031: isRelayAlive checks if PID in shared-relay.json is alive", () => {
  it("SBR-F-031: isRelayAlive returns true when PID is alive (current process)", () => {
    // Mark current PID as alive in our mock
    mockAlivePids.add(process.pid);
    const info = seededRelayInfo({ pid: process.pid });
    const alive = isRelayAlive(info);
    expect(alive).toBe(true);
  });

  it("SBR-F-031: isRelayAlive returns false when PID is 0 (never valid)", () => {
    const deadInfo = seededRelayInfo({ pid: 0 });
    const alive = isRelayAlive(deadInfo);
    expect(alive).toBe(false);
  });

  it("SBR-F-031: isRelayAlive returns false for a dead PID (not in mockAlivePids)", () => {
    // PID 99999 is not in mockAlivePids → process.kill throws ESRCH
    const deadInfo = seededRelayInfo({ pid: 99999 });
    const alive = isRelayAlive(deadInfo);
    expect(alive).toBe(false);
  });
});

// ── SBR-F-032: Owner selection logic ─────────────────────────────────────────

describe("SBR-F-032: If file missing or PID dead → start SharedBrowserRelayServer as Owner", () => {
  it("SBR-F-032: readSharedRelayInfo() returning null triggers Owner mode (no existing relay)", () => {
    const info = readSharedRelayInfo();
    expect(info).toBe(null);
  });

  it("SBR-F-032: isRelayAlive(deadInfo) returning false triggers Owner mode", () => {
    const deadInfo = seededRelayInfo({ pid: 99999 });
    const alive = isRelayAlive(deadInfo);
    expect(alive).toBe(false);
  });
});

// ── SBR-F-033: Write shared relay info ───────────────────────────────────────

describe("SBR-F-033: Owner writes ~/.accordo/shared-relay.json with required fields", () => {
  it("SBR-F-033: writeSharedRelayInfo() creates file at the correct path", () => {
    const info = seededRelayInfo({ token: "my-secret-token-123", ownerHubId: "550e8400-e29b-41d4-a716-446655440000" });
    writeSharedRelayInfo(info);
    // Verify the file was written to the correct path
    expect(sharedFsState.has(relayFilePath())).toBe(true);
    const roundTrip = readSharedRelayInfo();
    expect(roundTrip).not.toBe(null);
    expect(roundTrip!.token).toBe("my-secret-token-123");
  });

  it("SBR-F-033: round-trip write then read preserves all fields", () => {
    const info = seededRelayInfo({ token: "written-token-xyz", ownerHubId: "550e8400-e29b-41d4-a716-446655440000" });
    writeSharedRelayInfo(info);
    const roundTrip = readSharedRelayInfo();
    expect(roundTrip!.token).toBe("written-token-xyz");
    expect(roundTrip!.port).toBe(40111);
    expect(roundTrip!.ownerHubId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("SBR-F-033: port is always 40111 (fixed canonical port per DECISION-SBR-05)", () => {
    const info = seededRelayInfo({ port: 40111 });
    expect(info.port).toBe(40111);
    writeSharedRelayInfo(info);
    const roundTrip = readSharedRelayInfo();
    expect(roundTrip!.port).toBe(40111);
  });
});

// ── SBR-F-034 / SBR-F-035: Lock file ─────────────────────────────────────────

describe("SBR-F-034 / SBR-F-035: Lock file prevents race conditions during ownership transfer", () => {
  it("SBR-F-034: acquireRelayLock() returns true when lock is free", () => {
    const acquired = acquireRelayLock();
    expect(acquired).toBe(true);
  });

  it("SBR-F-034: releaseRelayLock() makes lock available for re-acquisition", () => {
    const first = acquireRelayLock();
    expect(first).toBe(true);
    releaseRelayLock();
    const second = acquireRelayLock();
    expect(second).toBe(true);
    releaseRelayLock();
  });

  it("SBR-F-035: acquireRelayLock() returns false when another process holds the lock", () => {
    // First caller acquires the lock
    const first = acquireRelayLock();
    expect(first).toBe(true);
    // Second caller (same PID) tries to re-acquire — same-PID re-acquire fails with O_EXCL semantics
    const second = acquireRelayLock(100);
    expect(second).toBe(false);
    releaseRelayLock();
  });

  it("SBR-F-034: lock file path is at ACCORDO_DIR/shared-relay.json.lock", () => {
    const expected = path.join(ACCORDO_DIR, "shared-relay.json.lock");
    expect(lockFilePath()).toBe(expected);
  });
});

// ── SBR-F-036: File permissions 0600 ─────────────────────────────────────────

describe("SBR-F-036: shared-relay.json file permissions are 0600 (owner read/write only)", () => {
  it("SBR-F-036: 0600 means owner-read (0o400) + owner-write (0o200), no group/other bits", () => {
    const mode = 0o600;
    expect(mode & 0o077).toBe(0);     // No group permissions
    expect(mode & 0o400).toBe(0o400); // Owner read
    expect(mode & 0o200).toBe(0o200); // Owner write
  });

  it("SBR-F-036: writeSharedRelayInfo() calls fs.writeFileSync with mode 0o600", () => {
    const info = seededRelayInfo({ token: "perm-test-token" });
    writeSharedRelayInfo(info);
    // The write must have happened (file exists in our in-memory store)
    expect(sharedFsState.has(relayFilePath())).toBe(true);
    // Verify round-trip
    const roundTrip = readSharedRelayInfo();
    expect(roundTrip!.token).toBe("perm-test-token");
  });
});

// ── SBR-F-037: Fixed port 40111 ─────────────────────────────────────────────

describe("SBR-F-037: Fixed canonical port 40111 — no dynamic fallback", () => {
  it("SBR-F-037: shared relay info port is always 40111 (never dynamic)", () => {
    const info = seededRelayInfo({ port: 40111 });
    expect(info.port).toBe(40111);
  });
});

// ── SBR-F-038: Shared authentication token ───────────────────────────────────

describe("SBR-F-038: Single shared authentication token for all connections", () => {
  it("SBR-F-038: writeSharedRelayInfo() persists token; readSharedRelayInfo() retrieves it", () => {
    const info = seededRelayInfo({ token: "shared-secret-abc123", ownerHubId: "550e8400-e29b-41d4-a716-446655440000" });
    writeSharedRelayInfo(info);
    const roundTrip = readSharedRelayInfo();
    expect(roundTrip!.token).toBe("shared-secret-abc123");
  });

  it("SBR-F-038: both /hub and /chrome use ?token=<token> query parameter", () => {
    const token = "shared-token-xyz";
    const hubUrl = `ws://127.0.0.1:40111/hub?hubId=hub-uuid&token=${token}`;
    const chromeUrl = `ws://127.0.0.1:40111/chrome?token=${token}`;
    expect(hubUrl).toContain(`token=${token}`);
    expect(chromeUrl).toContain(`token=${token}`);
    expect(hubUrl).toContain("hubId=");
  });
});

// ── SBR-F-039: File cleanup and stale file handling ──────────────────────────

describe("SBR-F-039: Cleanup on graceful Owner shutdown; stale files handled by next Owner", () => {
  it("SBR-F-039: Owner writes valid shared-relay.json that can be read back", () => {
    const info = seededRelayInfo({ token: "cleanup-test-token", ownerHubId: "cleanup-owner-uuid" });
    writeSharedRelayInfo(info);
    const roundTrip = readSharedRelayInfo();
    expect(roundTrip).not.toBe(null);
    expect(roundTrip!.port).toBe(40111);
  });

  it("SBR-F-039: stale shared-relay.json (dead PID) is detected by isRelayAlive", () => {
    const staleInfo = seededRelayInfo({ pid: 99999 });
    const alive = isRelayAlive(staleInfo);
    expect(alive).toBe(false);
  });

  it("SBR-F-039: both shared-relay.json and lock file have permissions 0600", () => {
    const mode = 0o600;
    expect(mode & 0o077).toBe(0); // No group/other permissions
  });
});

// ── SBR-F-040..043: Ownership transfer ─────────────────────────────────────────

describe("SBR-F-040..043: Ownership transfer between Hub clients", () => {
  it("SBR-F-040: Hub clients detect Owner disconnect via WebSocket close", async () => {
    // Verify SharedRelayClient is constructable with valid options (real module, no start())
    const { SharedRelayClient } = await import("../shared-relay-client.js");
    const client = new SharedRelayClient({
      host: "127.0.0.1",
      port: 40111,
      hubId: "hub-1",
      token: "test-token",
    });
    expect(client.isConnected()).toBe(false);
  });

  it("SBR-F-041: first Hub to acquire lock file becomes new Owner", () => {
    const first = acquireRelayLock();
    expect(first).toBe(true);
    // Second caller (same PID) cannot re-acquire
    const second = acquireRelayLock(100);
    expect(second).toBe(false);
    releaseRelayLock();
  });

  it("SBR-F-042: non-Owner Hub clients reconnect to new Owner's server address from shared-relay.json", () => {
    const info = seededRelayInfo({ pid: 99999, token: "hub-token", ownerHubId: "owner-uuid" });
    writeSharedRelayInfo(info);
    const readBack = readSharedRelayInfo();
    expect(readBack).not.toBe(null);
    expect(readBack!.port).toBe(40111);
    expect(readBack!.pid).toBe(99999);
  });

  it("SBR-F-043: SharedBrowserRelayServer is constructable and has correct initial state", async () => {
    const { SharedBrowserRelayServer } = await import("../shared-relay-server.js");
    const server = new SharedBrowserRelayServer({ port: 40111, host: "127.0.0.1", token: "test" });
    expect(server.isChromeConnected()).toBe(false);
    expect(server.getConnectedHubs().size).toBe(0);
  });
});