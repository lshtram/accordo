/**
 * Diagram Modularity — HostContext interface.
 *
 * Replaces the PanelStateWithPanel intersection/cast hack from panel-core.ts
 * with an explicit, typed host boundary object.
 *
 * HostContext is the single argument threaded through all host-layer functions.
 * It owns the VS Code WebviewPanel reference, logging, and timing — fields that
 * do NOT belong in PanelState (which is pure data).
 *
 * Layer: L4 (host/) — may import vscode, L0..L3.
 * Source: docs/reviews/diagram-modularity-A.md §HostContext contract
 */

import type * as vscode from "vscode";
import type { PanelState } from "../webview/panel-state.js";

// ── HostContext ───────────────────────────────────────────────────────────────

/**
 * Explicit host boundary object threaded through all host-layer orchestration.
 *
 * Replaces the old `PanelState & { _panel, _log, ... }` intersection cast.
 * Functions in `host/` accept `HostContext` instead of ad-hoc extended types.
 *
 * Optional test override hooks allow test code to inject spies without
 * subclassing or monkey-patching the production modules.
 */
export interface HostContext {
  /** Mutable panel data bag (timers, layout cache, disposables, etc.). */
  readonly state: PanelState;

  /** VS Code webview panel — source of the webview reference. */
  readonly panel: vscode.WebviewPanel;

  /** Log to the "Accordo Diagram" output channel. */
  readonly log: (msg: string) => void;

  /** Timestamp (ms) when the panel was created — used for timing diagnostics. */
  readonly createTime: number;

  // ── Optional test override hooks ─────────────────────────────────────────

  /** Override loadAndPost for testing — called instead of the real implementation. */
  readonly _testLoadAndPost?: () => Promise<void>;

  /** Override handleNodeMoved for testing. */
  readonly _testHandleNodeMoved?: (nodeId: string, x: number, y: number) => void;

  /** Override handleNodeResized for testing. */
  readonly _testHandleNodeResized?: (nodeId: string, w: number, h: number) => void;

  /** Override handleExportReady for testing. */
  readonly _testHandleExportReady?: (format: string, data: string) => void;

  /**
   * Override requestExport for testing.
   * When set, called INSTEAD of the real requestExport, allowing the test
   * to resolve/reject the export Promise without requiring a webview round-trip.
   * Must call ctx.panel.webview.postMessage synchronously before returning
   * so that test assertions on postMessage calls succeed.
   */
  readonly _testRequestExport?: (ctx: HostContext, format: "svg" | "png") => Promise<Buffer>;
}
