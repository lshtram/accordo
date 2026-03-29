/**
 * M113-SEM — Semantic Graph Collector
 *
 * Walks the DOM and returns a unified semantic graph containing four
 * sub-trees: accessibility tree, landmarks, document outline, and form
 * models. All sub-trees share a single per-call node ID counter.
 *
 * Implements requirements B2-SG-001 through B2-SG-015.
 *
 * @module
 */

import { captureSnapshotEnvelope } from "../snapshot-versioning.js";
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

// ── Constants ────────────────────────────────────────────────────────────────

/** Default maximum depth for a11y tree traversal. B2-SG-008. */
export const DEFAULT_MAX_DEPTH = 8;

/** Maximum allowed depth for a11y tree traversal. B2-SG-008. */
export const MAX_DEPTH_LIMIT = 16;

/** Relay timeout for semantic graph collection (ms). B2-SG-010. */
export const SEMANTIC_GRAPH_TIMEOUT_MS = 15_000;

// ── Internal: Implicit ARIA role map ─────────────────────────────────────────

/** Implicit ARIA roles for landmark HTML elements. */
const LANDMARK_TAG_ROLES: Readonly<Record<string, string>> = {
  header: "banner",
  nav: "navigation",
  main: "main",
  aside: "complementary",
  footer: "contentinfo",
  form: "form",
};

/** Implicit ARIA roles for all recognized HTML elements. */
const TAG_ROLES: Readonly<Record<string, string>> = {
  ...LANDMARK_TAG_ROLES,
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  button: "button",
  a: "link",
  img: "img",
  table: "table",
  input: "textbox",
  textarea: "textbox",
  select: "listbox",
  ul: "list",
  ol: "list",
  li: "listitem",
  article: "article",
  section: "region",
  div: "generic",
  span: "generic",
};

/** Tags excluded from a11y tree traversal (non-content). */
const EXCLUDED_TAGS: ReadonlySet<string> = new Set([
  "script", "style", "noscript", "template", "link", "meta",
]);

// ── Internal: shared node ID counter ─────────────────────────────────────────

/**
 * Per-call node ID counter. Shared across all four sub-trees so that
 * the same DOM element always gets the same nodeId regardless of which
 * sub-tree references it. B2-SG-006.
 */
class NodeIdRegistry {
  private readonly elementIds = new Map<Element, number>();
  private counter = 0;

  /** Get or assign a stable nodeId for an element. */
  idFor(el: Element): number {
    const existing = this.elementIds.get(el);
    if (existing !== undefined) return existing;
    const id = this.counter++;
    this.elementIds.set(el, id);
    return id;
  }
}

// ── Internal: getElementRect ──────────────────────────────────────────────────

/**
 * Get bounding client rect for an element.
 *
 * In the test environment, `vi.stubGlobal("getBoundingClientRect", fn)` patches
 * `window.getBoundingClientRect` with a function that uses `this` as the element.
 * This wrapper calls that patched global when available, falling back to the
 * standard element method in real browser contexts.
 */
function getElementRect(el: HTMLElement): DOMRect {
  const win = window as unknown as Record<string, unknown>;
  if (typeof win["getBoundingClientRect"] === "function") {
    return (win["getBoundingClientRect"] as (this: HTMLElement) => DOMRect).call(el);
  }
  return el.getBoundingClientRect();
}

// ── Internal: visibility check ────────────────────────────────────────────────

/**
 * Determine whether an element is hidden (display:none, visibility:hidden, etc.).
 * B2-SG-009.
 */
function isHidden(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    style.opacity === "0" ||
    el.hasAttribute("hidden")
  );
}

// ── Internal: accessible name ─────────────────────────────────────────────────

/**
 * Compute the accessible name for an element.
 * Priority: aria-label > aria-labelledby (resolved text) > alt > title >
 *           direct text content (trimmed).
 */
