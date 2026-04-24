import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnAndWaitHub } from "../hub-manager-spawn.js";
import type { HubProcessSharedState } from "../hub-process.js";

describe("hub-manager-spawn port resolution", () => {
  let tmpRegistryPath: string | null = null;

  afterEach(() => {
    if (tmpRegistryPath !== null) {
      try { fs.unlinkSync(tmpRegistryPath); } catch { /* noop */ }
      tmpRegistryPath = null;
    }
    vi.restoreAllMocks();
  });

  it("SPAWN-01: uses registry port for spawned pid before readiness checks", async () => {
    const projectId = "-home-liorshtram-project-a8513ffe";
    tmpRegistryPath = path.join(os.tmpdir(), `accordo-reg-${process.pid}-${Date.now()}.json`);

    const events = { onHubReady: vi.fn(), onHubError: vi.fn(), onCredentialsRotated: vi.fn() };
    const processState: HubProcessSharedState = {
      hubProcess: null,
      token: "tok",
      secret: "sec",
      restartAttempted: false,
      killRequested: false,
    };
    const healthState = { port: 3000 };

    const spawnFn = vi.fn(async () => {
      processState.hubProcess = { pid: process.pid } as unknown as HubProcessSharedState["hubProcess"];
      fs.writeFileSync(
        tmpRegistryPath!,
        JSON.stringify({ [projectId]: { pid: process.pid, port: 3001, startedAt: new Date().toISOString() } }),
        "utf8",
      );
    });
    const pollHealthFn = vi.fn(async () => healthState.port === 3001);

    await spawnAndWaitHub(
      spawnFn,
      pollHealthFn,
      { projectId, configRegistryPath: tmpRegistryPath, events, processState, healthState },
      "sec",
      "tok",
      3000,
    );

    expect(pollHealthFn).toHaveBeenCalled();
    expect(events.onHubReady).toHaveBeenCalledWith(3001, "tok");
  });

  it("SPAWN-02: falls back to configured port when no matching spawned pid entry appears", async () => {
    const projectId = "-home-liorshtram-project-a8513ffe";
    tmpRegistryPath = path.join(os.tmpdir(), `accordo-reg-${process.pid}-${Date.now()}-2.json`);

    const events = { onHubReady: vi.fn(), onHubError: vi.fn(), onCredentialsRotated: vi.fn() };
    const processState: HubProcessSharedState = {
      hubProcess: null,
      token: "tok",
      secret: "sec",
      restartAttempted: false,
      killRequested: false,
    };
    const healthState = { port: 3000 };

    const spawnFn = vi.fn(async () => {
      fs.writeFileSync(tmpRegistryPath!, JSON.stringify({}), "utf8");
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
});
