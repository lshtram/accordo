/**
 * M113-SEM — Document outline extractor (H1–H6).
 *
 * B2-SG-004, B2-SG-009.
 *
 * @module
 */

import type { OutlineHeading } from "./semantic-graph-types.js";
import type { NodeIdRegistry } from "./semantic-graph-helpers.js";
import { isHidden } from "./semantic-graph-helpers.js";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract heading outline from the document in DOM order.
 *
 * B2-SG-004: Headings in document order.
 * B2-SG-009: Hidden headings excluded when visibleOnly is true.
 */
export function extractOutline(
  registry: NodeIdRegistry,
  visibleOnly: boolean,
): OutlineHeading[] {
  const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
  const outline: OutlineHeading[] = [];

  for (const el of Array.from(headings)) {
    if (!(el instanceof HTMLElement)) continue;

    // B2-SG-009: visibility filtering
    if (visibleOnly && isHidden(el)) continue;

    const tag = el.tagName.toLowerCase();
    const levelMatch = tag.match(/^h([1-6])$/);
    if (levelMatch === null) continue;

    const level = parseInt(levelMatch[1] ?? "1", 10);
    const text = el.textContent?.trim() ?? "";
    if (text.length === 0) continue;

    const nodeId = registry.idFor(el);
    const heading: OutlineHeading = { level, text, nodeId };

    const id = el.getAttribute("id");
    if (id !== null && id.length > 0) heading.id = id;

    outline.push(heading);
  }

  return outline;
}