function getAccessibleName(el: HTMLElement): string | undefined {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return ariaLabel.trim();

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy !== null && labelledBy.trim().length > 0) {
    const ids = labelledBy.trim().split(/\s+/);
    const parts: string[] = [];
    for (const id of ids) {
      const ref = document.getElementById(id);
      if (ref !== null) {
        const text = ref.textContent?.trim();
        if (text) parts.push(text);
      }
    }
    if (parts.length > 0) return parts.join(" ");
  }

  const alt = el.getAttribute("alt");
  if (alt !== null && alt.trim().length > 0) return alt.trim();

  const title = el.getAttribute("title");
  if (title !== null && title.trim().length > 0) return title.trim();

  // For buttons, inputs, and headings derive from direct text content
  const tag = el.tagName.toLowerCase();
  if (["button", "h1", "h2", "h3", "h4", "h5", "h6", "a", "label"].includes(tag)) {
    const text = el.textContent?.trim();
    if (text && text.length > 0) return text;
  }

  return undefined;
}

// ── Internal: get ARIA role ───────────────────────────────────────────────────

/** Get the explicit or implicit ARIA role for an element. */
function getRole(el: HTMLElement): string | undefined {
  const explicit = el.getAttribute("role");
  if (explicit !== null && explicit.trim().length > 0) return explicit.trim();
  const tag = el.tagName.toLowerCase();
  return TAG_ROLES[tag];
}

// ── Internal: a11y tree builder ───────────────────────────────────────────────

/**
 * Recursively build a SemanticA11yNode from a DOM element.
 * Skips excluded tags, optionally skips hidden elements, and limits depth.
 *
 * B2-SG-001: DOM traversal.
 * B2-SG-002: role/name/nodeId/children.
 * B2-SG-005: maxDepth limiting.
 * B2-SG-009: visibleOnly filtering.
 */
function buildA11yNode(
  el: HTMLElement,
  registry: NodeIdRegistry,
  depth: number,
  maxDepth: number,
  visibleOnly: boolean,
): SemanticA11yNode | null {
  const tag = el.tagName.toLowerCase();

  // Skip non-content tags
  if (EXCLUDED_TAGS.has(tag)) return null;

  // Skip hidden elements when visibleOnly is true
  if (visibleOnly && isHidden(el)) return null;

  const role = getRole(el);

  // Skip elements with no role (generic containers like div/span without role)
  if (role === undefined) {
    // Still traverse children to find meaningful descendants
    if (depth < maxDepth) {
      const children = buildA11yChildren(el, registry, depth, maxDepth, visibleOnly);
      // If this is a generic container with no role, flatten children up
      // (don't create a node, but return them to parent — handled by caller)
      // We handle this by returning null and letting the parent handle children
      // For simplicity: include generic containers only when they have no meaningful role
      // but do include all elements that have any meaning
      void children; // not used here — null return handled by caller aggregation
    }
    return null;
  }

  const nodeId = registry.idFor(el);
  const name = getAccessibleName(el);

  const node: SemanticA11yNode = {
    role,
    nodeId,
    children: [],
  };

  if (name !== undefined) node.name = name;

  // Heading level
  if (role === "heading") {
    const levelMatch = tag.match(/^h([1-6])$/);
    if (levelMatch !== null) {
      node.level = parseInt(levelMatch[1] ?? "1", 10);
    }
  }

  // Recurse into children if depth allows
  if (depth < maxDepth) {
    node.children = buildA11yChildren(el, registry, depth, maxDepth, visibleOnly);
  }

  return node;
}

/**
 * Build child SemanticA11yNode array for an element's direct children.
 * Flattens generic container children (those that return null from buildA11yNode)
 * by recursing through them.
 */
