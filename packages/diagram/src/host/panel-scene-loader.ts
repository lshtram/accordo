/**
 * Diagram Modularity — Scene loader.
 *
 * Reads the .mmd source and layout, reconciles, generates the Excalidraw scene,
 * and posts host:load-scene to the webview.
 *
 * Layer: L4 (host/) — may import vscode, L0..L3.
 * Source: docs/reviews/diagram-modularity-A.md §panel-scene-loader.ts
 */

import { readFile } from "node:fs/promises";
import { parseMermaid } from "../parser/adapter.js";
import {
  readLayout,
  writeLayout,
  layoutPathFor,
  createEmptyLayout,
} from "../layout/layout-store.js";
import { reconcile } from "../reconciler/reconciler.js";
import { generateCanvas } from "../canvas/canvas-generator.js";
import { computeInitialLayout } from "../layout/auto-layout.js";
import type { LayoutOptions } from "../layout/auto-layout.js";
import { toExcalidrawPayload } from "../webview/scene-adapter.js";
import { dumpExcalidrawJson } from "../webview/debug-diagram-json.js";
import type { LayoutStore, SpatialDiagramType, NodeLayout, EdgeLayout } from "../types.js";
import type { HostContext } from "./host-context.js";
import type {
  HostLoadSceneMessage,
  HostErrorOverlayMessage,
} from "../webview/protocol.js";
import { PanelFileNotFoundError } from "../webview/panel.js";
import { renderUpstreamDirect } from "../layout/upstream-direct.js";

// ── Cosmic constant: upstream-direct seed scale ────────────────────────────────
//
// Applied uniformly to ALL seeded geometry (nodes, clusters, edge waypoints)
// at first-init to normalize upstream library output to our canonical
// coordinate space.
//
// Based on shape-map rectangle baseline:
//   shape-map standard: 180px wide
//   upstream library produces: ~120px wide for standard rectangles
//   scale = 180 / 120 = 1.5
//
// Using a single coherent scale preserves relative spatial relationships
// between boxes and edges — unlike the old box-only normalization that
// only changed node sizes without moving waypoints/clusters.
const UPSTREAM_SEED_SCALE = 1.5;

// ── Internal type for passing to panel-core internals ──────────────────────────

async function runUpstreamPlacement(
  source: string,
  clusterIdSet: ReadonlySet<string>,
): Promise<{
  nodes: Record<string, { x: number; y: number; w: number; h: number }>;
  edges: Record<string, { waypoints: Array<{ x: number; y: number }> }>;
  clusters: Record<string, { x: number; y: number; w: number; h: number }>;
}> {
  const elements = await renderUpstreamDirect(source);
  if (elements.length === 1 && elements[0]?.type === "image") {
    throw new Error("Upstream placement produced image-only fallback");
  }

  const nodes: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const edges: Record<string, { waypoints: Array<{ x: number; y: number }> }> = {};
  const clusters: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const edgeOrdinals = new Map<string, number>();

  for (const el of elements) {
    if (el.type === "arrow") {
      const points = el.points as Array<[number, number]> | undefined;
      if (!points || points.length === 0) continue;
      const explicitId = (el.customData as { mermaidId?: string } | undefined)?.mermaidId;
      let edgeKey: string | null = null;
      if (typeof explicitId === "string") {
        edgeKey = explicitId;
      } else {
        const startId = (el as { start?: { id?: unknown } }).start?.id;
        const endId = (el as { end?: { id?: unknown } }).end?.id;
        if (typeof startId === "string" && typeof endId === "string") {
          const pair = `${startId}->${endId}`;
          const ordinal = edgeOrdinals.get(pair) ?? 0;
          edgeOrdinals.set(pair, ordinal + 1);
          edgeKey = `${pair}:${ordinal}`;
        } else if (typeof el.id === "string") {
          edgeKey = el.id;
        }
      }
      if (edgeKey === null) continue;
      edges[edgeKey] = {
        waypoints: points.slice(1, points.length - 1).map((pt) => ({
          x: (el.x as number) + pt[0],
          y: (el.y as number) + pt[1],
        })),
      };
      continue;
    }

    const rawId = (el.customData as { mermaidId?: string } | undefined)?.mermaidId ?? el.id;
    if (typeof rawId !== "string") continue;
    if (rawId.endsWith(":text") || rawId.endsWith(":label")) continue;
    if (clusterIdSet.has(rawId)) {
      clusters[rawId] = {
        x: el.x as number,
        y: el.y as number,
        w: el.width as number,
        h: el.height as number,
      };
      continue;
    }
    nodes[rawId] = {
      x: el.x as number,
      y: el.y as number,
      w: el.width as number,
      h: el.height as number,
    };
  }

  return { nodes, edges, clusters };
}

