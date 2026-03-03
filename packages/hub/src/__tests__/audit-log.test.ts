/**
 * Tests for audit-log.ts
 * Requirements: requirements-hub.md §7
 *
 * All functions (hashArgs, rotateIfNeeded, writeAuditEntry) throw
 * "not implemented" on stubs → all tests here are RED until Phase C.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  hashArgs,
  rotateIfNeeded,
  writeAuditEntry,
  AUDIT_ROTATION_SIZE_BYTES,
} from "../audit-log.js";
import type { AuditEntry } from "../audit-log.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "accordo-audit-test-"));
}

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    ts: new Date().toISOString(),
    tool: "accordo.editor.open",
    argsHash: "abc123",
    sessionId: "session-id-1",
    result: "success",
    durationMs: 42,
    ...overrides,
  };
}

// ── AUDIT_ROTATION_SIZE_BYTES ─────────────────────────────────────────────────

describe("AUDIT_ROTATION_SIZE_BYTES", () => {
  it("§7: rotation threshold is 10 MB", () => {
    expect(AUDIT_ROTATION_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });
});

// ── hashArgs ──────────────────────────────────────────────────────────────────

describe("hashArgs", () => {
  it("§7: returns a string", () => {
    expect(typeof hashArgs({})).toBe("string");
  });

  it("§7: returns a 64-character hex string (SHA-256)", () => {
    const result = hashArgs({ path: "/foo.ts" });
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("§7: same args produce the same hash", () => {
    const args = { path: "/foo.ts", line: 1 };
    expect(hashArgs(args)).toBe(hashArgs(args));
  });

  it("§7: different args produce different hashes", () => {
    expect(hashArgs({ path: "/a.ts" })).not.toBe(hashArgs({ path: "/b.ts" }));
  });

  it("§7: empty object produces a valid hash", () => {
    expect(hashArgs({})).toMatch(/^[0-9a-f]{64}$/);
  });

  it("§7: args with nested objects hash consistently", () => {
    const args = { a: { b: { c: 1 } } };
    expect(hashArgs(args)).toBe(hashArgs(args));
  });
});

// ── rotateIfNeeded ────────────────────────────────────────────────────────────

describe("rotateIfNeeded", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("§7: no-op when file does not exist", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    expect(() => rotateIfNeeded(p)).not.toThrow();
    expect(fs.existsSync(p)).toBe(false);
  });

  it("§7: no-op when file is below rotation threshold", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    fs.writeFileSync(p, "x".repeat(100));
    rotateIfNeeded(p);
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "audit.1.jsonl"))).toBe(false);
  });

  it("§7: no-op when file is exactly one byte below threshold", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    fs.writeFileSync(p, Buffer.alloc(AUDIT_ROTATION_SIZE_BYTES - 1));
    rotateIfNeeded(p);
    expect(fs.existsSync(path.join(tmpDir, "audit.1.jsonl"))).toBe(false);
  });

  it("§7: rotates when file size equals rotation threshold", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    fs.writeFileSync(p, Buffer.alloc(AUDIT_ROTATION_SIZE_BYTES));
    rotateIfNeeded(p);
    expect(fs.existsSync(path.join(tmpDir, "audit.1.jsonl"))).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it("§7: rotates when file size exceeds rotation threshold", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    fs.writeFileSync(p, Buffer.alloc(AUDIT_ROTATION_SIZE_BYTES + 1));
    rotateIfNeeded(p);
    expect(fs.existsSync(path.join(tmpDir, "audit.1.jsonl"))).toBe(true);
  });

  it("§7: original file is removed after rotation", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    fs.writeFileSync(p, Buffer.alloc(AUDIT_ROTATION_SIZE_BYTES + 1));
    rotateIfNeeded(p);
    expect(fs.existsSync(p)).toBe(false);
  });

  it("§7: overwrites existing audit.1.jsonl on rotation (max 2 files)", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    const rotated = path.join(tmpDir, "audit.1.jsonl");
    fs.writeFileSync(rotated, "old-backup");
    fs.writeFileSync(p, Buffer.alloc(AUDIT_ROTATION_SIZE_BYTES + 1));
    rotateIfNeeded(p);
    // The previous .1.jsonl is overwritten with the rotated file
    expect(fs.existsSync(rotated)).toBe(true);
    const content = fs.readFileSync(rotated);
    // Content is the big file, not the old "old-backup"
    expect(content.length).toBeGreaterThan(10);
  });

  it("§7: no audit.2.jsonl is ever created (maximum 2 files retained)", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    fs.writeFileSync(p, Buffer.alloc(AUDIT_ROTATION_SIZE_BYTES + 1));
    rotateIfNeeded(p);
    expect(fs.existsSync(path.join(tmpDir, "audit.2.jsonl"))).toBe(false);
  });
});

// ── writeAuditEntry ───────────────────────────────────────────────────────────

describe("writeAuditEntry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("§7: creates the file if it does not exist", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    writeAuditEntry(p, makeEntry());
    expect(fs.existsSync(p)).toBe(true);
  });

  it("§7: creates parent directories if they do not exist", () => {
    const p = path.join(tmpDir, "nested", "deep", "audit.jsonl");
    writeAuditEntry(p, makeEntry());
    expect(fs.existsSync(p)).toBe(true);
  });

  it("§7: writes a valid JSON line", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    const entry = makeEntry({ tool: "accordo.editor.close", result: "success" });
    writeAuditEntry(p, entry);
    const line = fs.readFileSync(p, "utf8").trim();
    expect(() => JSON.parse(line)).not.toThrow();
  });

  it("§7: written entry has all required fields", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    const entry = makeEntry();
    writeAuditEntry(p, entry);
    const parsed = JSON.parse(fs.readFileSync(p, "utf8").trim()) as AuditEntry;
    expect(parsed.ts).toBeDefined();
    expect(parsed.tool).toBe("accordo.editor.open");
    expect(parsed.argsHash).toBe("abc123");
    expect(parsed.sessionId).toBe("session-id-1");
    expect(parsed.result).toBe("success");
    expect(typeof parsed.durationMs).toBe("number");
  });

  it("§7: appends multiple entries on successive calls", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    writeAuditEntry(p, makeEntry({ tool: "accordo.editor.open" }));
    writeAuditEntry(p, makeEntry({ tool: "accordo.editor.close" }));
    const lines = fs.readFileSync(p, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
  });

  it("§7: each line is independently valid JSON", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    writeAuditEntry(p, makeEntry({ tool: "accordo.editor.open" }));
    writeAuditEntry(p, makeEntry({ tool: "accordo.editor.close" }));
    const lines = fs.readFileSync(p, "utf8").trim().split("\n");
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("§7: errorMessage field is present when result is 'error'", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    writeAuditEntry(p, makeEntry({ result: "error", errorMessage: "not found" }));
    const parsed = JSON.parse(fs.readFileSync(p, "utf8").trim()) as AuditEntry;
    expect(parsed.errorMessage).toBe("not found");
  });

  it("§7: errorMessage field is absent when result is 'success'", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    writeAuditEntry(p, makeEntry({ result: "success" }));
    const parsed = JSON.parse(fs.readFileSync(p, "utf8").trim()) as AuditEntry;
    expect(parsed.errorMessage).toBeUndefined();
  });

  it("§7: calls rotateIfNeeded before writing (rotation-check on every write)", () => {
    // A file at exactly the rotation threshold should be rotated before writing
    const p = path.join(tmpDir, "audit.jsonl");
    fs.writeFileSync(p, Buffer.alloc(AUDIT_ROTATION_SIZE_BYTES));
    writeAuditEntry(p, makeEntry());
    // The big file should have been rotated to .1.jsonl; new entry goes to fresh audit.jsonl
    expect(fs.existsSync(path.join(tmpDir, "audit.1.jsonl"))).toBe(true);
    const newContent = fs.readFileSync(p, "utf8").trim();
    const parsed = JSON.parse(newContent) as AuditEntry;
    expect(parsed.tool).toBe("accordo.editor.open");
  });
});
