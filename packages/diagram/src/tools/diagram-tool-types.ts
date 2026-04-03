/**
 * A14 — MCP tool types for the diagram package.
 *
 * All tool-specific error codes, result envelopes, and interfaces.
 * Imported by diagram-tool-ops.ts and re-exported by diagram-tool-handlers.ts.
 *
 * Public exports
 * ──────────────
 *   DiagToolError               — thrown/handled path guard error
 *   DiagramToolContext           — context interface
 *   DiagramPanelLike             — panel interface
 *   ToolOk<T> / ToolErr / ToolResult<T> — result envelope
 *   DiagramListEntry / DiagramGetResult / DiagramCreateResult / DiagramPatchResult / DiagramRenderResult / DiagramStyleGuideResult
 *
 * Source: diag_workplan.md §4.14, diag_arch_v4.2.md §6
 */

import type { DiagramType, ParsedNode, ParsedEdge, ParsedCluster, LayoutStore, NodeStyle, ReconcileResult } from "../types.js";

// ── ErrorCode ─────────────────────────────────────────────────────────────────

export type ErrorCode =
  | "FILE_NOT_FOUND"
  | "PARSE_ERROR"
  | "TRAVERSAL_DENIED"
  | "ALREADY_EXISTS"
  | "PANEL_NOT_OPEN"
  | "PANEL_MISMATCH";

// ── Result envelope ────────────────────────────────────────────────────────────

export type ToolOk<T> = { ok: true; data: T };
export type ToolErr = { ok: false; errorCode: ErrorCode; message: string };
export type ToolResult<T> = ToolOk<T> | ToolErr;

// ── Path helper error ─────────────────────────────────────────────────────────

/**
 * Thrown by resolveGuarded when a path escapes the workspace root.
 * Handlers catch this and convert it to a ToolErr.
 */
export class DiagToolError extends Error {
  constructor(
    public readonly errorCode: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DiagToolError";
  }
}

// ── Context interfaces ────────────────────────────────────────────────────────

export interface DiagramPanelLike {
  readonly mmdPath: string;
  requestExport(format: "svg" | "png"): Promise<Buffer>;
}

export interface DiagramToolContext {
  workspaceRoot: string;
  getPanel(): DiagramPanelLike | undefined;
}

// ── Return-data interfaces (public for test type-checking) ───────────────────

export interface DiagramListEntry {
  /** Path relative to workspaceRoot */
  path: string;
  /** Detected diagram type, or null for unrecognised */
  type: string | null;
  nodeCount: number;
}

export interface DiagramGetResult {
  source: string;
  type: DiagramType;
  nodes: ParsedNode[];
  edges: readonly ParsedEdge[];
  clusters: readonly ParsedCluster[];
  /** null when no .layout.json exists */
  layout: LayoutStore | null;
}

export interface DiagramCreateResult {
  created: true;
  path: string;
  layoutPath: string;
  type: DiagramType;
  nodeCount: number;
}

export interface DiagramPatchResult {
  patched: true;
  path: string;
  changes: ReconcileResult["changes"];
  /** Present when @rename annotations were processed */
  mermaidCleaned?: string;
}

export interface DiagramRenderResult {
  rendered: true;
  output_path: string;
  format: "svg" | "png";
  bytes: number;
}

export interface DiagramStyleGuideResult {
  message: string;
  skills: Array<{
    id: string;
    path: string;
    description: string;
  }>;
}
