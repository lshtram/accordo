/**
 * M113-SEM — Accessibility tree builder.
 *
 * Recursively walks the DOM and produces an array of SemanticA11yNode.
 *
 * B2-SG-001, B2-SG-002, B2-SG-008, B2-SG-009.
 * B2-VD-001..002: Shadow DOM traversal when piercesShadow is true.
 *
 * @module
 */

import type { SemanticA11yNode } from "./semantic-graph-types.js";
import type { NodeIdRegistry } from "./semantic-graph-helpers.js";
import {
  collectElementStates,
  EXCLUDED_TAGS,
  getAccessibleName,
  getRole,
  isHidden,
} from "./semantic-graph-helpers.js";

// ── Internal helpers ──────────────────────────────────────────────────────────

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
  piercesShadow: boolean,
  shadowHostId?: number,
): SemanticA11yNode[] {
  const children: SemanticA11yNode[] = [];

  for (const child of Array.from(el.children)) {
    if (!(child instanceof HTMLElement)) continue;

    const childTag = child.tagName.toLowerCase();
    if (EXCLUDED_TAGS.has(childTag)) continue;
    if (visibleOnly && isHidden(child)) continue;

    const childRole = getRole(child);
    if (childRole !== undefined) {
      const childNode = buildA11yNode(child, registry, depth + 1, maxDepth, visibleOnly, piercesShadow, shadowHostId);
      if (childNode !== null) {
        children.push(childNode);
      }
    } else {
      // Child has no role — flatten its children up into the current node
      if (depth < maxDepth) {
        const grandchildren = buildA11yChildren(child, registry, depth, maxDepth, visibleOnly, piercesShadow, shadowHostId);
        children.push(...grandchildren);
      }
    }

    // B2-VD-001: If piercesShadow and child has an open shadow root, traverse it
    if (piercesShadow && child.shadowRoot) {
      const hostNodeId = registry.idFor(child);
      const shadowChildren = buildA11yChildrenInShadow(child.shadowRoot, registry, depth, maxDepth, visibleOnly, hostNodeId);
      children.push(...shadowChildren);
    }
  }

  return children;
}

/**
 * Build SemanticA11yNode array from an element collection that lives inside a shadow tree.
 * B2-VD-001: Annotates all shadow nodes with inShadowRoot + shadowHostId.
 * B2-VD-002: Handles nested shadow roots by updating shadowHostId at each host boundary.
 */
function buildA11yChildrenInShadow(
  parentEl: HTMLElement | ShadowRoot,
  registry: NodeIdRegistry,
  depth: number,
  maxDepth: number,
  visibleOnly: boolean,
  shadowHostId: number,
): SemanticA11yNode[] {
  const children: SemanticA11yNode[] = [];

  for (const child of Array.from(parentEl.children)) {
    if (!(child instanceof HTMLElement)) continue;

    const childTag = child.tagName.toLowerCase();
    if (EXCLUDED_TAGS.has(childTag)) continue;
    if (visibleOnly && isHidden(child)) continue;

    const childRole = getRole(child);
    if (childRole !== undefined) {
      const nodeId = registry.idFor(child);
      const name = getAccessibleName(child);

      const node: SemanticA11yNode = {
        role: childRole,
        nodeId,
        children: [],
        inShadowRoot: true,
        shadowHostId,
      };

      if (name !== undefined) node.name = name;

      // Heading level
      const childTagLower = child.tagName.toLowerCase();
      if (childRole === "heading") {
        const levelMatch = childTagLower.match(/^h([1-6])$/);
        if (levelMatch !== null) {
          node.level = parseInt(levelMatch[1] ?? "1", 10);
        }
      }

      // MCP-A11Y-002: Collect states
      const states = collectElementStates(child);
      if (states.length > 0) node.states = states;

      if (depth < maxDepth) {
        // Recurse into this shadow child's regular children
        node.children = buildA11yChildrenInShadow(child, registry, depth + 1, maxDepth, visibleOnly, shadowHostId);

        // B2-VD-002: If this child itself is a shadow host, traverse its shadow root
        // The new shadow host ID is this child's nodeId
        if (child.shadowRoot) {
          const nestedHostId = nodeId;
          const nestedShadowChildren = buildA11yChildrenInShadow(child.shadowRoot, registry, depth + 1, maxDepth, visibleOnly, nestedHostId);
          node.children.push(...nestedShadowChildren);
        }
      }

      children.push(node);
    } else {
      // No role — flatten: recurse into children
      if (depth < maxDepth) {
        const grandchildren = buildA11yChildrenInShadow(child, registry, depth, maxDepth, visibleOnly, shadowHostId);
        children.push(...grandchildren);
      }

      // B2-VD-002: Even a role-less element may be a shadow host — traverse it
      if (child.shadowRoot) {
        const nestedHostId = registry.idFor(child);
        const nestedShadowChildren = buildA11yChildrenInShadow(child.shadowRoot, registry, depth, maxDepth, visibleOnly, nestedHostId);
        children.push(...nestedShadowChildren);
      }
    }
  }

  return children;
}

