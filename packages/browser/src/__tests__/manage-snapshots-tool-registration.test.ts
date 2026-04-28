/**
 * manage-snapshots-tool-registration.test.ts
 *
 * Verifies the tool registration: name, description, inputSchema, dangerLevel, idempotent.
 */

import { describe, it, expect, vi } from "vitest";
import { buildManageSnapshotsTool } from "../manage-snapshots-tool.js";
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

const mockRelay = {
  request: vi.fn(),
  isConnected: vi.fn(() => false),
} as unknown as BrowserRelayLike;

describe("manage-snapshots-tool registration", () => {
  it("GAP-G1: tool name is accordo_browser_manage_snapshots", () => {
    const tool = buildManageSnapshotsTool(mockRelay, new ConcreteStore());
    expect(tool.name).toBe("accordo_browser_manage_snapshots");
  });

  it("GAP-G1: description mentions list and clear", () => {
    const tool = buildManageSnapshotsTool(mockRelay, new ConcreteStore());
    expect(tool.description).toContain("list");
    expect(tool.description).toContain("clear");
  });

  it("GAP-G1: inputSchema requires action", () => {
    const tool = buildManageSnapshotsTool(mockRelay, new ConcreteStore());
    expect((tool.inputSchema as { required: string[] }).required).toContain("action");
  });

  it("GAP-G1: inputSchema.action enum is [list, clear]", () => {
    const tool = buildManageSnapshotsTool(mockRelay, new ConcreteStore());
    const schema = tool.inputSchema as { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).toEqual(["list", "clear"]);
  });

  it("GAP-G1: inputSchema.pageId is optional string", () => {
    const tool = buildManageSnapshotsTool(mockRelay, new ConcreteStore());
    const schema = tool.inputSchema as { properties: Record<string, { type: string }>; required: string[] };
    expect(schema.properties.pageId.type).toBe("string");
    expect(schema.required).not.toContain("pageId");
  });

  it("GAP-G1: dangerLevel is safe", () => {
    const tool = buildManageSnapshotsTool(mockRelay, new ConcreteStore());
    expect(tool.dangerLevel).toBe("safe");
  });

  it("GAP-G1: idempotent is false", () => {
    const tool = buildManageSnapshotsTool(mockRelay, new ConcreteStore());
    expect(tool.idempotent).toBe(false);
  });
});