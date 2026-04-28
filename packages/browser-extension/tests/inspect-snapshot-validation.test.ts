/**
 * inspect-snapshot-validation.test.ts
 *
 * Tests for M90-ACT — inspect_element snapshot-scoped handle validation.
 *
 * These tests validate:
 * - uid/ref/nodeId without creationSnapshotId → invalid-request
 * - creationSnapshotId not a known page-map owner → snapshot-not-found
 * - creationSnapshotId known but not current owner → snapshot-stale
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import { routeInspectElement } from "../src/content/message-page-routing-helpers.js";
import { resetSnapshotRegistry, registerPageMapOwner } from "../src/content/spatial-snapshot-registry.js";

vi.mock("../src/content/element-inspector.js", () => ({
  inspectElement: vi.fn().mockReturnValue({
    found: true,
    snapshotId: "page:1",
    pageId: "page",
    frameId: "main",
    capturedAt: "2025-01-01T00:00:00.000Z",
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    source: "dom",
    anchorKey: "id:test-element",
    anchorStrategy: "id",
    anchorConfidence: "high",
  }),
}));

describe("M90-ACT snapshot-scoped handle validation", () => {
  beforeEach(() => {
    resetChromeMocks();
    resetSnapshotRegistry();
    vi.clearAllMocks();
  });

  it("returns invalid-request when uid is provided without creationSnapshotId", async () => {
    const result = await routeInspectElement({ uid: "main:5" });
    expect(result).toHaveProperty("error", "invalid-request");
  });

  it("returns invalid-request when ref is provided without creationSnapshotId", async () => {
    const result = await routeInspectElement({ ref: "node-ref-123" });
    expect(result).toHaveProperty("error", "invalid-request");
  });

  it("returns invalid-request when nodeId is provided without creationSnapshotId", async () => {
    const result = await routeInspectElement({ nodeId: 5 });
    expect(result).toHaveProperty("error", "invalid-request");
  });

  it("returns snapshot-not-found when creationSnapshotId is not a known page-map owner", async () => {
    const result = await routeInspectElement({
      uid: "main:5",
      creationSnapshotId: "page:999",
    });
    expect(result).toHaveProperty("error", "snapshot-not-found");
  });

  it("returns snapshot-stale when creationSnapshotId is known but not current owner", async () => {
    registerPageMapOwner("page:1", "main");
    registerPageMapOwner("page:2", "main");
    const result = await routeInspectElement({
      uid: "main:5",
      creationSnapshotId: "page:1",
    });
    expect(result).toHaveProperty("error", "snapshot-stale");
  });
});
