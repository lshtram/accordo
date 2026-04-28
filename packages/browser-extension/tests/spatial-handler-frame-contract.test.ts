/**
 * spatial-handler-frame-contract.test.ts
 *
 * GAP-D1 — Handler Owner-Frame Contract Tests
 *
 * Tests owner-frame contract enforcement at handler level:
 * - nodeIds[] main-frame-only rule
 * - uids[] same-frame rule
 */

import { describe, it, expect, beforeEach } from "vitest";
import { handleGetSpatialRelationsAction } from "../src/content/spatial-relations-handler.js";
import {
  registerPageMapOwner,
  resetSnapshotRegistry,
} from "../src/content/spatial-snapshot-registry.js";

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

describe("nodeIds[] main-frame-only rule", () => {
  beforeEach(() => {
    resetSnapshotRegistry();
  });

  it("iframe snapshot + nodeIds[] -> invalid-request", () => {
    registerPageMapOwner("page-001:1", "iframe-embedded-0");
    const result = handleGetSpatialRelationsAction(makePayload("page-001:1", [1, 2, 3]));
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("invalid-request");
  });

  it("main-frame snapshot + nodeIds[] proceeds (frame allowed)", () => {
    registerPageMapOwner("page-001:1", "main");
    const el = document.createElement("div");
    el.setAttribute("data-ref", "ref-1");
    document.body.appendChild(el);
    const result = handleGetSpatialRelationsAction(makePayload("page-001:1", [1]));
    // Not invalid-request for frame reason
    if ("error" in result) {
      expect((result as { error: string }).error).not.toBe("invalid-request");
    }
  });
});

describe("uids[] frame mismatch rule", () => {
  beforeEach(() => {
    resetSnapshotRegistry();
  });

  it("snapshotId(main) + same-frame iframe uids[] -> invalid-request", () => {
    registerPageMapOwner("page-001:1", "main");
    const result = handleGetSpatialRelationsAction(
      makePayload("page-001:1", undefined, ["iframe-embedded-0:1", "iframe-embedded-0:2"]),
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("invalid-request");
  });

  it("snapshotId(iframe) + same-frame main uids[] -> invalid-request", () => {
    registerPageMapOwner("page-001:1", "iframe-embedded-0");
    const result = handleGetSpatialRelationsAction(
      makePayload("page-001:1", undefined, ["main:1", "main:2"]),
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("invalid-request");
  });

  it("same-frame iframe uids[] + iframe owner proceeds (frame matches)", () => {
    registerPageMapOwner("page-001:1", "iframe-embedded-0");
    const result = handleGetSpatialRelationsAction(
      makePayload("page-001:1", undefined, ["iframe-embedded-0:1"]),
    );
    // Not invalid-request for frame mismatch
    if ("error" in result) {
      expect((result as { error: string }).error).not.toBe("invalid-request");
    }
  });
});
