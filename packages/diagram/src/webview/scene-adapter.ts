/**
 * A16 — Scene adapter: converts internal ExcalidrawElement[] (from canvas-generator)
 * to the payload shape expected by the Excalidraw imperative API.
 *
 * Used exactly once: in panel.ts._loadAndPost(), before posting host:load-scene.
 * The webview receives already-converted ExcalidrawAPIElement[] and calls
 * api.updateScene() directly — no adapter in the browser bundle.
 *
 * Key transformations:
 *   1. top-level `mermaidId` → `customData: { mermaidId }` so the webview
 *      can read it from Excalidraw's onChange element objects.
 *   2. `fontFamily: string` → `fontFamily: number` via FONT_FAMILY_MAP.
 *      Unknown strings fall back to 1 (Excalifont).
 *
 * No VSCode import — pure Node.js module, fully testable in vitest.
 *
 * Source: diag_workplan.md §4.16 / diag_arch_v4.2.md §9.4, §9.6
 *
 * Requirements:
 *   SA-01  id, type, x, y, width, height pass through unchanged
 *   SA-02  mermaidId absent from top level; present in customData.mermaidId
 *   SA-03  fontFamily "Excalifont" → 1
 *   SA-04  unknown fontFamily string falls back to 1
 *   SA-05  arrow: points, startBinding, endBinding pass through; customData set
 */

import type { ExcalidrawElement } from "../types.js";

// ── FNV-1a 32-bit hash ───────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash — stable per mermaidId, produces well-distributed
 * non-negative integers suitable for Rough.js seed.
 */
function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── ExcalidrawAPIElement ──────────────────────────────────────────────────────

/**
 * Minimal local interface for the Excalidraw API element payload.
 *
 * We use a local minimal interface (not imported from @excalidraw/excalidraw)
 * because Excalidraw's own type exports change between patch versions.
 * The SA-* tests enforce correctness at the boundary regardless of upstream
 * type definitions.
 */
export interface ExcalidrawAPIElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  opacity: number;
  angle: number;
  seed: number;
  groupIds: string[];
  frameId: string | null;
  boundElements: Array<{ id: string; type: string }> | null;
  updated: number;
  link: string | null;
  locked: boolean;
  /** Numeric font family code: 1=Excalifont, 2=Nunito, 3="Comic Shanns" */
  fontFamily: number;
  strokeColor: string;
  backgroundColor: string;
  roundness: { type: number } | null;
  points?: ReadonlyArray<[number, number]>;
  startBinding?: unknown;
  endBinding?: unknown;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  containerId?: string | null;
  /**
   * The webview identifies which Mermaid element was interacted with by reading
   * `element.customData.mermaidId` from the Excalidraw onChange element objects.
   * No host-side ID map required — mermaidId travels with the element.
   * `kind` is used for comment hit-testing to reconstruct the full blockId prefix.
   */
  customData: { mermaidId: string; kind?: string };
}

// ── FONT_FAMILY_MAP ───────────────────────────────────────────────────────────

/**
 * String → numeric font family mapping for the pinned Excalidraw version.
 * Numeric constants are version-specific; SA-03 tests the exact value so any
 * version drift is caught immediately rather than silently producing wrong renders.
 */
export const FONT_FAMILY_MAP: Readonly<Record<string, number>> = {
  Excalifont: 1,
  Nunito: 2,
  "Comic Shanns": 3,
} as const;

/**
 * Numeric → string font family mapping (reverse of FONT_FAMILY_MAP).
 * Used by detectNodeMutations (message-handler.ts) to convert Excalidraw's
 * numeric fontFamily back to the string name before persisting to layout JSON.
 *
 * Type uses Partial<Record<>> so that lookups on unknown numeric keys correctly
 * return `string | undefined` — the compiler enforces the null check required
 * by WF-15 (unknown fontFamily → skip, don't emit).
 */
export const REVERSE_FONT_FAMILY_MAP: Readonly<Partial<Record<number, "Excalifont" | "Nunito" | "Comic Shanns">>> = {
  1: "Excalifont",
  2: "Nunito",
  3: "Comic Shanns",
} as const;

// ── toExcalidrawPayload ───────────────────────────────────────────────────────

/**
 * SA-01 through SA-05
 * Convert internal ExcalidrawElement[] → ExcalidrawAPIElement[].
 *
 * updateScene() calls replaceAllElements() directly — no restoreElements().
 * Therefore every field required by Excalidraw must be present here.
 */
export function toExcalidrawPayload(
  elements: ExcalidrawElement[],
): ExcalidrawAPIElement[] {
  const now = Date.now();
  return elements.map((el) => {
    const { mermaidId, fontFamily, roundness, label, boundElements, containerId, ...rest } = el;

    const base: ExcalidrawAPIElement = {
      // ── Pass-through fields ──────────────────────────────────────────────
      ...rest,
      // ── Required Excalidraw fields (replaceAllElements needs them all) ───
      version: 1,
      versionNonce: fnv1a32((mermaidId ?? el.id) + ":nonce"),
      isDeleted: false,
      fillStyle: rest.fillStyle ?? ("hachure" as const),
      strokeWidth: rest.strokeWidth ?? 1,
      strokeStyle: rest.strokeStyle ?? ("solid" as const),
      opacity: 100,
      angle: 0,
      seed: fnv1a32(mermaidId ?? el.id),
      groupIds: [],
      frameId: null,
      updated: now,
      link: null,
      locked: false,
      strokeColor: rest.strokeColor ?? "#1e1e1e",
      backgroundColor: rest.backgroundColor ?? "transparent",
      // ── Mapped fields ────────────────────────────────────────────────────
      fontFamily: FONT_FAMILY_MAP[fontFamily] ?? 1,
      // Excalidraw roundness: { type: 2 } = PROPORTIONAL_RADIUS — radius scales
      // with element dimensions. Our numeric roundness (8=rounded, 32=stadium) controls
      // SHAPE selection in shape-map.ts; the actual radius is Excalidraw's PROPORTIONAL_RADIUS
      // applied to the element's w/h. No user-settable "amount" field exists in Excalidraw.
      roundness: roundness != null ? { type: 2 as const } : null,
      boundElements: boundElements ?? null,
      containerId: containerId ?? null,
      customData: { mermaidId, kind: el.kind },
    };

    // Text elements need text-specific required fields.
    if (el.type === "text") {
      const b = base as unknown as Record<string, unknown>;
      b.text = label ?? "";
      b.fontSize = el.fontSize ?? 16;
      b.textAlign = "center";
      b.verticalAlign = "middle";
      // Use the containerId from the element (bound text) or null (standalone).
      b.containerId = containerId ?? null;
      b.originalText = label ?? "";
      b.lineHeight = 1.25;
    }

    // Arrow elements need explicit arrowhead fields.
    if (el.type === "arrow") {
      const b = base as unknown as Record<string, unknown>;
      b.startArrowhead = null;
      b.endArrowhead = "arrow";
    }

    return base;
  });
}
