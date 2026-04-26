import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCaptureRegion } from "../page-tool-handlers-impl.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { BrowserAuditLog, DEFAULT_REDACTION_PATTERNS, type SecurityConfig } from "../security/index.js";
import type { BrowserRelayLike } from "../types.js";

const ENVELOPE = {
  pageId: "p1",
  frameId: "main",
  snapshotId: "p1:1",
  capturedAt: "2025-01-01T00:00:00.000Z",
  viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  source: "dom" as const,
  pageUrl: "https://example.com",
  success: true,
  dataUrl: "data:image/png;base64,AAAA",
  width: 10,
  height: 10,
  sizeBytes: 4,
};

function createSecurity(patterns = DEFAULT_REDACTION_PATTERNS): SecurityConfig {
  return { originPolicy: { allowedOrigins: [], deniedOrigins: [], defaultAction: "allow" }, redactionPolicy: { redactPatterns: patterns, replacement: "[REDACTED]" }, auditLog: new BrowserAuditLog() };
}

function createRelay(data: Record<string, unknown>, payloads: Record<string, unknown>[]): BrowserRelayLike {
  return { request: vi.fn().mockImplementation(async (_action: string, payload: Record<string, unknown>) => { payloads.push({ ...payload }); return { success: true, requestId: "test", data }; }), isConnected: vi.fn(() => true) } as unknown as BrowserRelayLike;
}

afterEach(() => {
  delete process.env.ACCORDO_SCREENSHOTS_DIR;
});

describe("capture redaction warning contract", () => {
  it("explicit redactPII:false suppresses screenshot redaction attempts and warning", async () => {
    const payloads: Record<string, unknown>[] = [];
    const result = await handleCaptureRegion(createRelay({ ...ENVELOPE }, payloads), { redactPII: false, transport: "inline" }, new SnapshotRetentionStore(), createSecurity());
    expect(payloads[0]).not.toHaveProperty("redactPatterns");
    expect((result as any).redactionWarning).toBeUndefined();
    expect((result as any).screenshotRedactionApplied).not.toBe(true);
  });

  it("omitted and true preserve warning semantics when screenshot redaction was relevant but not applied", async () => {
    const omitted = await handleCaptureRegion(createRelay({ ...ENVELOPE }, []), { transport: "inline" }, new SnapshotRetentionStore(), createSecurity());
    const explicit = await handleCaptureRegion(createRelay({ ...ENVELOPE }, []), { redactPII: true, transport: "inline" }, new SnapshotRetentionStore(), createSecurity());
    expect((omitted as any).redactionWarning).toBe("screenshots-not-subject-to-redaction-policy");
    expect((explicit as any).redactionWarning).toBe("screenshots-not-subject-to-redaction-policy");
  });

  it("warning semantics are transport-neutral for explicit opt-out", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "accordo-shot-"));
    process.env.ACCORDO_SCREENSHOTS_DIR = dir;
    const inline = await handleCaptureRegion(createRelay({ ...ENVELOPE }, []), { redactPII: false, transport: "inline" }, new SnapshotRetentionStore(), createSecurity());
    const fileRef = await handleCaptureRegion(createRelay({ ...ENVELOPE }, []), { redactPII: false, transport: "file-ref" }, new SnapshotRetentionStore(), createSecurity());
    expect((inline as any).redactionWarning).toBeUndefined();
    expect((fileRef as any).redactionWarning).toBeUndefined();
  });
});
