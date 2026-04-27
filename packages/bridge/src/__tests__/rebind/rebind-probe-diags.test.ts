/**
 * Tests for probeHubRebind() — LCM-16 diagnostic record shape
 *
 * Phase B: stub returns hardcoded report with projectId + registryPath from args.
 * DIAG-01 (projectId present): PASS-ELIGIBLE-IN-B — stub copies PROJECT → assert matches stub.
 * DIAG-02 (registryPath present): PASS-ELIGIBLE-IN-B — stub copies REG_PATH → assert matches stub.
 * DIAG-03 (pid optional): RED at assertion — stub entry undefined → pid undefined.
 * DIAG-04 (port optional): RED at assertion — stub entry undefined → port 0.
 * DIAG-05 (diagnostic sink called): RED at assertion — stub record not called.
 * DIAG-06 (no token/secret): PASS-ELIGIBLE-IN-B — stub report has no token/secret keys.
 *
 * API checklist:
 *   probeHubRebind(deps, registryPath, projectId)  [6 tests: DIAG-01..06]
 *
 * Requirements: requirements-bridge.md §4 (LCM-16)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { HubRebindProbeDeps, HubRebindDiagnosticSink } from "../../hub-rebind-probe.js";
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

function fakeSink(): HubRebindDiagnosticSink & { record: ReturnType<typeof vi.fn> } {
  return { record: vi.fn() };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("probeHubRebind — LCM-16: diagnostic record", () => {

  it("DIAG-01: pass-eligible-in-B — report.projectId is present", async () => {
    const deps: HubRebindProbeDeps = { registryReader: fakeRegistry(null), healthReader: fakeHealth(null), diagnosticSink: fakeSink() };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.projectId).toBe(PROJECT); // stub copies PROJECT → GREEN
  });

  it("DIAG-02: pass-eligible-in-B — report.registryPath is present", async () => {
    const deps: HubRebindProbeDeps = { registryReader: fakeRegistry(null), healthReader: fakeHealth(null), diagnosticSink: fakeSink() };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.registryPath).toBe(REG_PATH); // stub copies REG_PATH → GREEN
  });

  it("DIAG-03: non-pass-eligible — report includes optional pid when entry exists", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(54321, 3000)),
      healthReader: fakeHealth(liveHealth({ bridge: "connected" })),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.pid).toBe(54321); // stub returns undefined → RED at assertion
  });

  it("DIAG-04: non-pass-eligible — report includes optional port when entry exists", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(12345, 4321)),
      healthReader: fakeHealth(liveHealth({ bridge: "connected" })),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(report.port).toBe(4321); // stub returns 0 → RED at assertion
  });

  it("DIAG-05: non-pass-eligible — diagnostic sink record() is called once with the report", async () => {
    const s = fakeSink();
    const deps: HubRebindProbeDeps = { registryReader: fakeRegistry(null), healthReader: fakeHealth(null), diagnosticSink: s };
    await probeHubRebind(deps, REG_PATH, PROJECT);
    expect(s.record).toHaveBeenCalledTimes(1); // stub never calls record → RED
  });

  it("DIAG-06: pass-eligible-in-B — report does NOT contain token or secret fields", async () => {
    const deps: HubRebindProbeDeps = {
      registryReader: fakeRegistry(entry(process.pid, 3000)),
      healthReader: fakeHealth(liveHealth({ bridge: "connected" })),
      diagnosticSink: fakeSink(),
    };
    const report = await probeHubRebind(deps, REG_PATH, PROJECT);
    const keys = Object.keys(report as object);
    const hasToken = keys.some(k => k.toLowerCase().includes("token") || k.toLowerCase().includes("secret"));
    expect(hasToken).toBe(false); // stub report has no token/secret keys → GREEN
  });
});