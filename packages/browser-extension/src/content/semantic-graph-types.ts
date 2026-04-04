/**
 * M113-SEM — Semantic Graph shared types.
 *
 * All public interfaces and option types for the semantic graph collector.
 * Kept separate so helper modules can import without circular deps.
 *
 * @module
 */

import type { SnapshotEnvelope } from "../snapshot-versioning.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A node in the accessibility tree snapshot.
 *
 * B2-SG-002: Each node represents an element with an accessible role.
 * B2-SG-006: nodeId is per-call scoped, shared across all four sub-trees.
 */
export interface SemanticA11yNode {
  /** ARIA role (explicit via attribute or implicit via HTML element). */
  role: string;
  /** Computed accessible name (aria-label, alt, title, or derived). */
  name?: string;
  /** Heading level 1–6 (only present when role is "heading"). */
  level?: number;
  /** Per-call scoped node ID, shared across all four sub-trees. B2-SG-006. */
  nodeId: number;
  /** Child nodes in document order. */
  children: SemanticA11yNode[];
  /**
   * Accessibility/actionability states (disabled, checked, expanded, etc.).
   * Only present when non-empty. MCP-A11Y-002.
   */
  states?: string[];
}

/**
 * A landmark region on the page.
 *
 * B2-SG-003: Represents an ARIA landmark (explicit or implicit).
 */
export interface Landmark {
  /** Landmark role (navigation, main, banner, etc.). */
  role: string;
  /** Label from aria-label or aria-labelledby, if present. */
  label?: string;
  /** Per-call scoped node ID. B2-SG-006. */
  nodeId: number;
  /** HTML tag name (lowercase). */
  tag: string;
}

/**
 * A heading in the document outline.
 *
 * B2-SG-004: Represents an H1–H6 element in document order.
 */
export interface OutlineHeading {
  /** Heading level (1–6). */
  level: number;
  /** Trimmed text content of the heading. */
  text: string;
  /** Per-call scoped node ID. B2-SG-006. */
  nodeId: number;
  /** Element id attribute, if present. */
  id?: string;
}

/**
 * A single form field within a form model.
 *
 * B2-SG-005: Represents an input, select, textarea, or button element.
 */
export interface FormField {
  /** HTML tag name (input, select, textarea, button). */
  tag: string;
  /** The type attribute (text, email, submit, etc.). */
  type?: string;
  /** The name attribute. */
  name?: string;
  /** Associated label text or aria-label. */
  label?: string;
  /** Whether the field is required. */
  required: boolean;
  /** Current value (B2-SG-013: redacted for password fields). */
  value?: string;
  /** Per-call scoped node ID. B2-SG-006. */
  nodeId: number;
}

/**
 * A form model extracted from a <form> element.
 *
 * B2-SG-005: Includes the form's metadata and all contained fields.
 */
export interface FormModel {
  /** The form's id attribute, if present. */
  formId?: string;
  /** The form's name attribute, if present. */
  name?: string;
  /** The form action URL. */
  action?: string;
  /** The form method (GET or POST). */
  method: string;
  /** Per-call scoped node ID. B2-SG-006. */
  nodeId: number;
  /** Fields within this form. */
  fields: FormField[];
}

/**
 * Options for semantic graph collection.
 *
 * B2-SG-008: maxDepth limits the a11y tree nesting depth.
 * B2-SG-009: visibleOnly filters hidden elements.
 */
export interface SemanticGraphOptions {
  /** Maximum depth for a11y tree (default: 8, max: 16). B2-SG-008. */
  maxDepth?: number;
  /** Exclude hidden elements from all sub-trees (default: true). B2-SG-009. */
  visibleOnly?: boolean;
}

/**
 * Result of semantic graph collection — includes full SnapshotEnvelope.
 *
 * B2-SG-001: Contains all four sub-trees.
 * B2-SG-007: Extends SnapshotEnvelope.
 * B2-SG-015: All sub-tree arrays are always present (empty if none found).
 */
export interface SemanticGraphResult extends SnapshotEnvelope {
  /** Page URL (normalized: origin + pathname). */
  pageUrl: string;
  /** Page title. */
  title: string;
  /** B2-SG-002: Accessibility tree snapshot. */
  a11yTree: SemanticA11yNode[];
  /** B2-SG-003: Landmark regions. */
  landmarks: Landmark[];
  /** B2-SG-004: Document heading outline (H1–H6). */
  outline: OutlineHeading[];
  /** B2-SG-005: Form models. */
  forms: FormModel[];
}