function buildA11yChildren(
  el: HTMLElement,
  registry: NodeIdRegistry,
  depth: number,
  maxDepth: number,
  visibleOnly: boolean,
): SemanticA11yNode[] {
  const children: SemanticA11yNode[] = [];

  for (const child of Array.from(el.children)) {
    if (!(child instanceof HTMLElement)) continue;

    const childTag = child.tagName.toLowerCase();
    if (EXCLUDED_TAGS.has(childTag)) continue;
    if (visibleOnly && isHidden(child)) continue;

    const childRole = getRole(child);
    if (childRole !== undefined) {
      // Child has a role — build it as a node at depth+1
      const childNode = buildA11yNode(child, registry, depth + 1, maxDepth, visibleOnly);
      if (childNode !== null) {
        children.push(childNode);
      }
    } else {
      // Child has no role — flatten its children up into the current node
      if (depth < maxDepth) {
        const grandchildren = buildA11yChildren(child, registry, depth, maxDepth, visibleOnly);
        children.push(...grandchildren);
      }
    }
  }

  return children;
}

/**
 * Build the full a11y tree from document.body.
 * B2-SG-001, B2-SG-002, B2-SG-008, B2-SG-009.
 */
function buildA11yTree(
  registry: NodeIdRegistry,
  maxDepth: number,
  visibleOnly: boolean,
): SemanticA11yNode[] {
  if (!document.body) return [];

  const roots: SemanticA11yNode[] = [];

  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;

    const childTag = child.tagName.toLowerCase();
    if (EXCLUDED_TAGS.has(childTag)) continue;
    if (visibleOnly && isHidden(child)) continue;

    const childRole = getRole(child);
    if (childRole !== undefined) {
      const node = buildA11yNode(child, registry, 1, maxDepth, visibleOnly);
      if (node !== null) roots.push(node);
    } else {
      // Flatten generic containers at the root level
      const flattened = buildA11yChildren(child, registry, 0, maxDepth, visibleOnly);
      roots.push(...flattened);
    }
  }

  return roots;
}

// ── Internal: landmark extractor ──────────────────────────────────────────────

/**
 * Extract landmark regions from the document.
 * B2-SG-003, B2-SG-007, B2-SG-014.
 */
function extractLandmarks(registry: NodeIdRegistry): Landmark[] {
  const landmarks: Landmark[] = [];
  const selector = "header, nav, main, aside, footer, form, [role]";
  const elements = document.querySelectorAll(selector);

  for (const el of Array.from(elements)) {
    if (!(el instanceof HTMLElement)) continue;

    const tag = el.tagName.toLowerCase();
    let role: string | undefined;

    // Check explicit role attribute first
    const explicitRole = el.getAttribute("role");
    if (explicitRole !== null && explicitRole.trim().length > 0) {
      role = explicitRole.trim();
    } else {
      role = LANDMARK_TAG_ROLES[tag];
    }

    // Only include recognized landmark roles
    if (role === undefined) continue;

    const nodeId = registry.idFor(el);

    const landmark: Landmark = {
      role,
      nodeId,
      tag,
    };

    // B2-SG-003: label from aria-label
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel !== null && ariaLabel.trim().length > 0) {
      landmark.label = ariaLabel.trim();
    } else {
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy !== null) {
        const ref = document.getElementById(labelledBy.trim());
        if (ref !== null) {
          const text = ref.textContent?.trim();
          if (text) landmark.label = text;
        }
      }
    }

    landmarks.push(landmark);
  }

  return landmarks;
}

// ── Internal: outline extractor ───────────────────────────────────────────────

/**
 * Extract heading outline from the document in DOM order.
 * B2-SG-004.
 */
function extractOutline(registry: NodeIdRegistry): OutlineHeading[] {
  const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
  const outline: OutlineHeading[] = [];

  for (const el of Array.from(headings)) {
    if (!(el instanceof HTMLElement)) continue;

    const tag = el.tagName.toLowerCase();
    const levelMatch = tag.match(/^h([1-6])$/);
    if (levelMatch === null) continue;

    const level = parseInt(levelMatch[1] ?? "1", 10);
    const text = el.textContent?.trim() ?? "";
    if (text.length === 0) continue;

    const nodeId = registry.idFor(el);

    const heading: OutlineHeading = {
      level,
      text,
      nodeId,
    };

    const id = el.getAttribute("id");
    if (id !== null && id.length > 0) heading.id = id;

    outline.push(heading);
  }

  return outline;
}

