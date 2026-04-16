/**
 * Diagram Modularity — Host-layer panel state.
 *
 * Re-exports PanelState and its factory/helpers from the existing
 * webview/panel-state module. During the cutover (Phase C) these will be
 * moved here and the webview module will re-export from host instead.
 * For Phase A the re-export bridge keeps all existing imports stable.
 *
 * Layer: L4 (host/) — may import vscode, L0..L3.
 * Source: docs/reviews/diagram-modularity-A.md §panel-state.ts
 */

// ── Re-exports from existing module (bridge for cutover) ─────────────────────

export type { PanelState } from "../webview/panel-state.js";

export {
  createPanelState,
  assertNotDisposed,
  cleanupOnDispose,
  resolveWorkspaceRoot,
} from "../webview/panel-state.js";