/**
 * Apply UPSTREAM_SEED_SCALE uniformly to all seeded geometry.
 * This scales nodes, clusters, and edge waypoints by the same factor,
 * preserving their relative spatial relationships.
 */
function applySeedScale(
  nodes: Record<string, { x: number; y: number; w: number; h: number }>,
  edges: Record<string, { waypoints: Array<{ x: number; y: number }> }>,
  clusters: Record<string, { x: number; y: number; w: number; h: number }>,
): void {
  for (const node of Object.values(nodes)) {
    node.x *= UPSTREAM_SEED_SCALE;
    node.y *= UPSTREAM_SEED_SCALE;
    node.w *= UPSTREAM_SEED_SCALE;
    node.h *= UPSTREAM_SEED_SCALE;
  }
  for (const edge of Object.values(edges)) {
    for (const wp of edge.waypoints) {
      wp.x *= UPSTREAM_SEED_SCALE;
      wp.y *= UPSTREAM_SEED_SCALE;
    }
  }
  for (const cluster of Object.values(clusters)) {
    cluster.x *= UPSTREAM_SEED_SCALE;
    cluster.y *= UPSTREAM_SEED_SCALE;
    cluster.w *= UPSTREAM_SEED_SCALE;
    cluster.h *= UPSTREAM_SEED_SCALE;
  }
}

// ── loadAndPost ──────────────────────────────────────────────────────────────

/**
 * Core load routine: read .mmd + layout -> reconcile -> generate -> post host:load-scene.
 *
 * On parse failure posts host:error-overlay instead of throwing.
 * Rejects with PanelFileNotFoundError if the .mmd file cannot be read.
 *
 * @param ctx - Host context with panel, state, and logging.
 */