// ── Internal: form extractor ──────────────────────────────────────────────────

/**
 * Resolve the label text for a form field.
 * Checks: aria-label > explicit <label for="id"> > wrapping <label> > title.
 */
function resolveFieldLabel(el: HTMLElement): string | undefined {
  // aria-label takes priority
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return ariaLabel.trim();

  // Explicit <label for="id">
  const id = el.getAttribute("id");
  if (id !== null && id.length > 0) {
    const labelEl = document.querySelector(`label[for="${id}"]`);
    if (labelEl !== null) {
      const text = labelEl.textContent?.trim();
      if (text && text.length > 0) return text;
    }
  }

  // Wrapping <label>
  const parent = el.closest("label");
  if (parent !== null) {
    // Get label text excluding the input's own value
    const text = parent.textContent?.trim();
    if (text && text.length > 0) return text;
  }

  // title fallback
  const title = el.getAttribute("title");
  if (title !== null && title.trim().length > 0) return title.trim();

  // button text content
  const tag = el.tagName.toLowerCase();
  if (tag === "button") {
    const text = el.textContent?.trim();
    if (text && text.length > 0) return text;
  }

  return undefined;
}

/**
 * Extract form models from the document.
 * B2-SG-005, B2-SG-013.
 */
function extractForms(registry: NodeIdRegistry): FormModel[] {
  const forms = document.querySelectorAll("form");
  const models: FormModel[] = [];

  for (const formEl of Array.from(forms)) {
    if (!(formEl instanceof HTMLFormElement)) continue;

    const nodeId = registry.idFor(formEl);

    const model: FormModel = {
      nodeId,
      method: (formEl.method?.toUpperCase() ?? "GET") || "GET",
      fields: [],
    };

    const formId = formEl.getAttribute("id");
    if (formId !== null && formId.length > 0) model.formId = formId;

    const formName = formEl.getAttribute("name");
    if (formName !== null && formName.length > 0) model.name = formName;

    const action = formEl.getAttribute("action");
    if (action !== null && action.length > 0) model.action = action;

    // Extract field elements
    const fieldElements = formEl.querySelectorAll("input, select, textarea, button");
    for (const fieldEl of Array.from(fieldElements)) {
      if (!(fieldEl instanceof HTMLElement)) continue;

      const fieldTag = fieldEl.tagName.toLowerCase();
      const fieldNodeId = registry.idFor(fieldEl);
      const fieldType = fieldEl.getAttribute("type") ?? undefined;

      const field: FormField = {
        tag: fieldTag,
        required: (fieldEl as HTMLInputElement).required ?? false,
        nodeId: fieldNodeId,
      };

      if (fieldType !== undefined) field.type = fieldType;

      const fieldName = fieldEl.getAttribute("name");
      if (fieldName !== null && fieldName.length > 0) field.name = fieldName;

      const label = resolveFieldLabel(fieldEl);
      if (label !== undefined) field.label = label;

      // B2-SG-013: password field value must be "[REDACTED]"
      if (fieldType === "password") {
        field.value = "[REDACTED]";
      } else {
        const value = (fieldEl as HTMLInputElement).value;
        if (value !== undefined && value !== null) {
          field.value = value;
        }
      }

      model.fields.push(field);
    }

    models.push(model);
  }

  return models;
}

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
 * B2-SG-009: Visibility filtering.
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

  // Build all four sub-trees
  const a11yTree = buildA11yTree(registry, effectiveMaxDepth, visibleOnly);
  const landmarks = extractLandmarks(registry);
  const outline = extractOutline(registry);
  const forms = extractForms(registry);

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
