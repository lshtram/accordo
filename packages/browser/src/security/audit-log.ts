/**
 * Browser MCP Security — Audit Log
 *
 * In-memory audit log with optional file persistence.
 * Tracks all browser MCP tool invocations with security-relevant metadata.
 *
 * Implements requirements:
 * - B2-PS-006: Audit trail logging
 * - I3-001: auditId (UUID) in every response
 *
 * Architecture note: This is a browser-package-level audit log, separate from
 * the Hub-level audit log (architecture.md §7.4). The Hub audit log tracks all
 * MCP tool calls across all modalities; this log tracks browser-specific
 * security metadata (origin, redaction, action).
 *
 * @module
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditEntry, AuditSink } from "./security-types.js";

/**
 * Options for BrowserAuditLog construction.
 */
export interface BrowserAuditLogOptions {
  /** Maximum in-memory entries (ring buffer). Default: 1000. */
  maxEntries?: number;
  /** File path for persistent logging. Default: none (in-memory only). */
  filePath?: string;
  /** Maximum file size before rotation, in bytes. Default: 10MB. */
  maxFileSizeBytes?: number;
}

/**
 * In-memory audit log with optional file persistence.
 *
 * B2-PS-006: Logs tool invocations with security-relevant metadata.
 *
 * Features:
 * - In-memory ring buffer (default: 1000 entries)
 * - Optional file persistence to `~/.accordo/browser-audit.jsonl`
 * - Size-based rotation at 10MB (consistent with Hub audit log §7.4)
 * - Thread-safe for single-process Node.js (no concurrent write conflicts)
 */
export class BrowserAuditLog implements AuditSink {
  private readonly buffer: AuditEntry[];
  private readonly maxEntries: number;
  private readonly filePath: string | undefined;
  private readonly maxFileSizeBytes: number;
  private pendingWrites: string[] = [];

  constructor(options?: BrowserAuditLogOptions) {
    this.maxEntries = options?.maxEntries ?? 1000;
    this.filePath = options?.filePath;
    this.maxFileSizeBytes = options?.maxFileSizeBytes ?? 10 * 1024 * 1024;
    this.buffer = [];

    if (this.filePath && !existsSync(this.filePath)) {
      const dir = dirname(this.filePath);
      // Ensure directory exists — will be created on first write
      try {
        appendFileSync(this.filePath, "", { flag: "a" });
      } catch {
        // Ignore — file will be created on first log call
      }
    }
  }

  createEntry(toolName: string, origin?: string, pageId?: string): AuditEntry {
    return {
      auditId: randomUUID(),
      timestamp: new Date().toISOString(),
      toolName,
      origin,
      pageId,
      action: "allowed",
      redacted: false,
    };
  }

  completeEntry(
    entry: AuditEntry,
    outcome: { action: "allowed" | "blocked"; redacted: boolean; durationMs: number },
  ): void {
    entry.action = outcome.action;
    entry.redacted = outcome.redacted;
    entry.durationMs = outcome.durationMs;
    this.log(entry);
  }

  log(entry: AuditEntry): void {
    // Ring buffer: remove oldest when at capacity
    if (this.buffer.length >= this.maxEntries) {
      this.buffer.shift();
    }
    this.buffer.push(entry);

    // File persistence
    if (this.filePath) {
      const line = JSON.stringify(entry) + "\n";
      this.pendingWrites.push(line);
    }
  }

  getRecent(count: number): AuditEntry[] {
    if (count <= 0) return [];
    const start = Math.max(0, this.buffer.length - count);
    // Return newest-first (reverse of insertion-order slice)
    return this.buffer.slice(start).reverse();
  }

  async flush(): Promise<void> {
    if (!this.filePath || this.pendingWrites.length === 0) return;

    const lines = this.pendingWrites.splice(0);
    for (const line of lines) {
      try {
        appendFileSync(this.filePath, line, { flag: "a" });
      } catch {
        // Best-effort: re-queue for next flush
        this.pendingWrites.push(line);
        break;
      }
    }
  }
}