/**
 * Recursively build a SemanticA11yNode from a DOM element.
 * Skips excluded tags, optionally skips hidden elements, and limits depth.
 *
 * B2-SG-001: DOM traversal.
 * B2-SG-002: role/name/nodeId/children.
 * B2-SG-008: maxDepth limiting.
 * B2-SG-009: visibleOnly filtering.
 * B2-VD-001..002: Shadow DOM annotation.
 */
function buildA11yNode(
  el: HTMLElement,
  registry: NodeIdRegistry,
  depth: number,
  maxDepth: number,
  visibleOnly: boolean,
  piercesShadow: boolean,
  shadowHostId?: number,
): SemanticA11yNode | null {
  const tag = el.tagName.toLowerCase();

  if (EXCLUDED_TAGS.has(tag)) return null;
  if (visibleOnly && isHidden(el)) return null;

  const role = getRole(el);

  if (role === undefined) {
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

  // B2-VD-001..002: Annotate shadow nodes
  if (shadowHostId !== undefined) {
    node.inShadowRoot = true;
    node.shadowHostId = shadowHostId;
  }

  // MCP-A11Y-002: Collect accessibility/actionability states
  const states = collectElementStates(el);
  if (states.length > 0) node.states = states;

  // Heading level
  if (role === "heading") {
    const levelMatch = tag.match(/^h([1-6])$/);
    if (levelMatch !== null) {
      node.level = parseInt(levelMatch[1] ?? "1", 10);
    }
  }

  if (depth < maxDepth) {
    node.children = buildA11yChildren(el, registry, depth, maxDepth, visibleOnly, piercesShadow, shadowHostId);
  }

  return node;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the full a11y tree from document.body.
 * B2-SG-001, B2-SG-002, B2-SG-008, B2-SG-009.
 * B2-VD-001..002: piercesShadow traverses open shadow roots.
 */
export function buildA11yTree(
  registry: NodeIdRegistry,
  maxDepth: number,
  visibleOnly: boolean,
  piercesShadow = false,
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
      const node = buildA11yNode(child, registry, 1, maxDepth, visibleOnly, piercesShadow);
      if (node !== null) roots.push(node);
    } else {
      const flattened = buildA11yChildren(child, registry, 0, maxDepth, visibleOnly, piercesShadow);
      roots.push(...flattened);
    }

    // B2-VD-001: If piercesShadow and child has an open shadow root, traverse it
    if (piercesShadow && child.shadowRoot) {
      const hostNodeId = registry.idFor(child);
      const shadowChildren = buildA11yChildrenInShadow(child.shadowRoot, registry, 0, maxDepth, visibleOnly, hostNodeId);
      roots.push(...shadowChildren);
    }
  }

  return roots;
}
