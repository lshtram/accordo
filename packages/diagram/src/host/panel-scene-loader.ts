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
import type { LayoutStore, SpatialDiagramType } from "../types.js";
import type { HostContext } from "./host-context.js";
import type {
  HostLoadSceneMessage,
  HostErrorOverlayMessage,
} from "../webview/protocol.js";
import { PanelFileNotFoundError } from "../webview/panel.js";

// ── Internal type for passing to panel-core internals ──────────────────────────

type InternalState = {
  mmdPath: string;
  _workspaceRoot: string;
  _lastSource: string;
  _currentLayout: LayoutStore | null;
  _layoutWriteTimer: ReturnType<typeof setTimeout> | null;
  _panel: { webview: { postMessage: (msg: unknown) => Promise<boolean> } };
  _log: (msg: string) => void;
};

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
  if (layout === null) {
    try {
      const dir = parseResult.diagram.direction;
      // Mermaid uses "TD" but dagre uses "TB" — they mean the same thing.
      const rankdir = (dir === "TD" ? "TB" : dir) as LayoutOptions["rankdir"];
      layout = computeInitialLayout(parseResult.diagram, { rankdir });
    } catch {
      layout = createEmptyLayout(parseResult.diagram.type as SpatialDiagramType);
    }
  }

  if (state._lastSource !== "" && state._lastSource !== source) {
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
