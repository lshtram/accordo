/**
 * spatial-validate-precedence.test.ts
 *
 * GAP-D1 — Validation Precedence Tests
 *
 * Verifies the authoritative precedence order:
 * 1. request shape/raw-count validation -> invalid-request
 * 2. snapshotId type/grammar validation -> invalid-request
 * 3. UID grammar/same-frame validation -> invalid-request
 * 4. nodeIds[] main-frame rule -> invalid-request
 * 5. Snapshot classification: current/stale/not-found
 *
 * Tests:
 * - malformed uids[] grammar beats stale snapshot classification
 * - mixed nodeIds+uids beats stale/unknown snapshot classification
 * - invalid snapshotId grammar beats otherwise-valid iframe uids[]
 * - mixed-frame uids[] + unknown snapshot -> invalid-request
 */

import { describe, it, expect, beforeEach } from "vitest";
import { validateSpatialShape } from "../src/content/spatial-relations-validator.js";
import { registerPageMapOwner, resetSnapshotRegistry } from "../src/content/spatial-snapshot-registry.js";

function makePayload(
  snapshotId: string,
  nodeIds?: number[],
  uids?: string[],
): Record<string, unknown> {
  return {
    snapshotId,
    ...(nodeIds !== undefined ? { nodeIds } : {}),
    ...(uids !== undefined ? { uids } : {}),
  };
}

describe("validation precedence", () => {
  beforeEach(() => {
    resetSnapshotRegistry();
  });

  it("malformed uids[] grammar beats stale snapshot classification", () => {
    registerPageMapOwner("page-001:1", "main");
    registerPageMapOwner("page-001:2", "main");
    const payload = makePayload("page-001:1", undefined, ["invalid-uid"]);
    const result = validateSpatialShape(payload);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBe("invalid-request");
  });

  it("mixed nodeIds+uids beats stale/unknown snapshot classification", () => {
    registerPageMapOwner("page-001:1", "main");
    registerPageMapOwner("page-001:2", "main");
    const payload = makePayload("page-001:1", [1, 2], ["main:3"]);
    const result = validateSpatialShape(payload);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBe("invalid-request");
  });

  it("invalid snapshotId grammar beats otherwise-valid iframe uids[]", () => {
    registerPageMapOwner("page-001:1", "iframe-embedded-0");
    const payload = makePayload("not-a-valid-snapshot-id", undefined, ["iframe-embedded-0:3"]);
    const result = validateSpatialShape(payload);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBe("invalid-request");
  });

  it("mixed-frame uids[] + unknown snapshot -> invalid-request", () => {
    const payload = makePayload("page-001:99", undefined, ["main:1", "iframe-embedded-0:2"]);
    const result = validateSpatialShape(payload);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBe("invalid-request");
  });
});
