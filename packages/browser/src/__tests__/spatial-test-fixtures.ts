/**
 * spatial-test-fixtures.ts
 *
 * GAP-D1 — Shared test fixtures for spatial-relations tests.
 * All spatial-relations test files import from here.
 *
 * @module
 */

import { vi } from "vitest";
import type { BrowserRelayLike } from "../../types.js";
import type { GetSpatialRelationsArgs, SpatialRelationsResponse } from "../../page-tool-types.js";
import type { SpatialRelationsToolError } from "../../spatial-relations-tool.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { buildSpatialRelationsTool } from "../spatial-relations-tool.js";

/** Mock SnapshotEnvelope fields */
export const MOCK_ENVELOPE = {
  pageId: "mock-page-001",
  frameId: "main",
  snapshotId: "mock-page-001:1",
  capturedAt: "2025-01-01T00:00:00.000Z",
  viewport: { width: 1920, height: 1080, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  source: "dom" as const,
};

/** Mock spatial relations response from content script */
export const MOCK_SPATIAL_RELATIONS_DATA: SpatialRelationsResponse = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/page",
  relations: [
    { sourceNodeId: 1, targetNodeId: 2, leftOf: true, above: false, contains: false, containedBy: false, overlap: 2500 / 17500, distance: 200 },
    { sourceNodeId: 1, targetNodeId: 3, leftOf: false, above: true, contains: false, containedBy: false, overlap: 0.25, distance: 200 },
    { sourceNodeId: 2, targetNodeId: 3, leftOf: true, above: true, contains: false, containedBy: false, overlap: 0, distance: Math.SQRT2 * 200 },
  ],
  nodeCount: 3,
  pairCount: 3,
};

/** Mock relay factory */
export function createMockRelay(overrides?: Partial<{
  connected: boolean;
  response: ReturnType<BrowserRelayLike["request"]>;
}>) {
  const defaults = {
    connected: true,
    response: Promise.resolve({ success: true, requestId: "test", data: MOCK_SPATIAL_RELATIONS_DATA }),
  };
  const { connected = defaults.connected, response = defaults.response } = overrides ?? {};
  return {
    request: vi.fn().mockImplementation(() => response),
    push: vi.fn(),
    isConnected: vi.fn(() => connected),
  } as unknown as BrowserRelayLike;
}

/** Invoke tool handler with full args */
export async function invokeToolHandler(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  args: Partial<GetSpatialRelationsArgs> = { nodeIds: [1, 2, 3] },
): Promise<SpatialRelationsResponse | SpatialRelationsToolError> {
  const fullArgs: GetSpatialRelationsArgs = { snapshotId: "mock-page-001:1", ...args };
  const tool = buildSpatialRelationsTool(relay, store);
  return (tool.handler as (args: GetSpatialRelationsArgs) => Promise<SpatialRelationsResponse | SpatialRelationsToolError>)(fullArgs);
}
