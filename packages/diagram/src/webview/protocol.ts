/**
 * A11 — Webview protocol: typed message definitions
 *
 * Typed discriminated-union message definitions for the extension host ↔
 * webview postMessage channel described in diag_arch_v4.2.md §9.4.
 *
 * No runtime code — pure TypeScript type definitions.
 * Tested via type compilation only (same pattern as A1 types.ts).
 *
 * Source: diag_arch_v4.2.md §9.4
 */

import type { NodeId, EdgeKey, ClusterId } from "../types.js";

// ── Webview → Extension host ───────────────────────────────────────────────────

/** User dragged a node to a new position on the canvas. */
export interface CanvasNodeMovedMessage {
  type: "canvas:node-moved";
  nodeId: NodeId;
  x: number;
  y: number;
}

/** User resized a node on the canvas. */
export interface CanvasNodeResizedMessage {
  type: "canvas:node-resized";
  nodeId: NodeId;
  w: number;
  h: number;
}

/** User applied a visual style change to a node. */
export interface CanvasNodeStyledMessage {
  type: "canvas:node-styled";
  nodeId: NodeId;
  // Partial style patch — only changed fields present.
  style: Record<string, unknown>;
}

/** User manually re-routed an edge by adding/moving waypoints. */
export interface CanvasEdgeRoutedMessage {
  type: "canvas:edge-routed";
  edgeKey: EdgeKey;
  waypoints: Array<{ x: number; y: number }>;
}

/** User added a node directly on the canvas. */
export interface CanvasNodeAddedMessage {
  type: "canvas:node-added";
  id: string;
  label: string;
  position: { x: number; y: number };
}

/** User deleted a node from the canvas. */
export interface CanvasNodeDeletedMessage {
  type: "canvas:node-deleted";
  nodeId: NodeId;
}

/** User drew a new edge on the canvas. */
export interface CanvasEdgeAddedMessage {
  type: "canvas:edge-added";
  from: NodeId;
  to: NodeId;
  label?: string;
}

/** User deleted an edge from the canvas. */
export interface CanvasEdgeDeletedMessage {
  type: "canvas:edge-deleted";
  edgeKey: EdgeKey;
}

/** Webview has completed an export and is returning the data. */
export interface CanvasExportReadyMessage {
  type: "canvas:export-ready";
  format: "svg" | "png";
  /** Base-64 encoded export data. */
  data: string;
}

/**
 * Webview has finished mounting and is ready to receive a host:load-scene.
 * The extension host waits for this before posting the initial scene so it
 * does not race the Excalidraw React initialisation.
 */
export interface CanvasReadyMessage {
  type: "canvas:ready";
}

/**
 * A JavaScript error (or unhandled promise rejection) occurred inside the
 * webview before or during bundle initialisation. Logged to the output channel
 * so developers can diagnose blank-canvas issues without opening DevTools.
 */
export interface CanvasJsErrorMessage {
  type: "canvas:js-error";
  message: string;
}

/**
 * Profiling: a timing measurement sent from the webview context to the host
 * so timings appear in the "Accordo Diagram" output channel without DevTools.
 */
export interface CanvasTimingMessage {
  type: "canvas:timing";
  label: string;
  ms: number;
}

/** Union of all messages the webview can send to the extension host. */
export type WebviewToHostMessage =
  | CanvasNodeMovedMessage
  | CanvasNodeResizedMessage
  | CanvasNodeStyledMessage
  | CanvasEdgeRoutedMessage
  | CanvasNodeAddedMessage
  | CanvasNodeDeletedMessage
  | CanvasEdgeAddedMessage
  | CanvasEdgeDeletedMessage
  | CanvasExportReadyMessage
  | CanvasReadyMessage
  | CanvasJsErrorMessage
  | CanvasTimingMessage
  // A18 — comment inbound messages
  | CommentCreateMessage
  | CommentReplyMessage
  | CommentResolveMessage
  | CommentReopenMessage
  | CommentDeleteMessage;

// ── Extension host → Webview ───────────────────────────────────────────────────

/** Load (or reload) the full Excalidraw scene. */
export interface HostLoadSceneMessage {
  type: "host:load-scene";
  /** Serialised Excalidraw elements (JSON-safe). */
  elements: unknown[];
  /** Excalidraw appState overrides (JSON-safe). */
  appState: Record<string, unknown>;
}

/** Ask the webview to parse/render via upstream mermaid-to-excalidraw directly. */
export interface HostLoadUpstreamDirectMessage {
  type: "host:load-upstream-direct";
  source: string;
}

/** Ask the webview to export the current canvas. */
export interface HostRequestExportMessage {
  type: "host:request-export";
  format: "svg" | "png";
}

/**
 * Show a transient toast notification inside the webview (ephemeral, auto-dismiss).
 * Use for informational messages such as "Updated by agent".
 */
export interface HostToastMessage {
  type: "host:toast";
  message: string;
}

/**
 * Display a persistent error overlay in the webview.
 *
 * Sent when the extension host cannot parse the `.mmd` source after a file-watcher
 * change. The overlay covers the canvas until the next successful `host:load-scene`
 * is received. Unlike `host:toast`, this is not auto-dismissed — it stays visible
 * until the parse failure is resolved.
 */
export interface HostErrorOverlayMessage {
  type: "host:error-overlay";
  message: string;
}

/** Union of all messages the extension host can send to the webview. */
export type HostToWebviewMessage =
  | HostLoadSceneMessage
  | HostLoadUpstreamDirectMessage
  | HostRequestExportMessage
  | HostToastMessage
  | HostErrorOverlayMessage
  | CommentsLoadMessage
  | HostFocusThreadMessage;

// ── A18 — Comment protocol messages ──────────────────────────────────────────

import type { CommentThread } from "@accordo/bridge-types";

// Webview → host (inbound to bridge)
// Note: no surfaceUri — bridge uses host-owned mmdUri (A18-R02)

export interface CommentCreateMessage {
  type: "comment:create";
  blockId: string;
  body: string;
  intent?: string;
}

export interface CommentReplyMessage {
  type: "comment:reply";
  threadId: string;
  body: string;
}

export interface CommentResolveMessage {
  type: "comment:resolve";
  threadId: string;
}

export interface CommentReopenMessage {
  type: "comment:reopen";
  threadId: string;
}

export interface CommentDeleteMessage {
  type: "comment:delete";
  threadId: string;
}

// Host → webview (full-reload only — SurfaceCommentAdapter has no per-thread events)

export interface CommentsLoadMessage {
  type: "comments:load";
  threads: CommentThread[];
}

// Host → webview — navigate to a specific thread (opens its SDK popover)

export interface HostFocusThreadMessage {
  type: "host:focus-thread";
  threadId: string;
}
