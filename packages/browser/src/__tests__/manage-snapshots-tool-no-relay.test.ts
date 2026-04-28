/**
 * manage-snapshots-tool-no-relay.test.ts
 *
 * Regression tests: manage_snapshots is a purely local tool.
 * It never calls relay.request regardless of relay.isConnected() state,
 * and must never return "unsupported-action".
 * Also covers: unknown action → invalid-request error.
 */

import { describe, it, expect, vi } from "vitest";
import { buildManageSnapshotsTool, type ManageSnapshotsArgs } from "../manage-snapshots-tool.js";
import { SnapshotRetentionStore as ConcreteStore } from "../snapshot-retention.js";
import type { BrowserRelayLike } from "../types.js";
import type { SnapshotEnvelopeFields } from "../types.js";

function makeEnvelope(pageId: string, version: number): SnapshotEnvelopeFields {
  return {
    pageId, frameId: "main",
    snapshotId: `${pageId}:${version}`,
    capturedAt: `2025-01-01T00:00:0${version}.000Z`,
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    source: "dom" as const,
  };
}

function connectedRelay() {
  return {
    request: vi.fn().mockResolvedValue({ success: false, error: "unsupported-action" }),
    isConnected: vi.fn(() => true),
  } as unknown as BrowserRelayLike;
}

describe("manage-snapshots-tool no-relay regression", () => {
  it("GAP-G1: list does NOT call relay.request even when isConnected()=true", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    const relay = connectedRelay();
    const tool = buildManageSnapshotsTool(relay, store);
    await (tool.handler as (a: unknown) => Promise<unknown>)({ action: "list" });
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("GAP-G1: clear does NOT call relay.request even when isConnected()=true", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    const relay = connectedRelay();
    const tool = buildManageSnapshotsTool(relay, store);
    await (tool.handler as (a: unknown) => Promise<unknown>)({ action: "clear" });
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("GAP-G1: result never contains 'unsupported-action'", async () => {
    const store = new ConcreteStore();
    const relay = connectedRelay();
    const tool = buildManageSnapshotsTool(relay, store);
    const handler = tool.handler as (a: unknown) => Promise<unknown>;
    const listR = await handler({ action: "list" });
    const clearR = await handler({ action: "clear" });
    expect(JSON.stringify(listR)).not.toContain("unsupported-action");
    expect(JSON.stringify(clearR)).not.toContain("unsupported-action");
  });

  it("GAP-G1: list returns correct local data even when relay would return unsupported-action", async () => {
    const store = new ConcreteStore();
    store.save("p1", makeEnvelope("p1", 1));
    const relay = connectedRelay();
    const tool = buildManageSnapshotsTool(relay, store);
    const r = await (tool.handler as (a: unknown) => Promise<unknown>)({ action: "list" }) as { pages: { pageId: string; snapshotCount: number }[] };
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0].pageId).toBe("p1");
    expect(r.pages[0].snapshotCount).toBe(1);
  });

  it("GAP-G1: unknown action returns { success: false, error: 'invalid-request' }", async () => {
    const store = new ConcreteStore();
    const relay = { request: vi.fn(), isConnected: vi.fn(() => false) } as unknown as BrowserRelayLike;
    const tool = buildManageSnapshotsTool(relay, store);
    const r = await (tool.handler as (a: unknown) => Promise<unknown>)({ action: "delete" } as ManageSnapshotsArgs);
    expect(r).toEqual({ success: false, error: "invalid-request" });
  });
});