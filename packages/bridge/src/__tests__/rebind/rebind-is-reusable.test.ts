/**
 * Tests for isReusableHubRebindOutcome() — LCM-15
 *
 * Phase B: stub returns false for all outcomes.
 * IS-01 (bridge-connected, registry-loaded → reusable=true): RED at assertion.
 * IS-02 (registry-missing/stale/unreachable/empty → NOT reusable): PASS-ELIGIBLE-IN-B
 *   — stub false, assertion false; matches stub. Serves as regression guard.
 *
 * API checklist:
 *   isReusableHubRebindOutcome(outcome)  [6 tests: IS-01 x2, IS-02 x4]
 *
 * Requirements: requirements-bridge.md §4 (LCM-15)
 */

import { describe, it, expect } from "vitest";
import { isReusableHubRebindOutcome } from "../../hub-rebind-probe.js";

describe("isReusableHubRebindOutcome — LCM-15: reuse only reusable outcomes", () => {
  it("IS-01: bridge-connected is reusable (non-pass-eligible)", () => {
    expect(isReusableHubRebindOutcome("bridge-connected")).toBe(true); // stub false → RED
  });

  it("IS-01: registry-loaded is reusable (non-pass-eligible)", () => {
    expect(isReusableHubRebindOutcome("registry-loaded")).toBe(true); // stub false → RED
  });

  it("IS-02: pass-eligible-in-B — registry-missing is NOT reusable", () => {
    expect(isReusableHubRebindOutcome("registry-missing")).toBe(false); // stub false, assert false → GREEN
  });

  it("IS-02: pass-eligible-in-B — registry-stale is NOT reusable", () => {
    expect(isReusableHubRebindOutcome("registry-stale")).toBe(false);
  });

  it("IS-02: pass-eligible-in-B — registry-unreachable is NOT reusable", () => {
    expect(isReusableHubRebindOutcome("registry-unreachable")).toBe(false);
  });

  it("IS-02: pass-eligible-in-B — registry-empty is NOT reusable", () => {
    expect(isReusableHubRebindOutcome("registry-empty")).toBe(false);
  });
});