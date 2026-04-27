/**
 * Tests for probeHubRebind() — LCM-15 reusable flag
 *
 * Phase B: stub probeHubRebind returns hardcoded report {reusable:false,...}.
 * LR-01 (bridge-connected, registry-loaded → reusable=true): RED at assertion.
 * LR-02 (registry-empty, registry-missing → reusable=false): PASS-ELIGIBLE-IN-B
 *   — stub false, assertion false; matches stub. Serves as regression guard.
 *
 * API checklist:
 *   probeHubRebind(deps, registryPath, projectId)  [4 tests: LR-01 x2, LR-02 x2]
 *
 * Requirements: requirements-bridge.md §4 (LCM-15)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { HubRebindProbeDeps } from "../../hub-rebind-probe.js";
import { probeHubRebind } from "../../hub-rebind-probe.js";
import type { HealthResponse } from "@accordo/bridge-types";
import type { HubEntry } from "../../hub-registry.js";

const PROJECT = "test-project";
const REG_PATH = "/tmp/test.json";

function liveHealth(overrides: Partial<HealthResponse> = {}): HealthResponse {
  return { ok: true, uptime: 10, bridge: "connected", toolCount: 5, protocolVersion: "1.0.0", inflight: 0, queued: 0, ...overrides };
}

function entry(pid: number, port: number): HubEntry {
  return { pid, port, startedAt: new Date().toISOString() };
}

function fakeRegistry(e: HubEntry | null) {
  return { probeEntry: vi.fn(() => e) };
}

function fakeHealth(result: HealthResponse | null) {
  return { readHealth: vi.fn(async (_port: number) => result) };
}

function fakeSink() {
  return { record: vi.fn() };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("probeHubRebind — LCM-15: report.reusable flag", () => {
  it("LR-01: bridge-connected → reusable=true (non-pass-eligible)", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(process.pid, 3000)),
      healthReader: fakeHealth(liveHealth({ bridge: "connected" })),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.reusable).toBe(true); // stub false → RED
  });

  it("LR-01: registry-loaded → reusable=true (non-pass-eligible)", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(process.pid, 3000)),
      healthReader: fakeHealth(liveHealth({ bridge: "disconnected", toolCount: 1 })),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.reusable).toBe(true); // stub false → RED
  });

  it("LR-02: pass-eligible-in-B — registry-empty → reusable=false", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(process.pid, 3000)),
      healthReader: fakeHealth(liveHealth({ bridge: "disconnected", toolCount: 0 })),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.reusable).toBe(false); // stub false, assert false → GREEN
  });

  it("LR-02: pass-eligible-in-B — registry-missing → reusable=false", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(null),
      healthReader: fakeHealth(null),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.reusable).toBe(false); // stub false, assert false → GREEN
  });
});