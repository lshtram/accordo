/**
 * Runtime Directives — MCP Dispatch: Receipt Recording
 * Requirements: requirements-runtime-directives.md Y-07, Y-08
 *
 * API checklist:
 *   MockRuntimeDirectiveCatalog.recordReceipt() [3 tests]
 *
 * Phase B changes:
 * - Uses MockRuntimeDirectiveCatalog for deterministic behavior
 * - Adds explicit postcondition assertions for receipt storage
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { RuntimeDirectiveDeliveryReceipt } from "@accordo/bridge-types";
import {
  MockRuntimeDirectiveCatalog,
  makeReceipt,
  CANONICAL_BUNDLE_VERSION,
  CANONICAL_BUNDLE_DIGEST,
} from "./runtime-directives-fixtures.js";

function makeInitReceipt(sessionId: string): RuntimeDirectiveDeliveryReceipt {
  return makeReceipt({ sessionId, channel: "initialize" });
}

function makeInstrReceipt(sessionId: string): RuntimeDirectiveDeliveryReceipt {
  return makeReceipt({ sessionId, channel: "instructions" });
}

describe("MockRuntimeDirectiveCatalog — receipt recording postconditions (Y-07, Y-08)", () => {
  let catalog: MockRuntimeDirectiveCatalog;

  beforeEach(() => {
    catalog = new MockRuntimeDirectiveCatalog();
  });

  it("Y-08: recordReceipt() stores initialize receipt retrievable via listReceipts()", () => {
    const receipt = makeInitReceipt("session-init-1");
    catalog.recordReceipt(receipt);
    const receipts = catalog.listReceipts();
    expect(receipts.some(r => r.sessionId === "session-init-1" && r.channel === "initialize")).toBe(true);
  });

  it("Y-08: recordReceipt() stores instructions receipt with correct channel", () => {
    const receipt = makeInstrReceipt("session-instr-1");
    catalog.recordReceipt(receipt);
    const receipts = catalog.listReceipts();
    const found = receipts.find(r => r.sessionId === "session-instr-1");
    expect(found).toBeDefined();
    expect(found!.channel).toBe("instructions");
    expect(found!.bundleVersion).toBe(CANONICAL_BUNDLE_VERSION);
    expect(found!.bundleDigest).toBe(CANONICAL_BUNDLE_DIGEST);
  });

  it("Y-07: Multiple sessions each generate initialize and instructions receipts", () => {
    // Record 3 sessions, each with initialize and instructions
    for (const sid of ["session-a", "session-b", "session-c"]) {
      catalog.recordReceipt(makeInitReceipt(sid));
      catalog.recordReceipt(makeInstrReceipt(sid));
    }
    const receipts = catalog.listReceipts();
    expect(receipts).toHaveLength(6);

    // Verify each session has both channels
    for (const sid of ["session-a", "session-b", "session-c"]) {
      const sessionReceipts = receipts.filter(r => r.sessionId === sid);
      expect(sessionReceipts).toHaveLength(2);
      expect(sessionReceipts.some(r => r.channel === "initialize")).toBe(true);
      expect(sessionReceipts.some(r => r.channel === "instructions")).toBe(true);
    }
  });

  it("Y-08: Receipt fields are preserved accurately", () => {
    const receipt = makeReceipt({
      sessionId: "session-fields",
      agent: "code-agent/3.0",
      channel: "initialize",
      bundleVersion: "3.0.0",
      bundleDigest: "custom-digest",
      deliveredAt: "2026-04-25T20:00:00.000Z",
    });
    catalog.recordReceipt(receipt);
    const found = catalog.listReceipts().find(r => r.sessionId === "session-fields");
    expect(found).toMatchObject({
      sessionId: "session-fields",
      agent: "code-agent/3.0",
      channel: "initialize",
      bundleVersion: "3.0.0",
      bundleDigest: "custom-digest",
      deliveredAt: "2026-04-25T20:00:00.000Z",
    });
  });
});
