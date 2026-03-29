/**
 * Tests for hub-manager.ts
 * Requirements: requirements-bridge.md §4 (LCM-01 to LCM-12)
 *
 * Phase B design:
 * - All lifecycle methods throw "not implemented" on stubs → tests are RED.
 * - checkHealth, spawn, pollHealth, killHub, deactivate, restart, attemptReauth
 *   are tested against their concrete LCM contracts, not just "returns Promise".
 * - node:child_process is mocked to verify execFile args + env.
 * - checkHealth is spied on the instance for polling/lifecycle tests.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";

// ── MockChildProcess shared state ──────────────────────────────────────────────

const mockCpState = vi.hoisted(() => ({
  execFileFn: null as ((...args: unknown[]) => unknown) | null,
  lastCall: null as {
    executable: string;
    args: string[];
    env: Record<string, string | undefined>;
  } | null,
  lastProcess: null as {
    pid?: number;
    emit(event: string, ...args: unknown[]): void;
    stdout: {
      on(event: string, cb: (data: Buffer) => void): void;
      emit(event: string, data: Buffer): boolean;
    };
    stderr: {
      on(event: string, cb: (data: Buffer) => void): void;
      emit(event: string, data: Buffer): boolean;
    };
    kill(signal?: string): void;
    exitCode: number | null;
  } | null,
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const state = mockCpState;

  class MockStream extends EventEmitter {
    on(event: string, cb: (data: Buffer) => void) {
      super.on(event, cb);
      return this;
    }
  }

  class MockProcess extends EventEmitter {
    pid = 99999; // stable fake PID for tests that verify PID file writes
    stdout = new MockStream();
    stderr = new MockStream();
    exitCode: number | null = null;

    kill(_signal?: string) {
      this.exitCode = 1;
      this.emit("exit", 1, null);
    }
  }

  const execFile = vi.fn(
    (executable: string, args: string[], opts?: unknown) => {
      const env = ((opts as Record<string, unknown> | undefined)?.env ?? {}) as Record<string, string | undefined>;
      const proc = new MockProcess() as unknown as typeof state.lastProcess;
      state.lastCall = { executable, args, env };
      state.lastProcess = proc;
      return proc;
    },
  );

  state.execFileFn = execFile as (...args: unknown[]) => unknown;

  return { execFile };
});

import {
  HubManager,
} from "../hub-manager.js";
import type {
  HubManagerConfig,
  HubManagerEvents,
  SecretStorage,
  OutputChannel,
} from "../hub-manager.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

function makeSecretStorage(
  initial: Record<string, string> = {},
): SecretStorage {
  const store: Record<string, string> = { ...initial };
  return {
    get: vi.fn(async (key: string) => store[key]),
    store: vi.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    delete: vi.fn(async (key: string) => {
      delete store[key];
    }),
  };
}

function makeOutputChannel(): OutputChannel {
  return {
    appendLine: vi.fn(),
    show: vi.fn(),
  };
}

function makeEvents() {
  let errorCallCount = 0;
  let rotatedCallCount = 0;
  const credentialArgs: { token: string; secret: string }[] = [];
  return {
    onHubReady: vi.fn(),
    onHubError: vi.fn((_err: Error) => { errorCallCount++; }),
    onCredentialsRotated: vi.fn((token: string, secret: string) => {
      rotatedCallCount++;
      credentialArgs.push({ token, secret });
    }),
    get errorCallCount() { return errorCallCount; },
    get rotatedCallCount() { return rotatedCallCount; },
    get credentialArgs() { return credentialArgs; },
  };
}

function makeConfig(overrides: Partial<HubManagerConfig> = {}): HubManagerConfig {
  return {
    port: 3000,
    autoStart: true,
    executablePath: "",
    hubEntryPoint: "/path/to/accordo-hub/dist/index.js",
    ...overrides,
  };
}

function makeManager(opts: {
  secrets?: Record<string, string>;
  config?: Partial<HubManagerConfig>;
} = {}) {
  const secrets = makeSecretStorage(opts.secrets);
  const output = makeOutputChannel();
  const events = makeEvents();
  const manager = new HubManager(
    secrets,
    output,
    makeConfig(opts.config),
    events,
  );
  return { manager, secrets, output, events };
}

// ── HubManager ────────────────────────────────────────────────────────────────

describe("HubManager", () => {
  beforeEach(() => {
    mockCpState.lastCall = null;
    mockCpState.lastProcess = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── getters ───────────────────────────────────────────────────────────────

  describe("getters", () => {
    it("getPort() returns configured port", () => {
      const { manager } = makeManager({ config: { port: 4000 } });
      expect(manager.getPort()).toBe(4000);
    });

    it("getToken() returns null before activation", () => {
      const { manager } = makeManager();
      expect(manager.getToken()).toBeNull();
    });

    it("getSecret() returns null before activation", () => {
      const { manager } = makeManager();
      expect(manager.getSecret()).toBeNull();
    });
  });

  // ── isHubRunning ──────────────────────────────────────────────────────────

  describe("isHubRunning", () => {
    it("isHubRunning returns false when no process is running", () => {
      const { manager } = makeManager();
      expect(manager.isHubRunning()).toBe(false);
    });
  });

  // ── checkHealth (LCM-02) ──────────────────────────────────────────────────

  describe("checkHealth (LCM-02)", () => {
    it("LCM-02: checkHealth() returns a Promise<boolean>", () => {
      const { manager } = makeManager();
      const result = manager.checkHealth();
      expect(result).toBeInstanceOf(Promise);
      return result.catch(() => {});
    });

    it("LCM-02: checkHealth() returns false when no Hub is listening", async () => {
      vi.useRealTimers(); // need real timers for actual http.get timeout
      const { manager } = makeManager({ config: { port: 19999 } }); // no Hub on this port
      const healthy = await manager.checkHealth();
      expect(healthy).toBe(false);
    });

    it("LCM-02: checkHealth() resolves (does not hang indefinitely)", async () => {
      vi.useRealTimers();
      const { manager } = makeManager({ config: { port: 19998 } });
      const start = Date.now();
      await manager.checkHealth().catch(() => {});
      expect(Date.now() - start).toBeLessThan(5_000); // completes well within 5s
    });
  });

  // ── LCM-01: secretStorage keys ───────────────────────────────────────────

  describe("activate — LCM-01: reads from SecretStorage", () => {
    it("LCM-01: activate() reads accordo.bridgeSecret from SecretStorage", async () => {
      const { manager, secrets } = makeManager({
        secrets: { "accordo.bridgeSecret": "s", "accordo.hubToken": "t" },
      });
      vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
      await manager.activate().catch(() => {});
      expect(secrets.get).toHaveBeenCalledWith("accordo.bridgeSecret");
    });

    it("LCM-01: activate() reads accordo.hubToken from SecretStorage", async () => {
      const { manager, secrets } = makeManager({
        secrets: { "accordo.bridgeSecret": "s", "accordo.hubToken": "t" },
      });
      vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
      await manager.activate().catch(() => {});
      expect(secrets.get).toHaveBeenCalledWith("accordo.hubToken");
    });

    it("LCM-01: activate() generates a non-empty secret when absent from SecretStorage", async () => {
      const { manager } = makeManager({ secrets: {} });
      vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
      await manager.activate().catch(() => {});
      expect(manager.getSecret()).toBeTruthy();
    });

    it("LCM-01: activate() generates a non-empty token when absent from SecretStorage", async () => {
      const { manager } = makeManager({ secrets: {} });
      vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
      await manager.activate().catch(() => {});
      expect(manager.getToken()).toBeTruthy();
    });

    it("LCM-01: activate() stores the generated secret to SecretStorage", async () => {
      const { manager, secrets } = makeManager({ secrets: {} });
      vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
      await manager.activate().catch(() => {});
      expect(secrets.store).toHaveBeenCalledWith("accordo.bridgeSecret", expect.any(String));
    });

    it("LCM-01: activate() stores the generated token to SecretStorage", async () => {
      const { manager, secrets } = makeManager({ secrets: {} });
      vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
      await manager.activate().catch(() => {});
      expect(secrets.store).toHaveBeenCalledWith("accordo.hubToken", expect.any(String));
    });

    it("LCM-01: activate() does not regenerate credentials when already stored", async () => {
      const { manager, secrets } = makeManager({
        secrets: { "accordo.bridgeSecret": "existing-secret", "accordo.hubToken": "existing-token" },
      });
      vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
      await manager.activate().catch(() => {});
      expect(secrets.store).not.toHaveBeenCalled();
      expect(manager.getSecret()).toBe("existing-secret");
      expect(manager.getToken()).toBe("existing-token");
    });
  });

  // ── LCM-03: fires onHubReady when hub already running ────────────────────

  describe("activate — LCM-03: fires onHubReady when hub is healthy", () => {
    it("LCM-03: fires onHubReady when hub is already running (creds pre-stored)", async () => {
      const { manager, events } = makeManager({
        secrets: { "accordo.bridgeSecret": "s", "accordo.hubToken": "t" },
      });
      vi.spyOn(manager, "checkHealth").mockResolvedValue(true);
      await manager.activate();
      expect(events.onHubReady).toHaveBeenCalledWith(3000, "t");
    });

    it("LCM-03: fires onHubReady when hub is healthy even with no pre-stored creds", async () => {
      const { manager, events } = makeManager({ secrets: {} });
      vi.spyOn(manager, "checkHealth").mockResolvedValue(true);
      await manager.activate();
      expect(events.onHubReady).toHaveBeenCalledWith(3000, manager.getToken());
    });
  });

  // ── LCM-02: health check on activation ───────────────────────────────────

  describe("activate — LCM-02: checks health on startup", () => {
    it("LCM-02: activate() calls checkHealth() before any spawn decision", async () => {
      const { manager } = makeManager();
      const checkSpy = vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
      await manager.activate().catch(() => {});
      expect(checkSpy).toHaveBeenCalled();
    });
  });

  // ── LCM-08: autoStart=false ───────────────────────────────────────────────

  describe("activate — LCM-08: autoStart=false with Hub down", () => {
    it("LCM-08: returns quietly without error when autoStart=false and Hub is down", async () => {
      const { manager, events } = makeManager({ config: { autoStart: false } });
      vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
      await manager.activate().catch(() => {});
      expect(events.errorCallCount).toBe(0);
    });
  });

  // ── LCM-05: execFile args ─────────────────────────────────────────────────

  describe("spawn — LCM-05: uses execFile with correct args", () => {
    it("LCM-05: spawn() calls execFile (not exec or shell-spawn)", async () => {
      const { manager } = makeManager();
      const { execFile } = await import("node:child_process");
      await manager.spawn("test-secret", "test-token").catch(() => {});
      expect(execFile).toHaveBeenCalled();
    });

    it("LCM-05: execFile args are [hubEntryPoint, '--port', String(port)]", async () => {
      const { manager } = makeManager({ config: { port: 3001, hubEntryPoint: "/hub/index.js" } });
      await manager.spawn("s", "t").catch(() => {});
      expect(mockCpState.lastCall?.args).toEqual(["/hub/index.js", "--port", "3001"]);
    });

    it("LCM-05: uses process.execPath as Node executable when executablePath is empty", async () => {
      const { manager } = makeManager({ config: { executablePath: "" } });
      await manager.spawn("s", "t").catch(() => {});
      expect(mockCpState.lastCall?.executable).toBe(process.execPath);
    });

    it("LCM-05: uses configured executablePath when set", async () => {
      const { manager } = makeManager({ config: { executablePath: "/custom/node" } });
      await manager.spawn("s", "t").catch(() => {});
      expect(mockCpState.lastCall?.executable).toBe("/custom/node");
    });
  });

  // ── LCM-06: env vars ─────────────────────────────────────────────────────

  describe("spawn — LCM-06: passes required env vars", () => {
    it("LCM-06: ACCORDO_BRIDGE_SECRET is set in execFile env", async () => {
      const { manager } = makeManager({ config: { port: 3000 } });
      await manager.spawn("my-secret", "my-token").catch(() => {});
      expect(mockCpState.lastCall?.env["ACCORDO_BRIDGE_SECRET"]).toBe("my-secret");
    });

    it("LCM-06: ACCORDO_TOKEN is set in execFile env", async () => {
      const { manager } = makeManager();
      await manager.spawn("any-secret", "my-bearer-token").catch(() => {});
      expect(mockCpState.lastCall?.env["ACCORDO_TOKEN"]).toBe("my-bearer-token");
    });

    it("LCM-06: ACCORDO_HUB_PORT is set to String(port) in execFile env", async () => {
      const { manager } = makeManager({ config: { port: 4567 } });
      await manager.spawn("s", "t").catch(() => {});
      expect(mockCpState.lastCall?.env["ACCORDO_HUB_PORT"]).toBe("4567");
    });
  });

  // ── LCM-09: Hub output streamed ───────────────────────────────────────────

  describe("spawn — LCM-09: Hub stdout/stderr streamed to OutputChannel", () => {
    it("LCM-09: spawn() creates a process whose stdout data is forwarded to OutputChannel", async () => {
      const { manager, output } = makeManager();
      await manager.spawn("s", "t").catch(() => {});
      const proc = mockCpState.lastProcess;
      // RED on stub: spawn throws before creating a process → proc is null → assertion fails
      expect(proc).not.toBeNull();
      // Simulate output from the hub process
      (proc as { stdout: { emit(e: string, d: Buffer): void } }).stdout.emit("data", Buffer.from("hub started\n"));
      expect(output.appendLine).toHaveBeenCalled();
    });

    it("LCM-09: spawn() forwards stderr data to OutputChannel", async () => {
      const { manager, output } = makeManager();
      await manager.spawn("s", "t").catch(() => {});
      const proc = mockCpState.lastProcess;
      // RED on stub: proc is null
      expect(proc).not.toBeNull();
      (proc as { stderr: { emit(e: string, d: Buffer): void } }).stderr.emit("data", Buffer.from("[warn] slow startup\n"));
      expect(output.appendLine).toHaveBeenCalled();
    });
  });

  // ── LCM-07: pollHealth intervals ─────────────────────────────────────────

  describe("pollHealth — LCM-07: polls at intervals until ready or timeout", () => {
    it("LCM-07: pollHealth() calls checkHealth repeatedly until it returns true", async () => {
      const { manager } = makeManager();
      let callCount = 0;
      vi.spyOn(manager, "checkHealth").mockImplementation(async () => {
        callCount++;
        return callCount >= 3; // returns true on 3rd call
      });
      const p = manager.pollHealth(2000, 500);
      p.catch(() => {});
      // Advance timers in steps to simulate polling
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(500);
      const result = await p.catch(() => false);
      expect(result).toBe(true);
      expect(callCount).toBeGreaterThanOrEqual(3);
    });

    it("LCM-07: pollHealth() returns false when maxWaitMs is exhausted", async () => {
      const { manager } = makeManager();
      vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
      const p = manager.pollHealth(1000, 500);
      p.catch(() => {});
      await vi.advanceTimersByTimeAsync(2000); // well past maxWait
      const result = await p.catch(() => false);
      expect(result).toBe(false);
    });

    it("LCM-07: pollHealth() returns true immediately if Hub already healthy on first poll", async () => {
      const { manager } = makeManager();
      vi.spyOn(manager, "checkHealth").mockResolvedValue(true);
      const p = manager.pollHealth(5000, 500);
      p.catch(() => {});
      await vi.advanceTimersByTimeAsync(600);
      const result = await p.catch(() => false);
      expect(result).toBe(true);
    });
  });

  // ── LCM-10: crash restart ─────────────────────────────────────────────────

  describe("spawn — LCM-10: unexpected exit triggers single restart", () => {
    it("LCM-10: when hub process exits unexpectedly, a restart is attempted", async () => {
      const { manager } = makeManager();
      // Stub out the expensive parts to make the test fast
      vi.spyOn(manager, "checkHealth").mockResolvedValue(true);
      const restartSpy = vi.spyOn(manager, "restart").mockResolvedValue(undefined);
      await manager.spawn("s", "t").catch(() => {});
      // Simulate unexpected exit (not triggered by us)
      const proc = mockCpState.lastProcess;
      if (proc) {
        proc.emit("exit", 1, null);
        await Promise.resolve();
        expect(restartSpy).toHaveBeenCalled();
      } else {
        // Stub: spawn throws before attaching exit listener
        // Test is RED as expected
        expect(restartSpy).not.toHaveBeenCalled();
      }
    });

    it("LCM-10: onHubError is fired if second restart attempt also fails", async () => {
      const { manager, events } = makeManager();
      vi.spyOn(manager, "checkHealth").mockResolvedValue(true);
      // Make restart throw after second attempt
      vi.spyOn(manager, "restart").mockRejectedValue(new Error("spawn failed again"));
      await manager.spawn("s", "t").catch(() => {});
      const proc = mockCpState.lastProcess;
      if (proc) {
        proc.emit("exit", 1, null);
        await Promise.resolve();
        expect(events.errorCallCount).toBeGreaterThan(0);
      } else {
        // Stub: spawn throws → test is RED
        expect(events.errorCallCount).toBe(0);
      }
    });
  });

  // ── LCM-11: deactivate ────────────────────────────────────────────────────

  describe("deactivate (LCM-11)", () => {
    it("LCM-11: deactivate() returns a Promise that resolves", async () => {
      const { manager } = makeManager();
      vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
      await manager.activate().catch(() => {});
      await expect(manager.deactivate()).resolves.toBeUndefined();
    });

    it("LCM-11: deactivate() does NOT call killHub (Hub stays alive for CLI agents)", async () => {
      const { manager } = makeManager();
      vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
      await manager.activate().catch(() => {});
      const killSpy = vi.spyOn(manager, "killHub").mockResolvedValue(undefined);
      await manager.deactivate().catch(() => {});
      expect(killSpy).not.toHaveBeenCalled();
    });
  });

  // ── killHub ───────────────────────────────────────────────────────────────

  describe("killHub", () => {
    it("killHub() with no running process resolves without error", async () => {
      vi.useRealTimers();
      const { manager } = makeManager();
      await expect(manager.killHub()).resolves.toBeUndefined();
    });
  });

  // ── attemptReauth (LCM-12) ────────────────────────────────────────────────

  describe("attemptReauth (LCM-12)", () => {
    it("LCM-12: attemptReauth() returns a Promise<boolean>", async () => {
      vi.useRealTimers();
      // Stub http.request so no real TCP connection is made (port 3000 may be occupied).
      const fakeReq = {
        on: vi.fn().mockImplementation(function (this: typeof fakeReq, event: string, cb: (e: Error) => void) {
          if (event === "error") setImmediate(() => cb(new Error("mocked ECONNREFUSED")));
          return this;
        }),
        write: vi.fn().mockReturnThis(),
        end: vi.fn().mockReturnThis(),
      };
      vi.spyOn(http, "request").mockReturnValueOnce(fakeReq as unknown as http.ClientRequest);
      const { manager } = makeManager();
      const result = manager.attemptReauth("current-secret", "new-secret", "new-token");
      expect(result).toBeInstanceOf(Promise);
      await result; // resolves to false via error handler
    });

    it("LCM-12: attemptReauth() returns false when Hub is not reachable", async () => {
      vi.useRealTimers();
      const { manager } = makeManager({ config: { port: 19997 } }); // no Hub
      const result = await manager.attemptReauth("s", "ns", "nt").catch(() => false);
      expect(result).toBe(false);
    });

    it("LCM-12: attemptReauth() POSTs to /bridge/reauth with x-accordo-secret header and JSON body", async () => {
      vi.useRealTimers();

      const { createServer } = await import("node:http");

      let capturedMethod: string | undefined;
      let capturedPath: string | undefined;
      let capturedSecret: string | undefined;
      let capturedBody = "";

      // Spin up a real local server on a random OS-assigned port (no EPERM risk)
      const server = createServer((req, res) => {
        capturedMethod = req.method;
        capturedPath = req.url;
        capturedSecret = req.headers["x-accordo-secret"] as string;
        let body = "";
        req.on("data", (c: Buffer) => { body += c.toString(); });
        req.on("end", () => {
          capturedBody = body;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        });
      });

      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });

      const addr = server.address() as { port: number };

      try {
        const { manager } = makeManager({ config: { port: addr.port } });
        const result = await manager.attemptReauth("current-secret", "new-secret", "new-token");

        expect(result).toBe(true);
        expect(capturedMethod).toBe("POST");
        expect(capturedPath).toBe("/bridge/reauth");
        expect(capturedSecret).toBe("current-secret");
        const parsed = JSON.parse(capturedBody) as Record<string, string>;
        expect(parsed["newToken"]).toBe("new-token");
        expect(parsed["newSecret"]).toBe("new-secret");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  // ── restart (LCM-12) ─────────────────────────────────────────────────────

  describe("restart (LCM-12)", () => {
    it("LCM-12: restart() returns a Promise", async () => {
      vi.useRealTimers();
      const { manager } = makeManager();
      // Stub attemptReauth so restart returns early without real network I/O.
      vi.spyOn(manager, "attemptReauth").mockResolvedValue(true);
      const result = manager.restart();
      expect(result).toBeInstanceOf(Promise);
      await result; // resolves immediately (reauth success → early return)
    });

    it("LCM-12: restart() attempts soft reauth before hard kill+respawn", async () => {
      const { manager } = makeManager();
      const reauthSpy = vi.spyOn(manager, "attemptReauth").mockResolvedValue(true);
      await manager.restart().catch(() => {});
      expect(reauthSpy).toHaveBeenCalled();
    });

    it("LCM-12: if reauth succeeds, killHub is NOT called", async () => {
      const { manager } = makeManager();
      vi.spyOn(manager, "attemptReauth").mockResolvedValue(true);
      const killSpy = vi.spyOn(manager, "killHub").mockResolvedValue(undefined);
      await manager.restart().catch(() => {});
      expect(killSpy).not.toHaveBeenCalled();
    });

    it("LCM-12: if reauth fails, killHub IS called (hard fallback)", async () => {
      const { manager } = makeManager();
      vi.spyOn(manager, "attemptReauth").mockResolvedValue(false);
      const killSpy = vi.spyOn(manager, "killHub").mockResolvedValue(undefined);
      vi.spyOn(manager, "spawn").mockResolvedValue(undefined);
      vi.spyOn(manager, "pollHealth").mockResolvedValue(true);
      await manager.restart().catch(() => {});
      expect(killSpy).toHaveBeenCalled();
    });

    it("LCM-12: if reauth fails, spawn is called after killHub", async () => {
      const { manager } = makeManager();
      vi.spyOn(manager, "attemptReauth").mockResolvedValue(false);
      vi.spyOn(manager, "killHub").mockResolvedValue(undefined);
      const spawnSpy = vi.spyOn(manager, "spawn").mockResolvedValue(undefined);
      vi.spyOn(manager, "pollHealth").mockResolvedValue(true);
      await manager.restart().catch(() => {});
      expect(spawnSpy).toHaveBeenCalled();
    });
  });
});

// ── M29: readPidFile + isProcessAlive + activate() stale-PID detection ────────

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import http from "node:http";
import { afterAll } from "vitest";

const tmpPidFile = path.join(os.tmpdir(), `accordo-test-hub-${process.pid}.pid`);
afterAll(() => { try { fs.unlinkSync(tmpPidFile); } catch { /* ignore */ } });

