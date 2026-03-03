/**
 * Audit Log — Tool invocation logging with file rotation.
 *
 * Every tools/call completion is logged as newline-delimited JSON (JSONL).
 * When the log file exceeds AUDIT_ROTATION_SIZE_BYTES, it is rotated:
 *   audit.jsonl  →  audit.1.jsonl  (overwriting any previous rotation)
 * A fresh audit.jsonl is started. Maximum 2 files retained (~20 MB total).
 *
 * Requirements: requirements-hub.md §7
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

/** Size threshold that triggers rotation: 10 MB */
export const AUDIT_ROTATION_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * One entry written per tools/call completion.
 * requirements-hub.md §7
 */
export interface AuditEntry {
  /** ISO 8601 timestamp of when the invocation completed */
  ts: string;
  /** Tool name, e.g. "accordo.editor.open" */
  tool: string;
  /**
   * SHA-256 hex digest of JSON.stringify(args).
   * Args are hashed, not stored, to keep audit log credential-safe.
   */
  argsHash: string;
  /** MCP session ID that issued the call */
  sessionId: string;
  /** Outcome of the invocation */
  result: "success" | "error" | "timeout" | "cancelled";
  /** Wall-clock time from invocation dispatch to result receipt */
  durationMs: number;
  /** Human-readable error message, present when result is "error" */
  errorMessage?: string;
}

/**
 * Compute a SHA-256 hex hash of the JSON-serialised args.
 * Used to produce AuditEntry.argsHash without storing raw args.
 *
 * @param args - Tool call arguments
 * @returns Hex-encoded SHA-256 digest string
 */
export function hashArgs(args: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(args)).digest("hex");
}

/**
 * Rotate the audit log file if its current size exceeds
 * AUDIT_ROTATION_SIZE_BYTES.
 *
 * Rotation renames filePath → filePath.replace(".jsonl", ".1.jsonl"),
 * overwriting any previous rotation. A fresh filePath is then created
 * on the next write. No-ops if the file does not exist or is below threshold.
 *
 * @param filePath - Absolute path to the active audit.jsonl
 */
export function rotateIfNeeded(filePath: string): void {
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return; // file absent — nothing to rotate
  }
  if (size < AUDIT_ROTATION_SIZE_BYTES) return;

  const rotated = filePath.replace(/\.jsonl$/, ".1.jsonl");
  fs.renameSync(filePath, rotated);
}

/**
 * Append one AuditEntry to filePath as a JSONL line.
 * Calls rotateIfNeeded before every write so rotation is checked
 * on every invocation (no background timer required).
 * Creates the file and any parent directories if they do not exist.
 *
 * @param filePath - Absolute path to the active audit.jsonl
 * @param entry    - Audit entry to append
 */
export function writeAuditEntry(filePath: string, entry: AuditEntry): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  rotateIfNeeded(filePath);
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf8");
}
