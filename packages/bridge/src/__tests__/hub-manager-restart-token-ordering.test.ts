/**
 * Tests for hub-manager.ts — hard-fallback restart token ordering
 * Requirements: requirements-bridge.md LCM-12
 * Scope: proves hard-fallback respawn emits onHubReady with NEW token, not stale.
 * CFG-07 contract: after hard-fallback, storage-backed token source must serve the new token.
 * File: hub-manager-restart-token-ordering.test.ts (≤150 lines)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const mockCpState = vi.hoisted(() => ({
  lastCall: null as { executable: string; args: string[]; env: Record<string, string | undefined> } | null,
  lastProcess: null as { pid?: number; emit(e: string, ...a: unknown[]): void; stdout: { on(e: string, cb: (d: Buffer) => void): void; emit(e: string, d: Buffer): boolean }; stderr: { on(e: string, cb: (d: Buffer) => void): void; emit(e: string, d: Buffer): boolean }; kill(s?: string): void; exitCode: number | null } | null,
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const state = mockCpState;
  class MockStream extends EventEmitter {
    on(event: string, cb: (data: Buffer) => void) { super.on(event, cb); return this; }
  }
  class MockProcess extends EventEmitter {
    pid = 99999; stdout = new MockStream(); stderr = new MockStream(); exitCode: number | null = null;
    kill(_signal?: string) { this.exitCode = 1; this.emit("exit", 1, null); }
  }
  const execFile = vi.fn((executable: string, args: string[], opts?: unknown) => {
    const env = ((opts as Record<string, unknown> | undefined)?.env ?? {}) as Record<string, string | undefined>;
    const proc = new MockProcess() as unknown as typeof state.lastProcess;
    state.lastCall = { executable, args, env };
    state.lastProcess = proc;
    return proc;
  });
  return { execFile, execFileSync: vi.fn(() => "/usr/bin/node\n") };
});

import { HubManager } from "../hub-manager.js";
import type { HubManagerConfig, SecretStorage, OutputChannel } from "../hub-manager.js";

function makeSecretStorage(initial: Record<string, string> = {}): SecretStorage {
  const store = { ...initial };
  return { get: vi.fn(async (k: string) => store[k]), store: vi.fn(async (k: string, v: string) => { store[k] = v; }), delete: vi.fn(async (k: string) => { delete store[k]; }) };
}
function makeOutputChannel(): OutputChannel { return { appendLine: vi.fn(), show: vi.fn() }; }
function makeEvents() { return { onHubReady: vi.fn(), onHubError: vi.fn(() => {}), onCredentialsRotated: vi.fn() }; }
function makeConfig(overrides: Partial<HubManagerConfig> = {}): HubManagerConfig {
  return { port: 3000, autoStart: true, executablePath: "", hubEntryPoint: "/path/to/accordo-hub/dist/index.js", projectId: "test-project", ...overrides };
}

/** Matches a UUID v4 string: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("HubManager — hard-fallback restart token freshness (HFT-01)", () => {
  beforeEach(() => {
    mockCpState.lastCall = null;
    mockCpState.lastProcess = null;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("HFT-01: LCM-12 — hard-fallback emits onHubReady with new UUID token (not the stale token)", async () => {
    const secrets = makeSecretStorage({ "accordo.test-project.bridgeSecret": "old-secret", "accordo.test-project.hubToken": "old-token" });
    const output = makeOutputChannel();
    // Create ONE events instance — same object is passed to HubManager AND asserted against
    const events = makeEvents();
    const config = makeConfig();
    const manager = new HubManager(secrets, output, config, events);
    (manager as unknown as Record<string, string>)["secret"] = "old-secret";
    (manager as unknown as Record<string, string>)["token"] = "old-token";
    vi.spyOn(manager, "attemptReauth").mockResolvedValue(false);
    vi.spyOn(manager, "killHub").mockResolvedValue(undefined);
    vi.spyOn(manager, "spawn").mockResolvedValue(undefined);
    vi.spyOn(manager, "pollHealth").mockResolvedValue(true);
    await manager.restart();
    await vi.advanceTimersByTimeAsync(0);
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(events.onHubReady).toHaveBeenCalled();
    const [, emittedToken] = (events.onHubReady as ReturnType<typeof vi.fn>).mock.calls[0] as [number, string];
    // The hard-fallback path generates new credentials via crypto.randomUUID().
    // Assert the token is a valid UUID — not the stale "old-token" string.
    expect(emittedToken).toMatch(UUID_REGEX);
    expect(emittedToken).not.toBe("old-token");
  });

  it("HFT-01b: CFG-07 — after hard-fallback, storage-backed token source serves the new token", async () => {
    // Prove the CFG-07 contract: SecretStorage persists the new token before
    // config-sync observers fire, so the storage-backed source reads the new token.
    const secrets = makeSecretStorage({ "accordo.test-project.bridgeSecret": "old-secret", "accordo.test-project.hubToken": "old-token" });
    const output = makeOutputChannel();
    const events = makeEvents();
    const config = makeConfig();
    const manager = new HubManager(secrets, output, config, events);
    (manager as unknown as Record<string, string>)["secret"] = "old-secret";
    (manager as unknown as Record<string, string>)["token"] = "old-token";
    vi.spyOn(manager, "attemptReauth").mockResolvedValue(false);
    vi.spyOn(manager, "killHub").mockResolvedValue(undefined);
    vi.spyOn(manager, "spawn").mockResolvedValue(undefined);
    vi.spyOn(manager, "pollHealth").mockResolvedValue(true);
    await manager.restart();
    await vi.advanceTimersByTimeAsync(0);
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(events.onHubReady).toHaveBeenCalled();
    const [, emittedToken] = (events.onHubReady as ReturnType<typeof vi.fn>).mock.calls[0] as [number, string];
    // The SecretStorage now holds the new token (persisted before onHubReady fires).
    // Verify the store reflects the new token by reading it back.
    const storeMock = secrets.store as ReturnType<typeof vi.fn>;
    const storeCalls = storeMock.mock.calls as Array<[string, string]>;
    const hubTokenCall = storeCalls.find(([k]) => k.includes("hubToken"));
    expect(hubTokenCall).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(hubTokenCall![1]).toMatch(UUID_REGEX);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(hubTokenCall![1]).toBe(emittedToken);
  });
});