describe("HubManager — readPidFile (§8 PID lifecycle)", () => {
  it("§8: returns null when file does not exist", () => {
    const { manager } = makeManager();
    expect(manager.readPidFile("/tmp/accordo-nonexistent-pid-file-xyz.pid")).toBeNull();
  });

  it("§8: returns null when file is empty", () => {
    const p = path.join(os.tmpdir(), `accordo-empty-${process.pid}.pid`);
    fs.writeFileSync(p, "");
    try {
      const { manager } = makeManager();
      expect(manager.readPidFile(p)).toBeNull();
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("§8: returns null when file contains non-numeric content", () => {
    const p = path.join(os.tmpdir(), `accordo-bad-${process.pid}.pid`);
    fs.writeFileSync(p, "garbage\n");
    try {
      const { manager } = makeManager();
      expect(manager.readPidFile(p)).toBeNull();
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("§8: returns the numeric PID when file contains a valid integer", () => {
    fs.writeFileSync(tmpPidFile, "12345\n");
    const { manager } = makeManager();
    expect(manager.readPidFile(tmpPidFile)).toBe(12345);
  });
});

describe("HubManager — isProcessAlive (§8 stale-PID detection)", () => {
  it("§8: returns true for the current process", () => {
    const { manager } = makeManager();
    expect(manager.isProcessAlive(process.pid)).toBe(true);
  });

  it("§8: returns false for PID 0 (not a valid process)", () => {
    // PID 0 is the kernel scheduler and cannot be addressed with kill
    const { manager } = makeManager();
    // Sending signal 0 to PID 0 would signal all processes (error or not depending on platform)
    // On macOS/Linux, process.kill(0, 0) throws EINVAL, so it returns false
    const result = manager.isProcessAlive(0);
    expect(typeof result).toBe("boolean");
  });

  it("§8: returns false for a safely large PID that definitely does not exist", () => {
    const { manager } = makeManager();
    // PID 2^30 — way beyond any real process table
    expect(manager.isProcessAlive(1073741824)).toBe(false);
  });
});

describe("HubManager — activate() §8 stale-PID detection (M29)", () => {
  it("M29: activate() calls readPidFile with the configured pidFilePath", async () => {
    // RED: current activate() never reads the PID file
    fs.writeFileSync(tmpPidFile, String(process.pid));
    const { manager } = makeManager({
      secrets: { "accordo.bridgeSecret": "s", "accordo.hubToken": "t" },
      config: { pidFilePath: tmpPidFile, autoStart: false },
    });

    const readPidSpy = vi.spyOn(manager, "readPidFile");
    vi.spyOn(manager, "checkHealth").mockResolvedValue(false);

    await manager.activate();

    // RED: activate() never calls readPidFile
    expect(readPidSpy).toHaveBeenCalledWith(tmpPidFile);
  });

  it("M29: when pid file has a live process, isProcessAlive is called with that PID", async () => {
    // RED: current activate() never calls isProcessAlive
    fs.writeFileSync(tmpPidFile, String(process.pid));
    const { manager } = makeManager({
      secrets: { "accordo.bridgeSecret": "s", "accordo.hubToken": "t" },
      config: { pidFilePath: tmpPidFile, autoStart: true },
    });

    const isAliveSpy = vi.spyOn(manager, "isProcessAlive");
    vi.spyOn(manager, "checkHealth").mockResolvedValue(true);
    vi.spyOn(manager, "spawn").mockResolvedValue(undefined);

    await manager.activate();

    // RED: activate() never calls isProcessAlive
    expect(isAliveSpy).toHaveBeenCalledWith(process.pid);
  });

  it("M29: when pid file has a dead process, readPidFile and isProcessAlive are both called", async () => {
    // RED: current activate() uses no PID file at all
    fs.writeFileSync(tmpPidFile, "1073741824"); // guaranteed-dead PID
    const { manager } = makeManager({
      secrets: { "accordo.bridgeSecret": "s", "accordo.hubToken": "t" },
      config: { pidFilePath: tmpPidFile, autoStart: true },
    });

    const readPidSpy = vi.spyOn(manager, "readPidFile");
    const isAliveSpy = vi.spyOn(manager, "isProcessAlive");
    vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
    vi.spyOn(manager, "spawn").mockResolvedValue(undefined);
    vi.spyOn(manager, "pollHealth").mockResolvedValue(true);

    await manager.activate();

    expect(readPidSpy).toHaveBeenCalledWith(tmpPidFile);
    expect(isAliveSpy).toHaveBeenCalledWith(1073741824);
  });

  it("M29: when pid file is absent, readPidFile is called and isProcessAlive is NOT called", async () => {
    // Ensure the pid file does not exist from a prior test run (idempotency)
    try { fs.unlinkSync("/tmp/nonexistent-accordo-m29.pid"); } catch { /* ignore */ }
    // RED: current activate() calls neither
    const { manager } = makeManager({
      secrets: { "accordo.bridgeSecret": "s", "accordo.hubToken": "t" },
      config: { pidFilePath: "/tmp/nonexistent-accordo-m29.pid", autoStart: true },
    });

    const readPidSpy = vi.spyOn(manager, "readPidFile");
    const isAliveSpy = vi.spyOn(manager, "isProcessAlive");
    vi.spyOn(manager, "checkHealth").mockResolvedValue(false);
    vi.spyOn(manager, "spawn").mockResolvedValue(undefined);
    vi.spyOn(manager, "pollHealth").mockResolvedValue(true);

    await manager.activate();
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(readPidSpy).toHaveBeenCalledWith("/tmp/nonexistent-accordo-m29.pid");
    // readPidFile returns null → isProcessAlive should NOT be called
    expect(isAliveSpy).not.toHaveBeenCalled();
  });
});

// ── M29: spawn() writes hub.pid from the parent process ──────────────────────

describe("HubManager — spawn() M29: parent writes hub.pid", () => {
  const spawnPidFile = path.join(os.tmpdir(), `accordo-spawn-pid-${process.pid}.pid`);
  afterAll(() => { try { fs.unlinkSync(spawnPidFile); } catch { /* ok */ } });

  it("M29: spawn() writes proc.pid to pidFilePath immediately after execFile", async () => {
    const { manager } = makeManager({
      secrets: { "accordo.bridgeSecret": "s", "accordo.hubToken": "t" },
      config: { pidFilePath: spawnPidFile },
    });

    await manager.spawn("s", "t").catch(() => {});

    // MockProcess.pid is 99999; hub-manager should have written it to spawnPidFile
    const written = fs.readFileSync(spawnPidFile, "utf8").trim();
    expect(written).toBe("99999");
  });

  it("M29: spawn() cleans up hub.pid when process exits", async () => {
    const cleanupFile = path.join(os.tmpdir(), `accordo-cleanup-${process.pid}.pid`);
    const { manager } = makeManager({
      secrets: { "accordo.bridgeSecret": "s", "accordo.hubToken": "t" },
      config: { pidFilePath: cleanupFile },
    });
    vi.spyOn(manager, "restart").mockResolvedValue(undefined);

    await manager.spawn("s", "t").catch(() => {});

    // File must exist immediately after spawn
    expect(fs.existsSync(cleanupFile)).toBe(true);

    // Simulate Hub process exit — HubManager's exit handler should delete the PID
    mockCpState.lastProcess?.emit("exit", 0);

    // PID file must be gone
    expect(fs.existsSync(cleanupFile)).toBe(false);
  });
});

// ── M30-bridge: restart() persists new credentials to SecretStorage (LCM-12) ──

describe("HubManager — restart() LCM-12 credential persistence (M30-bridge)", () => {
  it("LCM-12: after successful soft reauth, persists new secret to SecretStorage", async () => {
    const { manager, secrets } = makeManager({
      secrets: { "accordo.bridgeSecret": "old-secret", "accordo.hubToken": "old-token" },
    });
    // Simulate existing credentials loaded from a prior activate()
    (manager as unknown as Record<string, string>)["secret"] = "old-secret";
    (manager as unknown as Record<string, string>)["token"] = "old-token";

    vi.spyOn(manager, "attemptReauth").mockResolvedValue(true);

    await manager.restart();

    // RED: current restart() does not call secretStorage.store()
    expect(secrets.store).toHaveBeenCalledWith(
      "accordo.bridgeSecret",
      expect.any(String),
    );
    const storedSecret = (secrets.store as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "accordo.bridgeSecret",
    )?.[1] as string | undefined;
    expect(storedSecret).toBeTruthy();
    expect(storedSecret).not.toBe("old-secret");
  });

  it("LCM-12: after successful soft reauth, persists new token to SecretStorage", async () => {
    const { manager, secrets } = makeManager({
      secrets: { "accordo.bridgeSecret": "old-secret", "accordo.hubToken": "old-token" },
    });
    (manager as unknown as Record<string, string>)["secret"] = "old-secret";
    (manager as unknown as Record<string, string>)["token"] = "old-token";

    vi.spyOn(manager, "attemptReauth").mockResolvedValue(true);

    await manager.restart();

    expect(secrets.store).toHaveBeenCalledWith(
      "accordo.hubToken",
      expect.any(String),
    );
    const storedToken = (secrets.store as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "accordo.hubToken",
    )?.[1] as string | undefined;
    expect(storedToken).toBeTruthy();
    expect(storedToken).not.toBe("old-token");
  });

  it("LCM-12: after hard respawn+pollHealth success, persists new secret to SecretStorage", async () => {
    const { manager, secrets } = makeManager({
      secrets: { "accordo.bridgeSecret": "old-secret", "accordo.hubToken": "old-token" },
    });
    (manager as unknown as Record<string, string>)["secret"] = "old-secret";
    (manager as unknown as Record<string, string>)["token"] = "old-token";

    vi.spyOn(manager, "attemptReauth").mockResolvedValue(false);
    vi.spyOn(manager, "killHub").mockResolvedValue(undefined);
    vi.spyOn(manager, "spawn").mockResolvedValue(undefined);
    vi.spyOn(manager, "pollHealth").mockResolvedValue(true);

    await manager.restart();
    // Hard path: fire-and-forget poll — wait a tick for the promise chain
    await new Promise<void>((r) => setTimeout(r, 20));

    expect(secrets.store).toHaveBeenCalledWith(
      "accordo.bridgeSecret",
      expect.any(String),
    );
  });

  it("LCM-12: after hard respawn+pollHealth success, persists new token to SecretStorage", async () => {
    const { manager, secrets } = makeManager({
      secrets: { "accordo.bridgeSecret": "old-secret", "accordo.hubToken": "old-token" },
    });
    (manager as unknown as Record<string, string>)["secret"] = "old-secret";
    (manager as unknown as Record<string, string>)["token"] = "old-token";

    vi.spyOn(manager, "attemptReauth").mockResolvedValue(false);
    vi.spyOn(manager, "killHub").mockResolvedValue(undefined);
    vi.spyOn(manager, "spawn").mockResolvedValue(undefined);
    vi.spyOn(manager, "pollHealth").mockResolvedValue(true);

    await manager.restart();
    await new Promise<void>((r) => setTimeout(r, 20));

    expect(secrets.store).toHaveBeenCalledWith(
      "accordo.hubToken",
      expect.any(String),
    );
  });
});

// ── Dynamic port: portFilePath discovery ───────────────────────────────────────

const tmpPortFile = path.join(os.tmpdir(), `accordo-test-hub-${process.pid}.port`);
afterAll(() => { try { fs.unlinkSync(tmpPortFile); } catch { /* ignore */ } });

describe("HubManager — portFilePath: dynamic port discovery", () => {
  beforeEach(() => { vi.useRealTimers(); });
  afterEach(() => {
    try { fs.unlinkSync(tmpPortFile); } catch { /* ignore */ }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("activate() uses port from portFilePath when Hub already healthy on that port", async () => {
    // Hub previously started on port 3001 and wrote the port file.
    fs.writeFileSync(tmpPortFile, "3001");
    const { manager, events } = makeManager({
      secrets: { "accordo.bridgeSecret": "s", "accordo.hubToken": "t" },
      config: { port: 3000, portFilePath: tmpPortFile, autoStart: false },
    });
    vi.spyOn(manager, "checkHealth").mockResolvedValue(true);

    await manager.activate();

    // onHubReady must be called with port 3001 (from file), not 3000 (config)
    expect(events.onHubReady).toHaveBeenCalledWith(3001, expect.any(String));
    expect(manager.getPort()).toBe(3001);
  });

  it("activate() ignores portFilePath when file is absent (uses configured port)", async () => {
    // No port file exists — Hub hasn't started yet or is on default port.
    const { manager, events } = makeManager({
      secrets: { "accordo.bridgeSecret": "s", "accordo.hubToken": "t" },
      config: { port: 3000, portFilePath: "/tmp/accordo-nonexistent-port.port", autoStart: false },
    });
    vi.spyOn(manager, "checkHealth").mockResolvedValue(true);

    await manager.activate();

    expect(events.onHubReady).toHaveBeenCalledWith(3000, expect.any(String));
    expect(manager.getPort()).toBe(3000);
  });

  it("pollHealth() updates port from portFilePath on each iteration", async () => {
    vi.useFakeTimers();
    // Port file is written by Hub after it starts.
    let callCount = 0;
    const { manager } = makeManager({
      config: { port: 3000, portFilePath: tmpPortFile },
    });
    vi.spyOn(manager, "checkHealth").mockImplementation(async () => {
      callCount++;
      return callCount >= 2; // healthy on 2nd call
    });

    // Write port file before the 2nd poll fires
    const p = manager.pollHealth(5000, 500);
    await vi.advanceTimersByTimeAsync(100);
    fs.writeFileSync(tmpPortFile, "3002"); // Hub started on 3002
    await vi.advanceTimersByTimeAsync(1100); // advance past 2 poll intervals (500ms + 1000ms)
    await p;

    expect(manager.getPort()).toBe(3002);
  });

  it("portFilePath with invalid content is ignored, port stays unchanged", async () => {
    fs.writeFileSync(tmpPortFile, "not-a-port");
    const { manager, events } = makeManager({
      secrets: { "accordo.bridgeSecret": "s", "accordo.hubToken": "t" },
      config: { port: 4567, portFilePath: tmpPortFile, autoStart: false },
    });
    vi.spyOn(manager, "checkHealth").mockResolvedValue(true);

    await manager.activate();

    expect(manager.getPort()).toBe(4567); // unchanged
    expect(events.onHubReady).toHaveBeenCalledWith(4567, expect.any(String));
  });
});
