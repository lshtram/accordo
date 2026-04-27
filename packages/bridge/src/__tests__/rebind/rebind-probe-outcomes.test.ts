/**
 * Tests for probeHubRebind() — outcome classification (LCM-13, LCM-14)
 *
 * Phase B: stub returns hardcoded {outcome:"registry-missing", reusable:false}.
 * Non-pass-eligible (RED at assertion):
 *   LCM-13: bridge/toolCount fields not in stub → assertions RED
 *   LCM-13: null health → stub outcome=registry-missing, real must be=registry-unreachable → RED
 *   LCM-14: all outcomes except "registry-missing" → stub returns wrong outcome → RED
 * Pass-eligible-in-B:
 *   LCM-14-01: no registry entry → stub returns "registry-missing", test expects same → GREEN
 *
 * API checklist:
 *   probeHubRebind(deps, registryPath, projectId)  [9 tests: LCM-13 x3, LCM-14 x6]
 *
 * Requirements: requirements-bridge.md §4 (LCM-13, LCM-14)
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

// ── LCM-13: parse /health body (not just HTTP status) ─────────────────────────

describe("probeHubRebind — LCM-13: parses /health body", () => {

  it("LCM-13: non-pass-eligible — result includes bridge field from /health body", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(12345, 3000)),
      healthReader: fakeHealth(liveHealth({ bridge: "connected" })),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.bridge).toBe("connected"); // stub: undefined → RED
  });

  it("LCM-13: non-pass-eligible — result includes toolCount field from /health body", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(12345, 3000)),
      healthReader: fakeHealth(liveHealth({ toolCount: 42 })),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.toolCount).toBe(42); // stub: undefined → RED
  });

  it("LCM-13: non-pass-eligible — null health → outcome must be registry-unreachable", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(12345, 3000)),
      healthReader: fakeHealth(null),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.reusable).toBe(false);
    expect(report.outcome).toBe("registry-unreachable"); // stub: registry-missing → RED
  });
});

// ── LCM-14: deterministic outcome IDs ──────────────────────────────────────────

describe("probeHubRebind — LCM-14: deterministic outcome IDs", () => {

  it("LCM-14-01: pass-eligible-in-B — no registry entry → stub already returns registry-missing", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(null),
      healthReader: fakeHealth(null),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.outcome).toBe("registry-missing"); // stub returns same → GREEN
  });

  it("LCM-14: non-pass-eligible — entry.pid is dead (PID 0) → stub returns wrong outcome", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(0, 3000)),
      healthReader: fakeHealth(null),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.outcome).toBe("registry-stale"); // stub: registry-missing → RED
  });

  it("LCM-14: non-pass-eligible — entry alive, health null → stub returns wrong outcome", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(process.pid, 3000)),
      healthReader: fakeHealth(null),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.outcome).toBe("registry-unreachable"); // stub: registry-missing → RED
  });

  it("LCM-14: non-pass-eligible — disconnected + toolCount=0 → stub returns wrong outcome", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(process.pid, 3000)),
      healthReader: fakeHealth(liveHealth({ bridge: "disconnected", toolCount: 0 })),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.outcome).toBe("registry-empty"); // stub: registry-missing → RED
  });

  it("LCM-14: non-pass-eligible — disconnected + toolCount>0 → stub returns wrong outcome", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(process.pid, 3000)),
      healthReader: fakeHealth(liveHealth({ bridge: "disconnected", toolCount: 7 })),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.outcome).toBe("registry-loaded"); // stub: registry-missing → RED
  });

  it("LCM-14: non-pass-eligible — bridge=connected → stub returns wrong outcome", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(process.pid, 3000)),
      healthReader: fakeHealth(liveHealth({ bridge: "connected" })),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.outcome).toBe("bridge-connected"); // stub: registry-missing → RED
  });
});