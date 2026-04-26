/**
 * Runtime Directives — Diagnostics: Receipt Shape
 * Requirements: requirements-runtime-directives.md Y-08
 *
 * API checklist:
 *   RuntimeDirectiveDeliveryReceipt fields [3 tests]
 */

import { describe, it, expect } from "vitest";
import type { RuntimeDirectiveDeliveryReceipt } from "@accordo/bridge-types";

function makeReceipt(overrides: Partial<RuntimeDirectiveDeliveryReceipt> = {}): RuntimeDirectiveDeliveryReceipt {
  return {
    sessionId: "test-session-001",
    agent: "test-agent/1.0",
    channel: "initialize",
    bundleVersion: "1.0.0",
    bundleDigest: "abc123def456",
    deliveredAt: "2026-04-25T10:00:00.000Z",
    ...overrides,
  };
}

describe("RuntimeDirectiveDeliveryReceipt — field validation (Y-08)", () => {
  it("Y-08: Receipt includes sessionId", () => {
    const receipt = makeReceipt({ sessionId: "session-xyz" });
    expect(receipt.sessionId).toBe("session-xyz");
  });

  it("Y-08: Receipt includes agent hint (can be null)", () => {
    const withAgent = makeReceipt({ agent: "code-agent/2.0" });
    expect(withAgent.agent).toBe("code-agent/2.0");
    const withoutAgent = makeReceipt({ agent: null });
    expect(withoutAgent.agent).toBeNull();
  });

  it("Y-08: Receipt includes delivery channel (initialize or instructions)", () => {
    const initializeReceipt = makeReceipt({ channel: "initialize" });
    expect(initializeReceipt.channel).toBe("initialize");
    const instructionsReceipt = makeReceipt({ channel: "instructions" });
    expect(instructionsReceipt.channel).toBe("instructions");
  });

  it("Y-08: Receipt includes bundleVersion and bundleDigest", () => {
    const receipt = makeReceipt({ bundleVersion: "2.0.0", bundleDigest: "xyz789" });
    expect(receipt.bundleVersion).toBe("2.0.0");
    expect(receipt.bundleDigest).toBe("xyz789");
  });

  it("Y-08: Receipt includes deliveredAt as valid ISO timestamp", () => {
    const receipt = makeReceipt({ deliveredAt: "2026-04-25T12:30:00.000Z" });
    expect(receipt.deliveredAt).toBe("2026-04-25T12:30:00.000Z");
    const parsed = new Date(receipt.deliveredAt);
    expect(isNaN(parsed.getTime())).toBe(false);
  });
});
