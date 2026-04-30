/**
 * inspect-no-fallback.test.ts
 *
 * Tests for M90-ACT — inspect_element no-fallback when snapshot-scoped handle present.
 *
 * Per approved design:
 * - uid/ref/nodeId are snapshot-scoped handles from get_page_map
 * - anchorKey/selector are current-DOM paths
 * - uid/ref/nodeId snapshot-scoped handles outrank current-DOM paths when creationSnapshotId is non-empty
 * - anchorKey/selector current-DOM paths outrank adapter-emitted nodeId when creationSnapshotId is empty
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

describe("M90-ACT no-fallback to current-DOM paths when snapshot-scoped handle present", () => {
  beforeEach(() => {
    resetChromeMocks();
    resetSnapshotRegistry();
    vi.clearAllMocks();
  });

  it("does NOT fall back to selector when uid is invalid (snapshot-not-found)", async () => {
    const result = await routeInspectElement({
      uid: "main:5",
      creationSnapshotId: "page:999",
      selector: "#fallback-element",
    });
    expect(result).toHaveProperty("error", "snapshot-not-found");
    expect(result).not.toHaveProperty("data");
  });

  it("does NOT fall back to selector when uid is stale", async () => {
    registerPageMapOwner("page:1", "main");
    registerPageMapOwner("page:2", "main");
    const result = await routeInspectElement({
      uid: "main:5",
      creationSnapshotId: "page:1",
      selector: "#fallback-element",
    });
    expect(result).toHaveProperty("error", "snapshot-stale");
    expect(result).not.toHaveProperty("data");
  });

  it("does NOT fall back to anchorKey when ref is stale", async () => {
    registerPageMapOwner("page:1", "main");
    registerPageMapOwner("page:2", "main");
    const result = await routeInspectElement({
      ref: "node-ref-123",
      creationSnapshotId: "page:1",
      anchorKey: "id:fallback-element",
    });
    expect(result).toHaveProperty("error", "snapshot-stale");
    expect(result).not.toHaveProperty("data");
  });

  it("does NOT fall back to anchorKey when nodeId is stale", async () => {
    registerPageMapOwner("page:1", "main");
    registerPageMapOwner("page:2", "main");
    const result = await routeInspectElement({
      nodeId: 5,
      creationSnapshotId: "page:1",
      anchorKey: "id:fallback-element",
    });
    expect(result).toHaveProperty("error", "snapshot-stale");
    expect(result).not.toHaveProperty("data");
  });

  it("does NOT fall back to selector when nodeId is stale", async () => {
    registerPageMapOwner("page:1", "main");
    registerPageMapOwner("page:2", "main");
    const result = await routeInspectElement({
      nodeId: 5,
      creationSnapshotId: "page:1",
      selector: "#fallback-element",
    });
    expect(result).toHaveProperty("error", "snapshot-stale");
    expect(result).not.toHaveProperty("data");
  });

  it("does NOT fall back to anchorKey when ref is invalid (snapshot-not-found)", async () => {
    const result = await routeInspectElement({
      ref: "node-ref-123",
      creationSnapshotId: "page:999",
      anchorKey: "id:fallback-element",
    });
    expect(result).toHaveProperty("error", "snapshot-not-found");
    expect(result).not.toHaveProperty("data");
  });
});
