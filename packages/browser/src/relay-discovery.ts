/**
 * Relay Discovery — Read/write/liveness for the shared relay discovery file.
 *
 * The shared relay discovery file (`~/.accordo/shared-relay.json`) allows
 * multiple VS Code windows to find and connect to the single shared relay server.
 *
 * **Exception to DECISION-MS-10:** This file lives in `~/.accordo/` because the
 * browser relay is machine-global (not workspace-scoped). The file is ephemeral —
 * valid only while the owner PID is alive. See shared-browser-relay-architecture.md §4.4
 * for lifecycle and permission rules.
 *
 * @module relay-discovery
 * @see docs/10-architecture/shared-browser-relay-architecture.md §4.4
 * @see docs/20-requirements/requirements-shared-browser-relay.md §1.4
 */

import type { SharedRelayInfo } from "./shared-relay-types.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Default path for the shared relay discovery file. */
export const SHARED_RELAY_FILE = "shared-relay.json";

/** Default path for the lock file used during ownership transfer. */
export const SHARED_RELAY_LOCK_FILE = "shared-relay.json.lock";

const ACCORDO_DIR = path.join(os.homedir(), ".accordo");

function ensureAccordoDir(): void {
  if (!fs.existsSync(ACCORDO_DIR)) {
    fs.mkdirSync(ACCORDO_DIR, { mode: 0o700 });
  }
}

function relayFilePath(): string {
  return path.join(ACCORDO_DIR, SHARED_RELAY_FILE);
}

function lockFilePath(): string {
  return path.join(ACCORDO_DIR, SHARED_RELAY_LOCK_FILE);
}

/**
 * SBR-F-030, SBR-F-031: Read the shared relay discovery file.
 *
 * @returns The parsed SharedRelayInfo, or null if the file does not exist or is malformed.
 */
export function readSharedRelayInfo(): SharedRelayInfo | null {
  const filePath = relayFilePath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as SharedRelayInfo;
  } catch {
    return null;
  }
}

/**
 * SBR-F-033, SBR-F-036: Write the shared relay discovery file.
 * File permissions are set to 0600 (owner-read/write only).
 *
 * @param info - The shared relay information to persist
 */
export function writeSharedRelayInfo(info: SharedRelayInfo): void {
  ensureAccordoDir();
  const filePath = relayFilePath();
  fs.writeFileSync(filePath, JSON.stringify(info, null, 2), { mode: 0o600 });
}

/**
 * SBR-F-031: Check if the shared relay process is alive by sending signal 0 to its PID.
 *
 * @param info - The shared relay info containing the PID to check
 * @returns true if the process is alive, false otherwise
 */
export function isRelayAlive(info: SharedRelayInfo): boolean {
  if (info.pid === 0) return false;
  try {
    // signal 0 checks if the process exists without sending any signal
    process.kill(info.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * SBR-F-039: Remove the shared relay discovery file (best-effort).
 * Called by the owner on graceful shutdown to prevent stale discovery entries.
 */
export function removeSharedRelayInfo(): void {
  const filePath = relayFilePath();
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may already be gone — ignore
  }
}

/**
 * SBR-F-034: Acquire an advisory file lock for the shared relay discovery file.
 * Used during ownership transfer to prevent race conditions between competing windows.
 *
 * SBR-F-039: Stale lock recovery — if lock exists but its holder PID is dead, remove and retry.
 *
 * @param timeoutMs - Maximum time to wait for the lock (default: 2000ms per SBR-F-035)
 * @returns true if the lock was acquired, false if timeout
 */
export function acquireRelayLock(timeoutMs: number = 2000): boolean {
  ensureAccordoDir();
  const lockPath = lockFilePath();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Attempt to create the lock file exclusively
      fs.writeFileSync(lockPath, String(process.pid), { mode: 0o600, flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        // Unexpected error — treat as lock not acquired
        return false;
      }

      // SBR-F-039: Check if the lock holder is still alive; if not, remove stale lock
      try {
        const raw = fs.readFileSync(lockPath, "utf-8");
        const holderPid = parseInt(raw.trim(), 10);
        if (!isNaN(holderPid) && holderPid !== process.pid) {
          let holderAlive = true;
          try {
            process.kill(holderPid, 0);
          } catch {
            holderAlive = false;
          }
          if (!holderAlive) {
            // Stale lock — holder process is dead, remove it and retry immediately
            try {
              fs.unlinkSync(lockPath);
            } catch {
              // Race: another process may have removed it already
            }
            continue;
          }
        }
      } catch {
        // Could not read lock file — likely removed by another process; retry
        continue;
      }

      // Lock exists and holder is alive — wait a bit before retrying
      const wait = Math.min(10, deadline - Date.now());
      if (wait <= 0) break;
    }
  }
  return false;
}

/**
 * Release the advisory file lock.
 */
export function releaseRelayLock(): void {
  const lockPath = lockFilePath();
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}
