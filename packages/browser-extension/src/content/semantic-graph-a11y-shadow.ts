import type { SemanticA11yNode } from "./semantic-graph-types.js";
import type { NodeIdRegistry } from "./semantic-graph-helpers.js";
import { collectElementStates, EXCLUDED_TAGS, getAccessibleName, getRole, isHidden } from "./semantic-graph-helpers.js";

export function buildA11yChildrenInShadow(
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
      const uid = registry.uidFor(child);
      const node: SemanticA11yNode = {
        role: childRole,
        nodeId,
        ...(uid !== undefined ? { uid } : {}),
        children: [],
        inShadowRoot: true,
        shadowHostId,
      };
      if (name !== undefined) node.name = name;
      if (childRole === "heading") {
        const levelMatch = child.tagName.toLowerCase().match(/^h([1-6])$/);
        if (levelMatch !== null) node.level = parseInt(levelMatch[1] ?? "1", 10);
      }
      const states = collectElementStates(child);
      if (states.length > 0) node.states = states;

      if (depth < maxDepth) {
        node.children = buildA11yChildrenInShadow(child, registry, depth + 1, maxDepth, visibleOnly, shadowHostId);
        if (child.shadowRoot) {
          const nestedHostId = nodeId;
          const nestedShadowChildren = buildA11yChildrenInShadow(child.shadowRoot, registry, depth + 1, maxDepth, visibleOnly, nestedHostId);
          node.children.push(...nestedShadowChildren);
        }
      }
      children.push(node);
    } else {
      if (depth < maxDepth) {
        const grandchildren = buildA11yChildrenInShadow(child, registry, depth, maxDepth, visibleOnly, shadowHostId);
        children.push(...grandchildren);
      }
      if (child.shadowRoot) {
        const nestedHostId = registry.idFor(child);
        const nestedShadowChildren = buildA11yChildrenInShadow(child.shadowRoot, registry, depth, maxDepth, visibleOnly, nestedHostId);
        children.push(...nestedShadowChildren);
      }
    }
  }

  return children;
}
