/**
 * security-audit-log.test.ts
 *
 * Tests for F4: Audit Trail (MCP-SEC-004, B2-PS-006, I3-001)
 *
 * API checklist (BrowserAuditLog):
 * - constructor(options?) → BrowserAuditLog
 * - createEntry(toolName, origin?, pageId?) → AuditEntry
 * - completeEntry(entry, outcome) → void
 * - log(entry) → void
 * - getRecent(count) → AuditEntry[]
 * - flush() → Promise<void>
 *
 * These tests call BrowserAuditLog directly.
 * They will fail until Phase C implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BrowserAuditLog,
  BrowserAuditLogOptions,
  AuditEntry,
} from "../security/index.js";

// ── Constructor ───────────────────────────────────────────────────────────────

describe("BrowserAuditLog: constructor", () => {
  it("BrowserAuditLog: Can be constructed with no options", () => {
    expect(() => new BrowserAuditLog()).not.toThrow();
  });

  it("BrowserAuditLog: Can be constructed with custom maxEntries", () => {
    const log = new BrowserAuditLog({ maxEntries: 100 });
    expect(log).toBeDefined();
  });

  it("BrowserAuditLog: Can be constructed with filePath (in-memory without file)", () => {
    const log = new BrowserAuditLog({ filePath: "/tmp/test-audit.jsonl" });
    expect(log).toBeDefined();
  });

  it("BrowserAuditLog: maxFileSizeBytes option is accepted", () => {
    const log = new BrowserAuditLog({ maxFileSizeBytes: 5 * 1024 * 1024 });
    expect(log).toBeDefined();
  });
});

// ── createEntry: I3-001 (auditId = UUIDv4) ──────────────────────────────────

describe("MCP-SEC-004 / I3-001: createEntry — auditId is UUIDv4", () => {
  it("I3-001: createEntry returns an AuditEntry with auditId", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("accordo_browser_get_text_map", "https://example.com", "page-1");
    expect(entry).toHaveProperty("auditId");
    expect(typeof entry.auditId).toBe("string");
  });

  it("I3-001: auditId is a valid UUIDv4 format", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("accordo_browser_get_page_map");
    // UUIDv4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(entry.auditId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("I3-001: Multiple createEntry calls produce unique auditIds", () => {
    const log = new BrowserAuditLog();
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      ids.add(log.createEntry("test-tool").auditId);
    }
    expect(ids.size).toBe(10);
  });

  it("I3-001: createEntry sets toolName on the entry", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("accordo_browser_get_semantic_graph");
    expect(entry.toolName).toBe("accordo_browser_get_semantic_graph");
  });

  it("I3-001: createEntry sets origin when provided", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("test-tool", "https://example.com", "page-1");
    expect(entry.origin).toBe("https://example.com");
  });

  it("I3-001: createEntry sets pageId when provided", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("test-tool", "https://example.com", "page-abc");
    expect(entry.pageId).toBe("page-abc");
  });

  it("I3-001: createEntry sets timestamp as ISO 8601 string", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("test-tool");
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("I3-001: createEntry sets action to 'allowed' by default initially", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("test-tool");
    // Action is set to "allowed" initially; completeEntry updates it to blocked if needed
    expect(entry.action).toBe("allowed");
  });
});

// ── completeEntry ───────────────────────────────────────────────────────────

describe("BrowserAuditLog: completeEntry", () => {
  it("completeEntry: Updates entry with outcome action 'allowed'", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("test-tool");
    log.completeEntry(entry, { action: "allowed", redacted: false, durationMs: 150 });
    expect(entry.action).toBe("allowed");
    expect(entry.redacted).toBe(false);
    expect(entry.durationMs).toBe(150);
  });

  it("completeEntry: Updates entry with outcome action 'blocked'", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("test-tool");
    log.completeEntry(entry, { action: "blocked", redacted: false, durationMs: 5 });
    expect(entry.action).toBe("blocked");
  });

  it("completeEntry: Records redacted: true when redaction was applied", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("test-tool");
    log.completeEntry(entry, { action: "allowed", redacted: true, durationMs: 200 });
    expect(entry.redacted).toBe(true);
  });

  it("completeEntry: Records durationMs", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("test-tool");
    log.completeEntry(entry, { action: "allowed", redacted: false, durationMs: 999 });
    expect(entry.durationMs).toBe(999);
  });
});

// ── log + getRecent: B2-PS-006 ───────────────────────────────────────────────

describe("MCP-SEC-004 / B2-PS-006: log and getRecent", () => {
  it("B2-PS-006: log() adds entry to in-memory buffer", () => {
    const log = new BrowserAuditLog();
    const entry: AuditEntry = {
      auditId: "fixed-id-001",
      timestamp: new Date().toISOString(),
      toolName: "test-tool",
      action: "allowed",
      redacted: false,
      durationMs: 10,
    };
    log.log(entry);
    const recent = log.getRecent(1);
    expect(recent).toHaveLength(1);
    expect(recent[0].auditId).toBe("fixed-id-001");
  });

  it("B2-PS-006: getRecent returns entries in reverse chronological order", () => {
    const log = new BrowserAuditLog();
    for (let i = 0; i < 5; i++) {
      const entry: AuditEntry = {
        auditId: `id-${i}`,
        timestamp: new Date().toISOString(),
        toolName: "test-tool",
        action: "allowed",
        redacted: false,
        durationMs: i,
      };
      log.log(entry);
    }
    const recent = log.getRecent(3);
    expect(recent).toHaveLength(3);
    // Newest first
    expect(recent[0].auditId).toBe("id-4");
    expect(recent[1].auditId).toBe("id-3");
    expect(recent[2].auditId).toBe("id-2");
  });

  it("B2-PS-006: getRecent(count) returns at most count entries", () => {
    const log = new BrowserAuditLog();
    for (let i = 0; i < 10; i++) {
      log.log({
        auditId: `id-${i}`,
        timestamp: new Date().toISOString(),
        toolName: "test-tool",
        action: "allowed",
        redacted: false,
        durationMs: i,
      });
    }
    expect(log.getRecent(3)).toHaveLength(3);
    expect(log.getRecent(100)).toHaveLength(10);
  });

  it("B2-PS-006: getRecent(0) returns empty array", () => {
    const log = new BrowserAuditLog();
    expect(log.getRecent(0)).toEqual([]);
  });

  it("B2-PS-006: completeEntry logs the entry automatically", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("test-tool", "https://example.com");
    log.completeEntry(entry, { action: "allowed", redacted: true, durationMs: 100 });
    // completeEntry should have called log() internally
    const recent = log.getRecent(1);
    expect(recent).toHaveLength(1);
    expect(recent[0].auditId).toBe(entry.auditId);
    expect(recent[0].redacted).toBe(true);
    expect(recent[0].durationMs).toBe(100);
  });
});

// ── flush: B2-PS-006 (file persistence) ────────────────────────────────────

describe("MCP-SEC-004 / B2-PS-006: flush — file persistence", () => {
  it("B2-PS-006: flush() returns a Promise that resolves", async () => {
    const log = new BrowserAuditLog();
    await expect(log.flush()).resolves.toBeUndefined();
  });

  it("B2-PS-006: flush() can be called multiple times", async () => {
    const log = new BrowserAuditLog();
    await log.flush();
    await log.flush(); // should not throw
  });

  it("B2-PS-006: Entries are flushed after being logged", async () => {
    const log = new BrowserAuditLog();
    log.log({
      auditId: "flush-test-001",
      timestamp: new Date().toISOString(),
      toolName: "test-tool",
      action: "allowed",
      redacted: false,
      durationMs: 50,
    });
    await log.flush();
    // After flush, the in-memory buffer should still have the entries
    const recent = log.getRecent(1);
    expect(recent[0].auditId).toBe("flush-test-001");
  });
});

// ── Ring buffer behavior ───────────────────────────────────────────────────

describe("BrowserAuditLog: ring buffer behavior", () => {
  it("Ring buffer: Does not exceed maxEntries", () => {
    const log = new BrowserAuditLog({ maxEntries: 5 });
    for (let i = 0; i < 20; i++) {
      log.log({
        auditId: `id-${i}`,
        timestamp: new Date().toISOString(),
        toolName: "test-tool",
        action: "allowed",
        redacted: false,
        durationMs: i,
      });
    }
    // In-memory buffer should cap at maxEntries
    expect(log.getRecent(100)).toHaveLength(5);
    // Newest entries preserved
    const recent = log.getRecent(1);
    expect(recent[0].auditId).toBe("id-19");
  });
});

// ── AuditEntry fields: B2-PS-006 ────────────────────────────────────────────

describe("MCP-SEC-004 / B2-PS-006: AuditEntry fields", () => {
  it("B2-PS-006: AuditEntry contains all required fields", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("accordo_browser_get_text_map", "https://example.com", "page-1");
    expect(entry).toHaveProperty("auditId");
    expect(entry).toHaveProperty("timestamp");
    expect(entry).toHaveProperty("toolName");
    expect(entry).toHaveProperty("origin");
    expect(entry).toHaveProperty("pageId");
    expect(entry).toHaveProperty("action");
    expect(entry).toHaveProperty("redacted");
  });

  it("B2-PS-006: origin is undefined when not provided", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("test-tool");
    expect(entry.origin).toBeUndefined();
  });

  it("B2-PS-006: pageId is undefined when not provided", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("test-tool");
    expect(entry.pageId).toBeUndefined();
  });

  it("B2-PS-006: durationMs is present after completeEntry", () => {
    const log = new BrowserAuditLog();
    const entry = log.createEntry("test-tool");
    log.completeEntry(entry, { action: "allowed", redacted: false, durationMs: 42 });
    expect(entry.durationMs).toBe(42);
  });
});
