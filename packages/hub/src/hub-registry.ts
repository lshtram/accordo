/**
 * Hub Registry — `~/.accordo/hubs.json` ownership tracking
 *
 * Single source of truth for multi-project Hub process lifecycle.
 * Each entry records the PID, port, and project identity of a running Hub.
 *
 * Design:
 * - File format: JSON map keyed by projectId → { pid, port, startedAt }
 * - Written only by the Hub process itself (on spawn + port selection, on graceful exit)
 * - Read by the Bridge to discover running Hubs and probe liveness
 * - Stale entries (dead PID) are cleaned up by the Bridge on activate()
 *
 * File location: ACCORDO_REGISTRY_PATH env var (set by Bridge spawn).
 * Default: ~/.accordo/hubs.json
 *
 * Requirements: requirements-hub.md §4.2, requirements-bridge.md §4 (LCM-01 scope)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * A single Hub entry in the registry.
 */
export interface HubEntry {
  /** OS process ID of the Hub */
  pid: number;
  /** HTTP port the Hub is listening on */
  port: number;
  /** ISO timestamp of when the Hub registered itself */
  startedAt: string;
}

/**
 * The full hubs.json file format — a map of projectId → HubEntry.
 */
export type HubRegistryData = Record<string, HubEntry>;

/**
 * The ACCORDO_REGISTRY_PATH env var name.
 */
export const ACCORDO_REGISTRY_PATH = "ACCORDO_REGISTRY_PATH";

/**
 * Read the entire registry. Returns empty object if file does not exist or
 * is malformed JSON. Callers must NOT mutate the returned object — pass
 * mutations through writeEntry/removeEntry for atomic writes.
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
 * Atomically write the full registry data to disk.
 * Uses a temporary file + rename for atomicity on POSIX systems.
 */
export function writeRegistry(registryPath: string, data: HubRegistryData): void {
  const dir = path.dirname(registryPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${registryPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, registryPath);
}

/**
 * Read-modify-write a single entry for projectId.
 * If entry is undefined, removes the key (fire-and-forget for stale entries).
 */
export function writeEntry(
  registryPath: string,
  projectId: string,
  entry: HubEntry,
): void {
  const data = readRegistry(registryPath);
  data[projectId] = entry;
  writeRegistry(registryPath, data);
}

/**
 * Remove the entry for projectId from the registry.
 * Idempotent — succeeds even if the key does not exist.
 */
export function removeEntry(registryPath: string, projectId: string): void {
  const data = readRegistry(registryPath);
  delete data[projectId];
  writeRegistry(registryPath, data);
}

/**
 * Get a single entry from the registry without holding a lock.
 * Returns undefined if not present.
 */
export function getEntry(registryPath: string, projectId: string): HubEntry | undefined {
  const data = readRegistry(registryPath);
  return data[projectId];
}

/**
 * Validate that a registry entry's PID is still alive.
 * Returns a new entry with corrected port if the PID is stale (PID dead).
 */
export function validateEntry(entry: HubEntry): HubEntry | null {
  try {
    process.kill(entry.pid, 0);
    return entry; // PID still alive
  } catch {
    return null; // PID is dead/stale
  }
}
