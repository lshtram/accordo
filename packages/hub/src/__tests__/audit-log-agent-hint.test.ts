/**
 * Tests for AuditEntry denormalized agentHint (MS-05)
 * Requirements: multi-session-architecture.md §MS-05
 *
 * AuditEntry gains agentHint: string field (denormalized, not joined at query time).
 *
 * API checklist:
 *   AuditEntry — 5 tests
 *   writeAuditEntry — 3 tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  writeAuditEntry,
  hashArgs,
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
    tool: "accordo_editor_open",
    argsHash: hashArgs({ path: "/foo.ts" }),
    sessionId: "session-id-1",
    result: "success",
    durationMs: 42,
    agentHint: "opencode",  // MS-05: new required field
    ...overrides,
  };
}

// ── MS-05: AuditEntry agentHint denormalization ────────────────────────────────

describe("AuditEntry — agentHint denormalization (MS-05)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // MS-05.1: writeAuditEntry accepts agentHint parameter
  it("MS-05.1: writeAuditEntry accepts agentHint parameter in AuditEntry", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    const entry = makeEntry({ agentHint: "copilot" });
    writeAuditEntry(p, entry);

    const content = fs.readFileSync(p, "utf8").trim();
    const parsed = JSON.parse(content) as AuditEntry;
    expect(parsed.agentHint).toBe("copilot");
  });

  // MS-05.2: audit log JSONL entry contains agentHint field
  it("MS-05.2: audit log JSONL entry contains agentHint field", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    const entry = makeEntry({ agentHint: "claude" });
    writeAuditEntry(p, entry);

    const content = fs.readFileSync(p, "utf8").trim();
    const parsed = JSON.parse(content) as AuditEntry & { agentHint?: string };
    expect("agentHint" in parsed || Object.prototype.hasOwnProperty.call(parsed, "agentHint")).toBe(true);
    expect(parsed.agentHint).toBe("claude");
  });

  // MS-05.3: agentHint appears in audit entry for successful tool calls
  it("MS-05.3: agentHint is written for successful tool calls", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    writeAuditEntry(p, makeEntry({ tool: "accordo_editor_open", result: "success", agentHint: "opencode" }));

    const content = fs.readFileSync(p, "utf8").trim();
    const parsed = JSON.parse(content) as AuditEntry & { agentHint?: string };
    expect(parsed.agentHint).toBe("opencode");
    expect(parsed.result).toBe("success");
  });

  // MS-05.4: agentHint appears in audit entry for failed tool calls
  it("MS-05.4: agentHint is written for failed tool calls", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    writeAuditEntry(p, makeEntry({ tool: "accordo_editor_open", result: "error", agentHint: "copilot", errorMessage: "file not found" }));

    const content = fs.readFileSync(p, "utf8").trim();
    const parsed = JSON.parse(content) as AuditEntry & { agentHint?: string; errorMessage?: string };
    expect(parsed.agentHint).toBe("copilot");
    expect(parsed.result).toBe("error");
    expect(parsed.errorMessage).toBe("file not found");
  });

  // MS-05.5: Agent sessions without agentHint log "unknown" (not undefined/null)
  it("MS-05.5: when agentHint is not provided, 'unknown' is written", () => {
    const p = path.join(tmpDir, "audit.jsonl");
    // Pass agentHint as undefined — expect it to be normalized to "unknown"
    const entry = {
      ts: new Date().toISOString(),
      tool: "accordo_editor_open",
      argsHash: hashArgs({}),
      sessionId: "anon-session",
      result: "success" as const,
      durationMs: 1,
      // agentHint intentionally omitted — the implementation should normalize to "unknown"
      agentHint: undefined as unknown as string,
    };
    writeAuditEntry(p, entry as AuditEntry);

    const content = fs.readFileSync(p, "utf8").trim();
    const parsed = JSON.parse(content) as AuditEntry & { agentHint?: string };
    expect(parsed.agentHint).toBe("unknown");
  });
});