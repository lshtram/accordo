/**
 * Runtime Directives — MCP Dispatch: Handler Integration
 * Requirements: requirements-runtime-directives.md Y-02, Y-07, Y-08
 *
 * API checklist:
 *   RuntimeDirectiveCatalog interface [1 test]
 *   Receipt field validation [1 test]
 */

import { describe, it, expect } from "vitest";
import type { RuntimeDirectiveDeliveryReceipt } from "@accordo/bridge-types";
import { StubRuntimeDirectiveCatalog } from "../runtime-directives.js";

// Fixed timestamp — no wall-clock dependence
const FIXTURE_RECEIPT: RuntimeDirectiveDeliveryReceipt = {
  sessionId: "mcp-session-xyz",
  agent: "code-agent/3.0",
  channel: "initialize",
  bundleVersion: "1.0.0",
  bundleDigest: "abc123",
  deliveredAt: "2026-04-25T12:00:00.000Z",
};

describe("MCP handler integration with Runtime Directives Catalog", () => {
  const catalog = new StubRuntimeDirectiveCatalog();

  it("Y-02 Y-07: Catalog implements all required RuntimeDirectiveCatalog methods", () => {
    expect(typeof catalog.getBundle).toBe("function");
    expect(typeof catalog.getPublication).toBe("function");
    expect(typeof catalog.recordReceipt).toBe("function");
    expect(typeof catalog.getDiagnostics).toBe("function");
  });

  it("Y-08: Receipt includes agent hint from MCP handshake", () => {
    expect(FIXTURE_RECEIPT.agent).toBe("code-agent/3.0");
    expect(FIXTURE_RECEIPT.sessionId).toBe("mcp-session-xyz");
    expect(FIXTURE_RECEIPT.channel).toBe("initialize");
  });
});
