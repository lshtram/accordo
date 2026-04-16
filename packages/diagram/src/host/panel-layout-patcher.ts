/**
 * Diagram Modularity — Layout patcher.
 *
 * Applies in-memory layout patches from canvas interactions (move, resize,
 * style, edge waypoints) and schedules debounced disk writes.
 *
 * Layer: L4 (host/) — may import vscode, L0..L3.
 * Source: docs/reviews/diagram-modularity-A.md §panel-layout-patcher.ts
 */

import { readFile, writeFile } from "node:fs/promises";
import { layoutPathFor } from "../layout/layout-store.js";
import { patchNode, patchEdge } from "../layout/layout-store.js";
import type { LayoutStore } from "../types.js";
import type { HostContext } from "./host-context.js";

// ── patchLayout ──────────────────────────────────────────────────────────────

/**
 * Apply an in-memory layout patch and schedule a debounced async disk write.
 *
 * If `state._currentLayout` is null (initial load not yet complete), the
 * mutation is dropped — loadAndPost will write the real layout.
 *
 * @param ctx   - Host context (uses state for layout cache and timers).
 * @param apply - Pure function that returns the patched layout.
 */
export function patchLayout(
  ctx: HostContext,
  apply: (layout: LayoutStore) => LayoutStore,
): void {
  const state = ctx.state;

  // FIX: If _currentLayout is null, the initial layout hasn't loaded yet.
  // Drop this mutation — the real layout will be written by loadAndPost.
  if (state._currentLayout === null) {
    return;
  }

  const layoutPath = layoutPathFor(state.mmdPath, state._workspaceRoot);
  const base = state._currentLayout;
  state._currentLayout = apply(base);

  if (state._layoutWriteTimer !== null) clearTimeout(state._layoutWriteTimer);
  state._layoutWriteTimer = setTimeout(() => {
    state._layoutWriteTimer = null;
    const snapshot = state._currentLayout;
    if (snapshot === null) return;
    writeLayout(layoutPath, snapshot).catch(() => {
      // Non-fatal: the next _loadAndPost or interaction will write again.
    });
  }, 100);
}

async function writeLayout(path: string, layout: LayoutStore): Promise<void> {
  await writeFile(path, JSON.stringify(layout, null, 2), "utf8");
}

// ── handleNodeMoved ──────────────────────────────────────────────────────────

/**
 * Handle canvas:node-moved — patches x,y for the given nodeId.
 *
 * Calls _testHandleNodeMoved override if set, otherwise applies the patch.
 *
 * @param ctx    - Host context.
 * @param nodeId - Mermaid node ID that was moved.
 * @param x      - New x position.
 * @param y      - New y position.
 */
export function handleNodeMoved(
  ctx: HostContext,
  nodeId: string,
  x: number,
  y: number,
): void {
  if (ctx._testHandleNodeMoved) {
    ctx._testHandleNodeMoved(nodeId, x, y);
    return;
  }
  patchLayout(ctx, (layout) => patchNode(layout, nodeId, { x, y }));
}

// ── handleNodeResized ────────────────────────────────────────────────────────

/**
 * Handle canvas:node-resized — patches w,h for the given nodeId.
 *
 * Calls _testHandleNodeResized override if set, otherwise applies the patch.
 *
 * @param ctx    - Host context.
 * @param nodeId - Mermaid node ID that was resized.
 * @param w      - New width.
 * @param h      - New height.
 */
export function handleNodeResized(
  ctx: HostContext,
  nodeId: string,
  w: number,
  h: number,
): void {
  if (ctx._testHandleNodeResized) {
    ctx._testHandleNodeResized(nodeId, w, h);
    return;
  }
  patchLayout(ctx, (layout) => patchNode(layout, nodeId, { w, h }));
}

// ── handleNodeStyled ─────────────────────────────────────────────────────────

/**
 * Handle canvas:node-styled — patches style for the given nodeId.
 *
 * Edge IDs (containing "->") are routed to patchEdge; all others to patchNode.
 *
 * @param ctx        - Host context.
 * @param nodeId     - Mermaid node ID (or edge key) that was styled.
 * @param stylePatch - Partial style object — only changed fields present.
 */
export function handleNodeStyled(
  ctx: HostContext,
  nodeId: string,
  stylePatch: Record<string, unknown>,
): void {
  patchLayout(ctx, (layout) => {
    if (nodeId.includes("->")) {
      // Edge — route to layout.edges
      const existing = layout.edges[nodeId]?.style ?? {};
      return patchEdge(layout, nodeId, {
        style: { ...existing, ...stylePatch } as import("../types.js").EdgeStyle,
      });
    }
    // Node — existing behaviour
    const existing = layout.nodes[nodeId]?.style ?? {};
    return patchNode(layout, nodeId, {
      style: { ...existing, ...stylePatch } as import("../types.js").NodeStyle,
    });
  });
}

// ── persistEdgeWaypoints ─────────────────────────────────────────────────────

/**
 * Persist user-placed edge waypoints from the canvas back to layout.json.
 *
 * Validates edgeKey is non-empty and waypoints have finite coordinates.
 * Malformed payloads are dropped with a log entry.
 *
 * @param ctx - Host context.
 * @param msg - The canvas:edge-routed message payload.
 */
export function persistEdgeWaypoints(
  ctx: HostContext,
  msg: { edgeKey?: string; waypoints?: Array<{ x: number; y: number }> },
): void {
  const log = ctx.log ?? ((_m: string): void => { /* no-op */ });

  // Validate payload shape before touching any state.
  if (!msg.edgeKey || !Array.isArray(msg.waypoints)) {
    log("persistEdgeWaypoints: persist-drop empty edgeKey or missing waypoints");
    return;
  }
  // Ignore clearly malformed coordinates (e.g. from a buggy canvas hook).
  for (const wp of msg.waypoints) {
    if (
      typeof wp.x !== "number" || !Number.isFinite(wp.x) ||
      typeof wp.y !== "number" || !Number.isFinite(wp.y)
    ) {
      log("persistEdgeWaypoints: persist-drop non-finite waypoint coordinate");
      return;
    }
  }

  // Validated: edgeKey is non-empty string, waypoints is finite-number array.
  patchLayout(ctx, (layout) => patchEdge(layout, msg.edgeKey!, { waypoints: msg.waypoints }));
}
