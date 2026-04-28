/**
 * inspect-snapshot-proceed.test.ts
 *
 * Tests for M90-ACT — inspect_element proceeds when snapshot-scoped handle is valid.
 *
 * These tests validate:
 * - Valid current owner → proceeds to inspectElement and returns data
 * - Mixed valid requests preserve snapshot-scoped identity all the way into inspectElement()
 * - inspectElement is called with the snapshot-scoped handle, NOT anchorKey/selector
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import { routeInspectElement } from "../src/content/message-page-routing-helpers.js";
import * as elementInspector from "../src/content/element-inspector.js";
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

describe("M90-ACT snapshot-scoped handle proceeds when valid", () => {
  beforeEach(() => {
    resetChromeMocks();
    resetSnapshotRegistry();
    vi.clearAllMocks();
  });

  it("proceeds to inspectElement when creationSnapshotId is current owner", async () => {
    registerPageMapOwner("page:1", "main");
    const result = await routeInspectElement({
      uid: "main:5",
      creationSnapshotId: "page:1",
    });
    expect(result).toHaveProperty("data");
    expect(result).not.toHaveProperty("error");
  });

  it("proceeds to inspectElement when nodeId is provided with current owner", async () => {
    registerPageMapOwner("page:1", "main");
    const result = await routeInspectElement({
      nodeId: 5,
      creationSnapshotId: "page:1",
    });
    expect(result).toHaveProperty("data");
    expect(result).not.toHaveProperty("error");
  });

  it("passes validation when only anchorKey is provided (no snapshot-scoped handle)", async () => {
    const result = await routeInspectElement({ anchorKey: "id:test-element" });
    expect(result).toHaveProperty("data");
    expect(result).not.toHaveProperty("error");
  });

  it("passes validation when only selector is provided (no snapshot-scoped handle)", async () => {
    const result = await routeInspectElement({ selector: "#test-element" });
    expect(result).toHaveProperty("data");
    expect(result).not.toHaveProperty("error");
  });
});

describe("M90-ACT mixed valid requests preserve snapshot-scoped identity in inspectElement()", () => {
  beforeEach(() => {
    resetChromeMocks();
    resetSnapshotRegistry();
    vi.clearAllMocks();
  });

  it("ref+anchorKey with current owner → inspectElement receives ref, not anchorKey", async () => {
    registerPageMapOwner("page:2", "main");
    await routeInspectElement({
      ref: "node-ref-123",
      creationSnapshotId: "page:2",
      anchorKey: "id:fallback-element",
    });
    const inspectCalls = (elementInspector.inspectElement as ReturnType<typeof vi.fn>).mock.calls;
    expect(inspectCalls.length).toBeGreaterThan(0);
    const [args] = inspectCalls[inspectCalls.length - 1] as Record<string, unknown>[];
    expect(args).toHaveProperty("ref", "node-ref-123");
    expect(args).not.toHaveProperty("anchorKey");
  });

  it("nodeId+selector with current owner → inspectElement receives nodeId, not selector", async () => {
    registerPageMapOwner("page:2", "main");
    await routeInspectElement({
      nodeId: 5,
      creationSnapshotId: "page:2",
      selector: "#fallback-element",
    });
    const inspectCalls = (elementInspector.inspectElement as ReturnType<typeof vi.fn>).mock.calls;
    expect(inspectCalls.length).toBeGreaterThan(0);
    const [args] = inspectCalls[inspectCalls.length - 1] as Record<string, unknown>[];
    expect(args).toHaveProperty("nodeId", 5);
    expect(args).not.toHaveProperty("selector");
  });

  it("nodeId+anchorKey with current owner → inspectElement receives nodeId, not anchorKey", async () => {
    registerPageMapOwner("page:2", "main");
    await routeInspectElement({
      nodeId: 5,
      creationSnapshotId: "page:2",
      anchorKey: "id:fallback-element",
    });
    const inspectCalls = (elementInspector.inspectElement as ReturnType<typeof vi.fn>).mock.calls;
    expect(inspectCalls.length).toBeGreaterThan(0);
    const [args] = inspectCalls[inspectCalls.length - 1] as Record<string, unknown>[];
    expect(args).toHaveProperty("nodeId", 5);
    expect(args).not.toHaveProperty("anchorKey");
  });

  it("uid+anchorKey with current owner → inspectElement receives uid, not anchorKey", async () => {
    registerPageMapOwner("page:2", "main");
    await routeInspectElement({
      uid: "main:10",
      creationSnapshotId: "page:2",
      anchorKey: "id:fallback-element",
    });
    const inspectCalls = (elementInspector.inspectElement as ReturnType<typeof vi.fn>).mock.calls;
    expect(inspectCalls.length).toBeGreaterThan(0);
    const [args] = inspectCalls[inspectCalls.length - 1] as Record<string, unknown>[];
    expect(args).toHaveProperty("uid", "main:10");
    expect(args).not.toHaveProperty("anchorKey");
  });
});
