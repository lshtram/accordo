/**
 * Regression tests for the bridge startup race condition.
 *
 * Root cause: `spawnAndWaitHub` previously called `checkHealthFn()` (single probe)
 * instead of `pollHealthFn()` (retry loop).  If the Hub process had not yet bound
 * its HTTP port by the time the one-shot check ran, `ready` was `false`,
 * `onHubReady` was silently skipped, and the bridge stayed disconnected
 * (toolCount=0) until a manual VS Code reload.
 *
 * Fix: `spawnAndWaitHub` now accepts a `pollHealthFn` that retries until the Hub
 * is healthy or the deadline is exceeded — matching the hard-restart path in
 * `hub-manager-lifecycle.ts` that already used `pollHealth`.
 *
 * Requirements: requirements-bridge.md §4 (LCM-01, LCM-03, LCM-07)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnAndWaitHub } from "../hub-manager-spawn.js";
import type { HubProcessSharedState } from "../hub-process.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeProcessState(pid?: number): HubProcessSharedState {
  return {
    hubProcess: pid !== undefined ? ({ pid } as unknown as HubProcessSharedState["hubProcess"]) : null,
    token: "tok",
    secret: "sec",
    restartAttempted: false,
    killRequested: false,
  };
}

function makeEvents() {
  return {
    onHubReady: vi.fn(),
    onHubError: vi.fn(),
    onCredentialsRotated: vi.fn(),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("hub-manager startup race — spawnAndWaitHub uses pollHealthFn (retry loop)", () => {
  let tmpRegistryPath: string | null = null;

  afterEach(() => {
    if (tmpRegistryPath !== null) {
      try { fs.unlinkSync(tmpRegistryPath); } catch { /* noop */ }
      tmpRegistryPath = null;
    }
    vi.restoreAllMocks();
  });

  it("RACE-01: onHubReady fires even when Hub is not ready on the first probe attempt", async () => {
    // Simulates the intermittent startup race: Hub is slow to bind its port.
    // The pollHealthFn (retry loop) eventually returns true after retrying.
    // With the old single-probe design (checkHealthFn called once), if the Hub
    // wasn't ready on that one call, onHubReady was silently skipped.
    const projectId = "test-race-project";
    tmpRegistryPath = path.join(os.tmpdir(), `accordo-race-${process.pid}-${Date.now()}.json`);

    const events = makeEvents();
    const processState = makeProcessState();
    const healthState = { port: 3000 };

    const spawnFn = vi.fn(async () => {
      fs.writeFileSync(
        tmpRegistryPath!,
        JSON.stringify({ [projectId]: { pid: process.pid, port: 3000, startedAt: new Date().toISOString() } }),
        "utf8",
      );
    });

    // The pollHealthFn represents the full retry loop.
    // It returns true (Hub eventually became healthy after retrying).
    const pollHealthFn = vi.fn(async () => true);

    await spawnAndWaitHub(
      spawnFn,
      pollHealthFn,
      { projectId, configRegistryPath: tmpRegistryPath, events, processState, healthState },
      "sec",
      "tok",
      3000,
    );

    // pollHealthFn must have been called (it is the retry loop, not a single probe)
    expect(pollHealthFn).toHaveBeenCalled();
    // onHubReady MUST fire — this was the bug: it was silently skipped
    expect(events.onHubReady).toHaveBeenCalledWith(3000, "tok");
  });

  it("RACE-02: onHubReady fires when Hub is immediately ready (fast startup path)", async () => {
    // Sanity check: the happy path still works after the fix.
    const projectId = "test-race-fast";
    tmpRegistryPath = path.join(os.tmpdir(), `accordo-race-fast-${process.pid}-${Date.now()}.json`);

    const events = makeEvents();
    const processState = makeProcessState();
    const healthState = { port: 3000 };

    const spawnFn = vi.fn(async () => {
      fs.writeFileSync(
        tmpRegistryPath!,
        JSON.stringify({ [projectId]: { pid: process.pid, port: 3000, startedAt: new Date().toISOString() } }),
        "utf8",
      );
    });

    const pollHealthFn = vi.fn(async () => true);

    await spawnAndWaitHub(
      spawnFn,
      pollHealthFn,
      { projectId, configRegistryPath: tmpRegistryPath, events, processState, healthState },
      "sec",
      "tok",
      3000,
    );

    expect(events.onHubReady).toHaveBeenCalledWith(3000, "tok");
  });

  it("RACE-03: onHubReady is NOT fired when pollHealthFn times out (Hub never starts)", async () => {
    // Ensures we don't emit a false-positive ready event when Hub is truly dead.
    const projectId = "test-race-timeout";
    tmpRegistryPath = path.join(os.tmpdir(), `accordo-race-timeout-${process.pid}-${Date.now()}.json`);

    const events = makeEvents();
    const processState = makeProcessState();
    const healthState = { port: 3000 };

    const spawnFn = vi.fn(async () => {
      fs.writeFileSync(tmpRegistryPath!, JSON.stringify({}), "utf8");
    });

    // Simulate Hub that never becomes healthy
    const pollHealthFn = vi.fn(async () => false);

    await spawnAndWaitHub(
      spawnFn,
      pollHealthFn,
      { projectId, configRegistryPath: tmpRegistryPath, events, processState, healthState },
      "sec",
      "tok",
      3000,
    );

    expect(events.onHubReady).not.toHaveBeenCalled();
  });

  it("RACE-04: HubManager.spawnAndWait passes pollHealth (retry loop) not checkHealth (single probe)", async () => {
    // Integration-level check: HubManager.spawnAndWait must call this.pollHealth(),
    // not this.checkHealth(), so the retry loop is engaged on first startup.
    //
    // We verify this by spying on both methods and confirming only pollHealth is called
    // during spawnAndWait (checkHealth may be called internally by pollHealth, but
    // spawnAndWait itself must not call checkHealth directly).

    const { HubManager } = await import("../hub-manager.js");

    const secretStorage = {
      get: vi.fn(async () => undefined as string | undefined),
      store: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const outputChannel = { appendLine: vi.fn(), show: vi.fn() };
    const events = makeEvents();
    const config = {
      port: 3000,
      autoStart: true,
      executablePath: "",
      hubEntryPoint: "/hub/index.js",
      projectId: "test-race-integration",
    };

    const manager = new HubManager(secretStorage, outputChannel, config, events);

    // Spy on both methods
    const pollHealthSpy = vi.spyOn(manager, "pollHealth").mockResolvedValue(true);
    const checkHealthSpy = vi.spyOn(manager, "checkHealth").mockResolvedValue(true);
    vi.spyOn(manager["hubProcess"], "spawn").mockResolvedValue(undefined);

    await manager.spawnAndWait("sec", "tok");

    // pollHealth MUST be called (the retry loop)
    expect(pollHealthSpy).toHaveBeenCalled();
    // checkHealth must NOT be called directly by spawnAndWait
    // (it may be called internally by pollHealth's real impl, but we mocked pollHealth)
    expect(checkHealthSpy).not.toHaveBeenCalled();
  });
});