export async function loadAndPost(ctx: HostContext): Promise<void> {
  // Use test override if set
  if (ctx._testLoadAndPost) {
    await ctx._testLoadAndPost();
    return;
  }

  const state = ctx.state;
  const log = ctx.log ?? ((_msg: string): void => { /* no-op */ });

  // Empty path means the panel has no file — send empty scene.
  if (state.mmdPath === "") {
    const emptyMsg: HostLoadSceneMessage = { type: "host:load-scene", elements: [], appState: {} };
    await ctx.panel.webview.postMessage(emptyMsg);
    return;
  }

  let source: string;
  try {
    source = await readFile(state.mmdPath, "utf8");
  } catch (err) {
    log("loadAndPost — file read FAILED: " + String(err));
    throw new PanelFileNotFoundError(state.mmdPath);
  }

  const parseResult = await parseMermaid(source);
  if (!parseResult.valid) {
    const errMsg: HostErrorOverlayMessage = {
      type: "host:error-overlay",
      message: parseResult.error.message,
    };
    await ctx.panel.webview.postMessage(errMsg);
    return;
  }

  const layoutPath = layoutPathFor(state.mmdPath, state._workspaceRoot);

  let layout = await readLayout(layoutPath);
  const hadPersistedLayout = layout !== null;
  if (layout === null) {
    const requestedEngine = undefined;
    const effectiveEngine =
      requestedEngine ?? (parseResult.diagram.type === "flowchart" ? "upstream-direct" : "dagre");
    const isFirstInit = effectiveEngine === "upstream-direct" && parseResult.diagram.type === "flowchart";

    if (isFirstInit) {
      try {
        log("[diag-load] host step3 upstream placement start");
        const { nodes: upstreamNodes, edges: upstreamEdges, clusters: upstreamClusters } = await runUpstreamPlacement(
          source,
          new Set(parseResult.diagram.clusters?.map((c) => c.id) ?? []),
        );
        // Apply seed scale uniformly to all geometry before writing layout.
        // This preserves spatial relationships between nodes, clusters, and edges.
        applySeedScale(upstreamNodes, upstreamEdges, upstreamClusters);
        const nodes: Record<string, NodeLayout> = {};
        for (const [id, pos] of Object.entries(upstreamNodes)) {
          nodes[id] = { x: pos.x, y: pos.y, w: pos.w, h: pos.h, style: {} };
        }
        const edges: Record<string, EdgeLayout> = {};
        for (const [key, edgeData] of Object.entries(upstreamEdges)) {
          edges[key] = { routing: "auto", waypoints: edgeData.waypoints, style: {} };
        }
        const clusters = Object.fromEntries(
          (parseResult.diagram.clusters ?? []).map((c) => {
            const up = upstreamClusters[c.id];
            return [
              c.id,
              {
                x: up?.x ?? 0,
                y: up?.y ?? 0,
                w: up?.w ?? 0,
                h: up?.h ?? 0,
                label: c.label,
                style: {},
              },
            ];
          }),
        );
        layout = createEmptyLayout(parseResult.diagram.type as SpatialDiagramType);
        layout = { ...layout, nodes, edges, clusters };
        await writeLayout(layoutPath, layout);
        log(`[diag-load] host step3 upstream seeded layout: nodes=${Object.keys(layout.nodes).length} edges=${Object.keys(layout.edges).length}`);
      } catch (err) {
        log(`[diag-load] host step3 upstream failed, dagre fallback: ${String(err)}`);
        try {
          const dir = parseResult.diagram.direction;
          const rankdir = (dir === "TD" ? "TB" : dir) as LayoutOptions["rankdir"];
          layout = computeInitialLayout(parseResult.diagram, { rankdir });
        } catch {
          layout = createEmptyLayout(parseResult.diagram.type as SpatialDiagramType);
        }
      }
    } else {
      try {
        const dir = parseResult.diagram.direction;
        const rankdir = (dir === "TD" ? "TB" : dir) as LayoutOptions["rankdir"];
        layout = computeInitialLayout(parseResult.diagram, { rankdir });
      } catch {
        layout = createEmptyLayout(parseResult.diagram.type as SpatialDiagramType);
      }
    }
  }

  // Reconcile only when this file already had a persisted layout.
  // On first-init (layout missing), running reconcile against stale _lastSource
  // from a previously opened file can overwrite freshly seeded edge geometry
  // (waypoints/roundness) with default empty edge layouts.
  if (hadPersistedLayout && state._lastSource !== "" && state._lastSource !== source) {
    try {
      const result = await reconcile(state._lastSource, source, layout);
      layout = result.layout;
      await writeLayout(layoutPath, layout);
    } catch {
      // Reconcile errors are non-fatal; proceed with existing layout
    }
  }

  state._lastSource = source;

  // UD-02: Engine selection policy.
  // Default for flowcharts is upstream-direct unless explicitly overridden
  // via layout.metadata.engine = "dagre".
  // The chosen engine only affects initial layout seeding (first-init with no existing layout).
  // Runtime renders ALWAYS use generateCanvas + host:load-scene (SRP-01, SRP-03).
  const requestedEngine = layout?.metadata?.engine as string | undefined;
  const effectiveEngine =
    requestedEngine ?? (parseResult.diagram.type === "flowchart" ? "upstream-direct" : "dagre");

  // Persist default engine choice for flowcharts when metadata is missing so
  // subsequent opens are explicit and deterministic.
  if (parseResult.diagram.type === "flowchart" && requestedEngine === undefined) {
    layout = {
      ...layout,
      metadata: {
        ...(layout.metadata ?? {}),
        engine: "upstream-direct",
      },
    };
    await writeLayout(layoutPath, layout);
  }

  // Single runtime render path: ALWAYS use generateCanvas + host:load-scene.
  // mermaid-to-excalidraw seeding (when upstream-direct) happens at first-init
  // via panel-core.ts runUpstreamPlacement; the host side render path is unified.
  const scene = await Promise.resolve(generateCanvas(parseResult.diagram, layout));
  await writeLayout(layoutPath, scene.layout);
  state._currentLayout = scene.layout;

  const apiElements = toExcalidrawPayload(scene.elements);

  // DEBUG: dump exact Excalidraw JSON before rendering.
  // Enabled when ACCORDO_DEBUG_DIAGRAM_JSON=1; no-op otherwise (zero cost).
  await dumpExcalidrawJson({
    mmdPath: state.mmdPath,
    workspaceRoot: state._workspaceRoot,
    source,
    elements: apiElements,
  });

  const msg: HostLoadSceneMessage = {
    type: "host:load-scene",
    elements: apiElements,
    appState: {},
  };
  await ctx.panel.webview.postMessage(msg);
}
