import type { SemanticA11yNode } from "./semantic-graph-types.js";
import type { NodeIdRegistry } from "./semantic-graph-helpers.js";
import { EXCLUDED_TAGS, getRole, isHidden } from "./semantic-graph-helpers.js";
import { buildA11yChildrenInShadow } from "./semantic-graph-a11y-shadow.js";

export function buildA11yChildren(
  el: HTMLElement,
  registry: NodeIdRegistry,
  depth: number,
  maxDepth: number,
  visibleOnly: boolean,
  piercesShadow: boolean,
  buildA11yNode: (
    el: HTMLElement,
    registry: NodeIdRegistry,
    depth: number,
    maxDepth: number,
    visibleOnly: boolean,
    piercesShadow: boolean,
    shadowHostId?: number,
  ) => SemanticA11yNode | null,
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
      if (childNode !== null) children.push(childNode);
    } else if (depth < maxDepth) {
      const grandchildren = buildA11yChildren(child, registry, depth, maxDepth, visibleOnly, piercesShadow, buildA11yNode, shadowHostId);
      children.push(...grandchildren);
    }

    if (piercesShadow && child.shadowRoot) {
      const hostNodeId = registry.idFor(child);
      const shadowChildren = buildA11yChildrenInShadow(child.shadowRoot, registry, depth, maxDepth, visibleOnly, hostNodeId);
      children.push(...shadowChildren);
    }
  }

  return children;
}
