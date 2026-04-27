/**
 * Tests for activateHub() — core decision tree (LCM-01, LCM-13..16)
 *
 * Phase B: stub always calls spawnAndWait regardless of reusable outcome.
 *
 * Non-pass-eligible (RED at assertion):
 *   A-02 (bridge-connected → no spawn): RED — stub spawns, real impl must not.
 *   A-03 (registry-loaded → no spawn): RED — stub spawns, real impl must not.
 *   A-09 (reuse sets port): RED — stub doesn't set port, real impl must.
 *
 * Pass-eligible-in-B (stub matches assertion):
 *   A-01 (first launch → spawn): stub calls spawn AND real first-launch path calls spawn → GREEN
 *   A-04 (registry-missing → spawn): stub calls spawn AND real non-reusable path calls spawn → GREEN
 *   A-05 (registry-stale → spawn): stub calls spawn AND real non-reusable path calls spawn → GREEN
 *   A-06 (registry-empty → spawn): stub calls spawn AND real non-reusable path calls spawn → GREEN
 *   A-07 (registry-unreachable → spawn): stub calls spawn AND real non-reusable path calls spawn → GREEN
 *   A-08 (autoStart=false → no probe): stub skips probeExistingHub → GREEN
 *   A-10 (stored credentials): stub applies them before probe → GREEN
 *
 * API checklist:
 *   activateHub(manager)  [10 tests: A-01..A-10]
 *
 * Requirements: requirements-bridge.md §4 (LCM-01, LCM-13 to LCM-16)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HubProcessSharedState } from "../../hub-process.js";
import { activateHub } from "../../hub-manager-activate.js";
import type { HubManagerAgent } from "../../hub-manager-activate.js";
import type { HubRebindProbeReport } from "../../hub-rebind-probe.js";

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function makeReport(outcome: HubRebindProbeReport["outcome"], reusable: boolean, port = 3000): HubRebindProbeReport {
  return { projectId: "test-project", registryPath: "/tmp/test.json", outcome, reusable, port, entry: null, health: null };
}

function makeAgent(overrides: {
  storedSecrets?: boolean;
  autoStart?: boolean;
  probeResult?: HubRebindProbeReport;
  spawnSpy?: ReturnType<typeof vi.fn>;
} = {}): HubManagerAgent {
  // Explicitly type to allow string assignment (HubProcessSharedState.secret = string | null)
  const ps: HubProcessSharedState = { hubProcess: null, secret: null, token: null, restartAttempted: false, killRequested: false };
  const hs = { port: 3000 };
  if (overrides.storedSecrets) { ps.secret = "stored-secret"; ps.token = "stored-token"; }

  return {
    config: { port: 3000, autoStart: overrides.autoStart ?? true, executablePath: "", hubEntryPoint: "/hub/index.js", projectId: "test-project" },
    secretStorage: { get: vi.fn(async (k: string) => (overrides.storedSecrets ? (k.includes("bridgeSecret") ? "stored-secret" : "stored-token") : null)), store: vi.fn(), delete: vi.fn() },
    processState: ps,
    healthState: hs,
    events: { onHubReady: vi.fn(), onHubError: vi.fn(), onCredentialsRotated: vi.fn() },
    getPort: () => 3000,
    setPort: (p: number) => { hs.port = p; },
    generateHubCredentials: async () => { const c = { secret: "new-s", token: "new-t" }; ps.secret = c.secret; ps.token = c.token; return c; },
    probeExistingHub: overrides.probeResult ? vi.fn(async () => overrides.probeResult) : vi.fn(async () => makeReport("registry-missing", false)),
    checkHealth: async () => true,
    spawnAndWait: overrides.spawnSpy ?? vi.fn(async () => {}),
  } as unknown as HubManagerAgent;
}

describe("activateHub — decision tree", () => {

  it("A-01: pass-eligible-in-B — no stored credentials → generate + store + spawn (first launch)", async () => {
    const agent = makeAgent({ storedSecrets: false });
    await activateHub(agent);
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.processState.secret).toBeTruthy();
    expect(agent.processState.token).toBeTruthy();
    expect(agent.secretStorage.store).toHaveBeenCalled();
    expect(agent.spawnAndWait).toHaveBeenCalled();
  });

  it("A-02: non-pass-eligible — stored credentials + reusable (bridge-connected) → NO spawn", async () => {
    const agent = makeAgent({ storedSecrets: true, probeResult: makeReport("bridge-connected", true, 3000) });
    await activateHub(agent);
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.spawnAndWait).not.toHaveBeenCalled();
  });

  it("A-03: non-pass-eligible — stored credentials + reusable (registry-loaded) → NO spawn", async () => {
    const agent = makeAgent({ storedSecrets: true, probeResult: makeReport("registry-loaded", true, 3000) });
    await activateHub(agent);
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.spawnAndWait).not.toHaveBeenCalled();
  });

  it("A-04: pass-eligible-in-B — stored credentials + non-reusable (registry-missing) → spawn", async () => {
    const agent = makeAgent({ storedSecrets: true, probeResult: makeReport("registry-missing", false) });
    await activateHub(agent);
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.spawnAndWait).toHaveBeenCalled();
  });

  it("A-05: pass-eligible-in-B — stored credentials + non-reusable (registry-stale) → spawn", async () => {
    const agent = makeAgent({ storedSecrets: true, probeResult: makeReport("registry-stale", false) });
    await activateHub(agent);
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.spawnAndWait).toHaveBeenCalled();
  });

  it("A-06: pass-eligible-in-B — stored credentials + non-reusable (registry-empty) → spawn", async () => {
    const agent = makeAgent({ storedSecrets: true, probeResult: makeReport("registry-empty", false) });
    await activateHub(agent);
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.spawnAndWait).toHaveBeenCalled();
  });

  it("A-07: pass-eligible-in-B — stored credentials + non-reusable (registry-unreachable) → spawn", async () => {
    const agent = makeAgent({ storedSecrets: true, probeResult: makeReport("registry-unreachable", false) });
    await activateHub(agent);
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.spawnAndWait).toHaveBeenCalled();
  });

  it("A-08: pass-eligible-in-B — autoStart=false skips probeExistingHub entirely", async () => {
    const probeSpy = vi.fn(async () => makeReport("bridge-connected", true, 3000));
    const agent = makeAgent({ storedSecrets: true, autoStart: false, probeResult: undefined }) as HubManagerAgent & { probeExistingHub: typeof probeSpy };
    agent.probeExistingHub = probeSpy;
    await activateHub(agent);
    await vi.advanceTimersByTimeAsync(0);
    expect(probeSpy).not.toHaveBeenCalled();
    expect(agent.spawnAndWait).not.toHaveBeenCalled();
  });

  it("A-09: non-pass-eligible — reuse path applies port from probe to healthState", async () => {
    const hs = { port: 3000 };
    const agent = makeAgent({ storedSecrets: true, probeResult: makeReport("bridge-connected", true, 4321) }) as HubManagerAgent & { healthState: typeof hs; setPort(p: number): void };
    agent.healthState = hs;
    agent.setPort = (p: number) => { hs.port = p; };
    await activateHub(agent);
    await vi.advanceTimersByTimeAsync(0);
    expect(hs.port).toBe(4321);
  });

  it("A-10: pass-eligible-in-B — stored credentials applied to processState before probing", async () => {
    const ps: HubProcessSharedState = { hubProcess: null, secret: null, token: null, restartAttempted: false, killRequested: false };
    const agent = makeAgent({ storedSecrets: true, probeResult: makeReport("registry-missing", false) }) as HubManagerAgent & { processState: HubProcessSharedState };
    agent.processState = ps;
    await activateHub(agent);
    await vi.advanceTimersByTimeAsync(0);
    expect(ps.secret).toBe("stored-secret");
    expect(ps.token).toBe("stored-token");
  });
});