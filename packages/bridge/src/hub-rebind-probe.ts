/**
 * Deterministic startup classification for Priority T rebind hardening.
 *
 * Responsibilities:
 * - probeHubRebind(): orchestrates registry read + health probe + classification
 * - buildProbeReport(): constructs the structured report immutably
 *
 * Requirements: requirements-bridge.md §4 (LCM-13 to LCM-16)
 */
import type { HealthResponse } from "@accordo/bridge-types";
import type {
  HubRebindProbeReport,
  HubRebindProbeDeps,
  HubRebindHealthSnapshot,
  HubRebindProbeOutcome,
} from "./hub-rebind-types.js";
import {
  classifyOutcome,
  isReusableHubRebindOutcome,
} from "./hub-rebind-types.js";

// Re-export all public types so consumers can import from this module
export type { HubRebindProbeReport, HubRebindProbeDeps, HubRebindHealthSnapshot, HubRebindProbeOutcome } from "./hub-rebind-types.js";
export type { HubRebindDiagnosticSink } from "./hub-rebind-types.js";
export { isReusableHubRebindOutcome, classifyOutcome } from "./hub-rebind-types.js";

/**
 * Inspect the registry entry and `/health` payload for a startup rebind decision.
 * LCM-13: parse full /health body (not just HTTP status)
 * LCM-14: deterministic outcome IDs
 * LCM-15: reuse only reusable outcomes
 * LCM-16: structured diagnostics (no token/secret)
 */
export async function probeHubRebind(
  deps: HubRebindProbeDeps,
  registryPath: string,
  projectId: string,
): Promise<HubRebindProbeReport> {
  const entry = deps.registryReader.probeEntry(registryPath, projectId);

  const health: HealthResponse | null = entry
    ? await deps.healthReader.readHealth(entry.port)
    : null;

  const outcome: HubRebindProbeOutcome = classifyOutcome(entry, health);
  const reusable = isReusableHubRebindOutcome(outcome);

  const report = buildProbeReport({
    projectId,
    registryPath,
    outcome,
    reusable,
    entry,
    health,
    portOverride: !entry ? 0 : outcome === "registry-unreachable" ? 0 : undefined,
  });

  deps.diagnosticSink?.record(report);
  return report;
}

/** Immutable report builder — no type cast mutations. */
function buildProbeReport(opts: {
  projectId: string;
  registryPath: string;
  outcome: HubRebindProbeOutcome;
  reusable: boolean;
  entry: ReturnType<HubRebindProbeDeps["registryReader"]["probeEntry"]>;
  health: HealthResponse | null;
  portOverride?: number;
}): HubRebindProbeReport {
  const base: HubRebindProbeReport = {
    projectId: opts.projectId,
    registryPath: opts.registryPath,
    outcome: opts.outcome,
    reusable: opts.reusable,
    entry: opts.entry,
    health: opts.health
      ? {
          bridge: opts.health.bridge,
          toolCount: opts.health.toolCount,
          protocolVersion: opts.health.protocolVersion ?? "",
        }
      : null,
  };

  if (!opts.entry) {
    return { ...base, port: opts.portOverride ?? 0 };
  }

  const entryPort = opts.portOverride ?? opts.entry.port;
  return {
    ...base,
    pid: opts.entry.pid,
    port: entryPort,
    bridge: opts.health?.bridge,
    toolCount: opts.health?.toolCount,
    protocolVersion: opts.health?.protocolVersion ?? "",
  };
}
