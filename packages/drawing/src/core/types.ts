/**
 * DRW-R01..R05, DRW-R22 — Core type contracts for accordo-drawing.
 *
 * All public types in one place. Functions are delegated to seam modules.
 * Tests and handlers import from this file.
 *
 * Seam responsibility map:
 *   seams/errors.ts        — DrawingError / DrawingErrorCode
 *   seams/source-graph.ts  — parseMermaidSource + SourceGraph/Node/Edge types
 *   seams/scene-index.ts   — buildSceneIndex + SceneIndex/SceneElement/ManagedIdentity
 *   seams/merge-plan.ts    — computeMergePlan
 *   seams/placement-engine.ts — placeNewNodes
 *
 * Source: docs/10-architecture/drawing-architecture.md §3, §4
 * Requirements: DRW-R01, DRW-R02, DRW-R03, DRW-R04, DRW-R05, DRW-R22
 */

// ── Base domain types (defined here to avoid circular seam imports) ───────────

/** DRW-R05 — Stable identity anchor. */
export interface ManagedIdentity {
  version: 1;
  entityKind: "node" | "edge" | "cluster" | "helper";
  identity: string;
  sceneRole: "primary" | "label" | "container" | "helper";
  sourcePath: string;
  status: "active" | "orphaned";
  orphanReason?: string;
  /** Internal: label text captured from excalidraw text elements at merge time. */
  __label?: string;
}

/** DRW-R03 — The .excalidraw file owns positions, sizes, unmanaged elements. */
export interface SceneIndex {
  activeManaged: SceneElement[];
  orphanedManaged: SceneElement[];
  unmanaged: SceneElement[];
}

/** A single element from a parsed .excalidraw JSON. */
export interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: number[][];
  customData?: {
    accordo?: ManagedIdentity;
    [key: string]: unknown;
  };
}

// ── Errors ────────────────────────────────────────────────────────────────────

export { DrawingError } from "./seams/errors.js";
export type { DrawingErrorCode } from "./seams/errors.js";

// ── Source graph types and parser ───────────────────────────────────────────

export { parseMermaidSource } from "./seams/source-graph.js";
export type {
  SourceGraph,
  SourceGraphType,
  SourceNode,
  SourceEdge,
  SourceCluster,
} from "./seams/source-graph.js";

// ── Scene index builder ───────────────────────────────────────────────────────

export { buildSceneIndex } from "./seams/scene-index.js";

// ── Merge plan and placement ──────────────────────────────────────────────────

export { computeMergePlan } from "./seams/merge-plan.js";
export { placeNewNodes } from "./seams/placement-engine.js";
export * from "./contracts.js";
