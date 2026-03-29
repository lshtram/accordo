/**
 * M113-SEM — Semantic Graph Collector
 *
 * Walks the DOM and returns a unified semantic graph containing four
 * sub-trees: accessibility tree, landmarks, document outline, and form
 * models. All sub-trees share a single per-call node ID counter.
 *
 * Implements requirements B2-SG-001 through B2-SG-015.
 *
 * This module is the public entry point. Implementation details live in:
 *   - semantic-graph-types.ts    — interfaces & option types
 *   - semantic-graph-helpers.ts  — shared constants, registry, visibility, roles
 *   - semantic-graph-a11y.ts     — accessibility tree builder
 *   - semantic-graph-landmarks.ts — landmark extractor
 *   - semantic-graph-outline.ts  — document outline extractor
 *   - semantic-graph-forms.ts    — form model extractor
 *
 * @module
 */

import { captureSnapshotEnvelope } from "../snapshot-versioning.js";
import type { SnapshotEnvelope } from "../snapshot-versioning.js";

// Re-export all public types so existing imports continue to work.
export type {
  SemanticA11yNode,
  Landmark,
  OutlineHeading,
  FormField,
  FormModel,
  SemanticGraphOptions,
  SemanticGraphResult,
} from "./semantic-graph-types.js";

export {
  DEFAULT_MAX_DEPTH,
  MAX_DEPTH_LIMIT,
  SEMANTIC_GRAPH_TIMEOUT_MS,
} from "./semantic-graph-helpers.js";

import { NodeIdRegistry } from "./semantic-graph-helpers.js";
import { buildA11yTree } from "./semantic-graph-a11y.js";
import { extractLandmarks } from "./semantic-graph-landmarks.js";
import { extractOutline } from "./semantic-graph-outline.js";
import { extractForms } from "./semantic-graph-forms.js";
import type { SemanticGraphOptions, SemanticGraphResult } from "./semantic-graph-types.js";
import { DEFAULT_MAX_DEPTH, MAX_DEPTH_LIMIT } from "./semantic-graph-helpers.js";

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Collect a semantic graph from the current document.
 *
 * Walks the DOM tree and extracts four sub-trees: accessibility tree,
 * landmarks, document outline (H1–H6), and form models. All sub-trees
 * share a single per-call node ID counter (B2-SG-006).
 *
 * B2-SG-001: Unified semantic graph response.
 * B2-SG-002: Accessibility tree snapshot.
 * B2-SG-003: Landmark extraction.
 * B2-SG-004: Document outline.
 * B2-SG-005: Form model extraction.
 * B2-SG-006: Shared node ID counter.
 * B2-SG-007: SnapshotEnvelope compliance.
 * B2-SG-008: maxDepth limiting.
 * B2-SG-009: Visibility filtering (all four sub-trees).
 * B2-SG-013: Password redaction.
 * B2-SG-014: Implicit ARIA role mapping.
 * B2-SG-015: Empty sub-trees always present.
 *
 * @param options - Collection options (maxDepth, visibleOnly)
 * @returns Semantic graph with all four sub-trees and metadata
 */
export function collectSemanticGraph(options?: SemanticGraphOptions): SemanticGraphResult {
  // B2-SG-008: resolve effective maxDepth, clamp to MAX_DEPTH_LIMIT
  const requestedDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const effectiveMaxDepth = Math.min(Math.max(1, requestedDepth), MAX_DEPTH_LIMIT);

  // B2-SG-009: default visibleOnly to true
  const visibleOnly = options?.visibleOnly ?? true;

  // B2-SG-006: shared node ID registry across all sub-trees
  const registry = new NodeIdRegistry();

  // Build all four sub-trees — visibleOnly applied consistently to all. B2-SG-009.
  const a11yTree = buildA11yTree(registry, effectiveMaxDepth, visibleOnly);
  const landmarks = extractLandmarks(registry, visibleOnly);
  const outline = extractOutline(registry, visibleOnly);
  const forms = extractForms(registry, visibleOnly);

  // B2-SG-007: capture snapshot envelope
  const envelope: SnapshotEnvelope = captureSnapshotEnvelope("dom");

  return {
    ...envelope,
    pageUrl: window.location.origin + window.location.pathname,
    title: document.title,
    a11yTree,
    landmarks,
    outline,
    forms,
  };
}
