/**
 * Hub rebind type definitions and pure classification logic.
 *
 * Requirements: requirements-bridge.md §4 (LCM-13 to LCM-16)
 */
import type { HealthResponse } from "@accordo/bridge-types";
import type { HubEntry } from "./hub-registry.js";

// ─── Outcome type ─────────────────────────────────────────────────────────────

export type HubRebindProbeOutcome =
  | "registry-missing"
  | "registry-stale"
  | "registry-unreachable"
  | "registry-empty"
  | "registry-loaded"
  | "bridge-connected";

// ─── Snapshot ─────────────────────────────────────────────────────────────────

/** Minimal health fields needed for rebind decisions. */
export interface HubRebindHealthSnapshot {
  readonly bridge: HealthResponse["bridge"];
  readonly toolCount: number;
  readonly protocolVersion: string;
}

// ─── Report ───────────────────────────────────────────────────────────────────

/** Structured startup probe record used for decisions and diagnostics. */
export interface HubRebindProbeReport {
  readonly projectId: string;
  readonly registryPath: string;
  readonly outcome: HubRebindProbeOutcome;
  readonly reusable: boolean;
  readonly pid?: number;
  readonly port?: number;
  readonly bridge?: HealthResponse["bridge"];
  readonly toolCount?: number;
  readonly protocolVersion?: string;
  readonly entry: HubEntry | null;
  readonly health: HubRebindHealthSnapshot | null;
}

// ─── Dependency interfaces ───────────────────────────────────────────────────

/** Local abstraction over the registry dependency. */
export interface HubRebindRegistryReader {
  probeEntry(registryPath: string, projectId: string): HubEntry | null;
}

/** Local abstraction over the Hub `/health` dependency. */
export interface HubRebindHealthReader {
  readHealth(port: number): Promise<HealthResponse | null>;
}

/** Local abstraction over logging/telemetry sinks. */
export interface HubRebindDiagnosticSink {
  record(report: HubRebindProbeReport): void;
}

/** Dependencies required to classify a registry rebind attempt. */
export interface HubRebindProbeDeps {
  readonly registryReader: HubRebindRegistryReader;
  readonly healthReader: HubRebindHealthReader;
  readonly diagnosticSink?: HubRebindDiagnosticSink;
}

// ─── Pure classification functions ────────────────────────────────────────────

/**
 * Canonical reusable-outcome predicate for activate()/restart flows.
 * LCM-15: only bridge-connected and registry-loaded are reusable.
 */
export function isReusableHubRebindOutcome(outcome: HubRebindProbeOutcome): boolean {
  return outcome === "bridge-connected" || outcome === "registry-loaded";
}

/**
 * Classify a registry entry + health response into a deterministic outcome.
 *
 * Classification contract (LCM-14):
 *   no entry             → registry-missing
 *   pid <= 0             → registry-stale  (explicit sentinel)
 *   entry.pid > 0, null health → registry-unreachable
 *   bridge=connected     → bridge-connected
 *   disconnected+toolCount=0 → registry-empty
 *   otherwise            → registry-loaded
 *
 * No OS-level process-kill checks are performed; liveness is determined
 * by the presence of a health response (probe says alive if /health succeeds).
 */
export function classifyOutcome(
  entry: HubEntry | null,
  health: HealthResponse | null,
): HubRebindProbeOutcome {
  if (!entry) return "registry-missing";
  if (entry.pid <= 0) return "registry-stale";

  // pid > 0 — liveness is confirmed by successful /health read (null health = unreachable)
  if (!health) return "registry-unreachable";

  if (health.bridge === "connected") return "bridge-connected";
  if (health.bridge === "disconnected" && health.toolCount === 0) return "registry-empty";
  return "registry-loaded";
}
