import { SEMANTIC_CONTAINER_ROLES, SEMANTIC_CONTAINER_TAGS } from "./spatial-types.js";

export function findNearestContainer(element: Element): Element | null {
  let current: Element | null = element.parentElement;

  while (current !== null && current !== document.body) {
    const tagName = current.tagName?.toLowerCase();
    if (tagName && SEMANTIC_CONTAINER_TAGS.has(tagName)) {
      return current;
    }

    const role = current.getAttribute?.("role");
    if (role && SEMANTIC_CONTAINER_ROLES.has(role)) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}
