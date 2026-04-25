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
import { buildA11yChildren } from "./semantic-graph-a11y-children.js";
import { buildA11yChildrenInShadow } from "./semantic-graph-a11y-shadow.js";

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
  const uid = registry.uidFor(el);

  const node: SemanticA11yNode = {
    role,
    nodeId,
    ...(uid !== undefined ? { uid } : {}),
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
    node.children = buildA11yChildren(el, registry, depth, maxDepth, visibleOnly, piercesShadow, buildA11yNode, shadowHostId);
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
      const flattened = buildA11yChildren(child, registry, 0, maxDepth, visibleOnly, piercesShadow, buildA11yNode);
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
