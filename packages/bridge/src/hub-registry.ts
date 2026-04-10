/**
 * Hub Registry — bridge-side reader for `~/.accordo/hubs.json`
 *
 * The Hub writes entries to this file; the Bridge reads them to discover
 * running Hub processes across all VS Code windows/projects.
 *
 * Responsibilities:
 * - Read the registry to find if a Hub is already registered for a project
 * - Validate that registered PIDs are still alive
 * - Provide entries to HubManager for probeExistingHub()
 *
 * The Bridge does NOT write to the registry — only the Hub process does.
 * The Bridge IS responsible for cleaning up stale entries on activation.
 *
 * File format (shared with hub package):
 *   Record<projectId, { pid: number; port: number; startedAt: string }>
 *
 * Requirements: requirements-bridge.md §4 (LCM-01 scope)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * A single Hub entry stored in the registry.
 */
export interface HubEntry {
  pid: number;
  port: number;
  startedAt: string;
}

/**
 * The full hubs.json file format.
 */
export type HubRegistryData = Record<string, HubEntry>;

/**
 * The ACCORDO_REGISTRY_PATH env var name — must match hub-registry.ts.
 */
export const ACCORDO_REGISTRY_PATH = "ACCORDO_REGISTRY_PATH";

/**
 * Default path to the registry file.
 */
export const DEFAULT_REGISTRY_PATH = path.join(os.homedir(), ".accordo", "hubs.json");

/**
 * Read the entire registry. Returns empty object if absent or malformed.
 * The returned object must NOT be mutated directly — use writeEntry/removeEntry.
 */
export function readRegistry(registryPath: string): HubRegistryData {
  try {
    const raw = fs.readFileSync(registryPath, "utf8");
    return JSON.parse(raw) as HubRegistryData;
  } catch {
    return {};
  }
}

/**
 * Get the entry for a specific projectId.
 * Returns undefined if not present.
 */
export function getEntry(registryPath: string, projectId: string): HubEntry | undefined {
  const data = readRegistry(registryPath);
  return data[projectId];
}

/**
 * Validate that a registry entry's PID is alive.
 * Returns true if the process is alive, false otherwise.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a stale entry from the registry.
 * Idempotent — succeeds even if the key does not exist.
 */
export function removeStaleEntry(registryPath: string, projectId: string): void {
  const data = readRegistry(registryPath);
  if (data[projectId] !== undefined) {
    delete data[projectId];
    // Atomic write
    const dir = path.dirname(registryPath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${registryPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, registryPath);
  }
}

/**
 * Probe the registry for an existing Hub for the given projectId.
 *
 * Flow:
 * 1. Read entry from registry
 * 2. If absent → return { alive: false }
 * 3. If PID is dead → clean up stale entry → return { alive: false }
 * 4. If PID alive → caller must do the HTTP health check to confirm
 *
 * @returns The validated entry (if PID is alive) or null
 */
export function probeRegistryEntry(
  registryPath: string,
  projectId: string,
): HubEntry | null {
  const entry = getEntry(registryPath, projectId);
  if (!entry) return null;

  if (!isProcessAlive(entry.pid)) {
    // Stale entry — PID is dead. Clean it up.
    removeStaleEntry(registryPath, projectId);
    return null;
  }

  return entry;
}

/**
 * Get the registry path to use.
 * Respects ACCORDO_REGISTRY_PATH env var (set by Bridge when spawning Hub),
 * falls back to the default path.
 */
export function resolveRegistryPath(envValue?: string): string {
  return envValue ?? DEFAULT_REGISTRY_PATH;
}
