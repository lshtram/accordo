/**
 * spatial-handler-classification.test.ts
 *
 * GAP-D1 — Handler Snapshot Classification Precedence Tests
 *
 * Verifies that snapshot classification (step 5) correctly precedes
 * owner-frame contract checks (step 6):
 * - iframe stale snapshot + same-frame iframe uids[] -> snapshot-stale
 * - unknown snapshot + same-frame iframe uids[] -> snapshot-not-found
 * - malformed uids[] + stale snapshot -> invalid-request (grammar first)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { handleGetSpatialRelationsAction } from "../src/content/spatial-relations-handler.js";
import {
  registerPageMapOwner,
  resetSnapshotRegistry,
  getOwnerSnapshotId,
} from "../src/content/spatial-snapshot-registry.js";

function makePayload(
  snapshotId: string,
  uids?: string[],
): Record<string, unknown> {
  return {
    snapshotId,
    ...(uids !== undefined ? { uids } : {}),
  };
}

describe("snapshot classification precedes owner-frame check", () => {
  beforeEach(() => {
    resetSnapshotRegistry();
  });

  it("iframe stale snapshot + same-frame iframe uids[] -> snapshot-stale", () => {
    registerPageMapOwner("page-001:1", "iframe-embedded-0");
    registerPageMapOwner("page-001:2", "main");
    const result = handleGetSpatialRelationsAction(
      makePayload("page-001:1", ["iframe-embedded-0:1"]),
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("snapshot-stale");
  });

  it("unknown snapshot + same-frame iframe uids[] -> snapshot-not-found", () => {
    const result = handleGetSpatialRelationsAction(
      makePayload("page-001:99", ["iframe-embedded-0:1"]),
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("snapshot-not-found");
  });
});

describe("malformed uids[] grammar precedes snapshot classification", () => {
  beforeEach(() => {
    resetSnapshotRegistry();
  });

  it("malformed uid format + stale snapshot -> invalid-request", () => {
    registerPageMapOwner("page-001:1", "main");
    registerPageMapOwner("page-001:2", "main");
    const result = handleGetSpatialRelationsAction(
      makePayload("page-001:1", ["invalid-no-colon"]),
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("invalid-request");
  });

  it("mixed nodeIds+uids + stale snapshot -> invalid-request", () => {
    registerPageMapOwner("page-001:1", "main");
    registerPageMapOwner("page-001:2", "main");
    const payload = { snapshotId: "page-001:1", nodeIds: [1], uids: ["main:2"] };
    const result = handleGetSpatialRelationsAction(payload);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("invalid-request");
  });

  it("adapter-emitted empty uids placeholder does not make nodeIds mixed", () => {
    registerPageMapOwner("page-001:1", "main");
    const payload = { snapshotId: "page-001:1", nodeIds: [1, 2], uids: [""] };
    const result = handleGetSpatialRelationsAction(payload);
    expect(result).toHaveProperty("data");
  });

  it("multiple or whitespace uid placeholders remain invalid when nodeIds is active", () => {
    registerPageMapOwner("page-001:1", "main");
    const multiple = handleGetSpatialRelationsAction({ snapshotId: "page-001:1", nodeIds: [1, 2], uids: ["", ""] });
    expect(multiple).toHaveProperty("error");
    expect((multiple as { error: string }).error).toBe("invalid-request");
    const whitespace = handleGetSpatialRelationsAction({ snapshotId: "page-001:1", nodeIds: [1, 2], uids: [" "] });
    expect(whitespace).toHaveProperty("error");
    expect((whitespace as { error: string }).error).toBe("invalid-request");
  });

  it("null nodeIds placeholders remain invalid when uids mode is active", () => {
    registerPageMapOwner("page-001:1", "main");
    const payload = { snapshotId: "page-001:1", nodeIds: [null], uids: ["main:1"] };
    const result = handleGetSpatialRelationsAction(payload);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("invalid-request");
  });
});

describe("get_spatial_relations does NOT register snapshots", () => {
  beforeEach(() => {
    resetSnapshotRegistry();
  });

  it("handler call does not change current owner", () => {
    registerPageMapOwner("page-001:1", "main");
    registerPageMapOwner("page-001:2", "iframe-embedded-0");
    const originalOwner = getOwnerSnapshotId();
    handleGetSpatialRelationsAction(makePayload("page-001:1", ["main:999"]));
    expect(getOwnerSnapshotId()).toBe(originalOwner);
  });
});
