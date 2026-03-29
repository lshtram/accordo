/**
 * M113-SEM — Landmark extractor.
 *
 * Extracts ARIA landmark regions from the document.
 *
 * B2-SG-003, B2-SG-009, B2-SG-014.
 *
 * @module
 */

import type { Landmark } from "./semantic-graph-types.js";
import type { NodeIdRegistry } from "./semantic-graph-helpers.js";
import {
  LANDMARK_ROLES,
  LANDMARK_TAG_ROLES,
  hasAccessibleLabel,
  isHidden,
} from "./semantic-graph-helpers.js";

// ── Label resolution ──────────────────────────────────────────────────────────

/** Resolve the landmark label from aria-label or aria-labelledby. */
function resolveLandmarkLabel(el: HTMLElement): string | undefined {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) {
    return ariaLabel.trim();
  }

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    const ref = document.getElementById(labelledBy.trim());
    if (ref !== null) {
      const text = ref.textContent?.trim();
      if (text) return text;
    }
  }

  return undefined;
}

// ── Role resolution (landmark-specific) ──────────────────────────────────────

/**
 * Resolve the landmark role for an element.
 *
 * Rules:
 * 1. Explicit role attribute — only admitted if it is in the landmark whitelist.
 * 2. Implicit role from tag — only landmark tags (LANDMARK_TAG_ROLES).
 * 3. <section> → "region" only when the element has an accessible label.
 *
 * Returns undefined when the element is not a landmark. B2-SG-003, B2-SG-014.
 */
function resolveLandmarkRole(el: HTMLElement): string | undefined {
  const tag = el.tagName.toLowerCase();

  // Check explicit role attribute first
  const explicitRole = el.getAttribute("role");
  if (explicitRole !== null && explicitRole.trim().length > 0) {
    const role = explicitRole.trim();
    // Only accept roles that are actually landmarks
    return LANDMARK_ROLES.has(role) ? role : undefined;
  }

  // <section> gets "region" only when labelled (B2-SG-014)
  if (tag === "section") {
    return hasAccessibleLabel(el) ? "region" : undefined;
  }

  // Implicit landmark role from tag
  return LANDMARK_TAG_ROLES[tag];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract landmark regions from the document.
 *
 * B2-SG-003: Only landmark roles are included.
 * B2-SG-009: Hidden elements excluded when visibleOnly is true.
 * B2-SG-014: Implicit mapping from landmark HTML tags; <search> supported.
 */
export function extractLandmarks(
  registry: NodeIdRegistry,
  visibleOnly: boolean,
): Landmark[] {
  const landmarks: Landmark[] = [];
  // Include semantic landmark tags + <section> + any element with a role attribute
  const selector = "header, nav, main, aside, footer, form, search, section, [role]";
  const elements = document.querySelectorAll(selector);

  for (const el of Array.from(elements)) {
    if (!(el instanceof HTMLElement)) continue;

    // B2-SG-009: visibility filtering
    if (visibleOnly && isHidden(el)) continue;

    const role = resolveLandmarkRole(el);
    if (role === undefined) continue;

    const nodeId = registry.idFor(el);
    const tag = el.tagName.toLowerCase();

    const landmark: Landmark = { role, nodeId, tag };

    const label = resolveLandmarkLabel(el);
    if (label !== undefined) landmark.label = label;

    landmarks.push(landmark);
  }

  return landmarks;
}
