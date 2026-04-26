/**
 * Runtime Directives — Diagnostics: Publication and Catalog Behavior
 * Requirements: requirements-runtime-directives.md Y-06, Y-07, Y-08
 *
 * API checklist:
 *   StubRuntimeDirectiveCatalog.recordReceipt() [2 tests]
 *   StubRuntimeDirectiveCatalog.getDiagnostics() [2 tests]
 *   Diagnostics parity with /runtime-directives [1 test]
 *
 * Phase B changes:
 * - Uses MockRuntimeDirectiveCatalog for deterministic behavior
 * - Adds explicit postcondition assertions for receipt storage
 */

import { describe, it, expect, beforeEach } from "vitest";
import { StubRuntimeDirectiveCatalog } from "../runtime-directives.js";
import {
  MockRuntimeDirectiveCatalog,
  makeReceipt,
  CANONICAL_BUNDLE_VERSION,
  CANONICAL_BUNDLE_DIGEST,
} from "./runtime-directives-fixtures.js";

describe("MockRuntimeDirectiveCatalog — recordReceipt postconditions (Y-08)", () => {
  let catalog: MockRuntimeDirectiveCatalog;

  beforeEach(() => {
    catalog = new MockRuntimeDirectiveCatalog();
  });

  it("Y-08: recordReceipt() stores receipt retrievable via getDiagnostics()", () => {
    const receipt = makeReceipt({ sessionId: "session-postcond-1" });
    catalog.recordReceipt(receipt);
    const diagnostics = catalog.getDiagnostics();
    const found = diagnostics.receipts.find(r => r.sessionId === "session-postcond-1");
    expect(found).toBeDefined();
    expect(found!.channel).toBe("initialize");
    expect(found!.bundleVersion).toBe(CANONICAL_BUNDLE_VERSION);
    expect(found!.bundleDigest).toBe(CANONICAL_BUNDLE_DIGEST);
  });

  it("Y-08: Multiple receipts for same session different channels are recordable", () => {
    const initReceipt = makeReceipt({ sessionId: "session-multi", channel: "initialize" });
    const instrReceipt = makeReceipt({ sessionId: "session-multi", channel: "instructions" });
    catalog.recordReceipt(initReceipt);
    catalog.recordReceipt(instrReceipt);
    const diagnostics = catalog.getDiagnostics();
    const sessionReceipts = diagnostics.receipts.filter(r => r.sessionId === "session-multi");
    expect(sessionReceipts).toHaveLength(2);
    expect(sessionReceipts.some(r => r.channel === "initialize")).toBe(true);
    expect(sessionReceipts.some(r => r.channel === "instructions")).toBe(true);
  });

  it("Y-08: Each recorded receipt has all required fields preserved", () => {
    const receipt = makeReceipt({
      sessionId: "session-full-1",
      agent: "code-agent/2.0",
      channel: "initialize",
      bundleVersion: "2.1.0",
      bundleDigest: "digest-abc",
      deliveredAt: "2026-04-25T15:30:00.000Z",
    });
    catalog.recordReceipt(receipt);
    const diagnostics = catalog.getDiagnostics();
    const found = diagnostics.receipts.find(r => r.sessionId === "session-full-1");
    expect(found).toMatchObject({
      sessionId: "session-full-1",
      agent: "code-agent/2.0",
      channel: "initialize",
      bundleVersion: "2.1.0",
      bundleDigest: "digest-abc",
      deliveredAt: "2026-04-25T15:30:00.000Z",
    });
  });
});

describe("MockRuntimeDirectiveCatalog — getDiagnostics (Y-06, Y-08)", () => {
  let catalog: MockRuntimeDirectiveCatalog;

  beforeEach(() => {
    catalog = new MockRuntimeDirectiveCatalog();
  });

  it("Y-06: getDiagnostics() returns diagnostics with publication and receipts array", () => {
    const diagnostics = catalog.getDiagnostics();
    expect(diagnostics).toHaveProperty("publication");
    expect(diagnostics).toHaveProperty("receipts");
    expect(Array.isArray(diagnostics.receipts)).toBe(true);
  });

  it("Y-06: Diagnostics publication contains bundle with version and digest", () => {
    const diagnostics = catalog.getDiagnostics();
    expect(diagnostics.publication.bundle.version).toBe(CANONICAL_BUNDLE_VERSION);
    expect(diagnostics.publication.bundle.digest).toBe(CANONICAL_BUNDLE_DIGEST);
  });

  it("Y-08: Diagnostics receipts array accumulates recorded receipts", () => {
    expect(catalog.getDiagnostics().receipts).toHaveLength(0);
    catalog.recordReceipt(makeReceipt({ sessionId: "acc-1" }));
    catalog.recordReceipt(makeReceipt({ sessionId: "acc-2" }));
    expect(catalog.getDiagnostics().receipts).toHaveLength(2);
  });
});

describe("MockRuntimeDirectiveCatalog — Diagnostics parity with publication (Y-06, Y-07)", () => {
  let catalog: MockRuntimeDirectiveCatalog;

  beforeEach(() => {
    catalog = new MockRuntimeDirectiveCatalog();
  });

  it("Y-07: getDiagnostics().publication matches getPublication()", () => {
    const publication = catalog.getPublication();
    const diagnostics = catalog.getDiagnostics();
    expect(diagnostics.publication.bundle.version).toBe(publication.bundle.version);
    expect(diagnostics.publication.bundle.digest).toBe(publication.bundle.digest);
    expect(diagnostics.publication.ownership).toEqual(publication.ownership);
  });
});

// ── Stub throw tests (pass-eliigible in B) ─────────────────────────────────

describe("StubRuntimeDirectiveCatalog — stub behavior (pass-eligible B)", () => {
  const catalog = new StubRuntimeDirectiveCatalog();

  it("Y-08: recordReceipt() throws not implemented", () => {
    expect(() => catalog.recordReceipt(makeReceipt())).toThrow("not implemented");
  });

  it("Y-06: getDiagnostics() throws not implemented", () => {
    expect(() => catalog.getDiagnostics()).toThrow("not implemented");
  });
});
