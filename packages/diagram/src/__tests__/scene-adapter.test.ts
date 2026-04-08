/**
 * A16 — Scene adapter tests (Phase B — all RED until Phase C)
 *
 * Tests cover toExcalidrawPayload() and FONT_FAMILY_MAP in webview/scene-adapter.ts.
 * No VSCode mocks required — scene-adapter.ts is a pure Node.js module.
 *
 * Source: diag_workplan.md §4.16
 */

// API checklist:
// ✓ FONT_FAMILY_MAP — structural (allowed to pass on stub)
// ✓ toExcalidrawPayload — 7 tests (SA-01..SA-07) + 3 tests (H0-05a..H0-05c)

import { describe, it, expect } from "vitest";
import { toExcalidrawPayload, FONT_FAMILY_MAP } from "../webview/scene-adapter.js";
import type { ExcalidrawElement } from "../types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE: ExcalidrawElement = {
  id: "exc-1",
  mermaidId: "auth",
  type: "rectangle",
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  roughness: 1,
  fontFamily: "Excalifont",
};

// ── FONT_FAMILY_MAP structural contract (may pass on stub) ────────────────────

describe("FONT_FAMILY_MAP", () => {
  it("contains Excalifont → 1 for the pinned Excalidraw version", () => {
    expect(FONT_FAMILY_MAP["Excalifont"]).toBe(1);
  });
});

// ── SA-01..SA-05 ─────────────────────────────────────────────────────────────

describe("toExcalidrawPayload", () => {
  it("SA-01: id, type, x, y, width, height pass through unchanged", () => {
    const [el] = toExcalidrawPayload([BASE]);
    expect(el.id).toBe("exc-1");
    expect(el.type).toBe("rectangle");
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
    expect(el.width).toBe(100);
    expect(el.height).toBe(50);
  });

  it("SA-02: mermaidId absent from top level; present in customData.mermaidId", () => {
    const [el] = toExcalidrawPayload([BASE]);
    expect((el as unknown as Record<string, unknown>)["mermaidId"]).toBeUndefined();
    expect(el.customData.mermaidId).toBe("auth");
  });

  it("SA-03: fontFamily 'Excalifont' → fontFamily: 1 (FONT_FAMILY_MAP value)", () => {
    const [el] = toExcalidrawPayload([BASE]);
    expect(el.fontFamily).toBe(FONT_FAMILY_MAP["Excalifont"]);
    expect(el.fontFamily).toBe(1);
  });

  it("SA-04: unknown fontFamily string falls back to 1", () => {
    const src: ExcalidrawElement = { ...BASE, fontFamily: "UnknownFont" };
    const [el] = toExcalidrawPayload([src]);
    expect(el.fontFamily).toBe(1);
  });

  it("SA-05: arrow passes through points, startBinding, endBinding; customData.mermaidId set", () => {
    const arrow: ExcalidrawElement = {
      ...BASE,
      mermaidId: "A->B:0",
      type: "arrow",
      points: [[0, 0], [100, 50]],
      startBinding: { elementId: "exc-a", focus: 0, gap: 4 },
      endBinding: { elementId: "exc-b", focus: 0, gap: 4 },
    };
    const [el] = toExcalidrawPayload([arrow]);
    expect(el.points).toEqual([[0, 0], [100, 50]]);
    expect(el.startBinding).toEqual({ elementId: "exc-a", focus: 0, gap: 4 });
    expect(el.endBinding).toEqual({ elementId: "exc-b", focus: 0, gap: 4 });
    expect(el.customData.mermaidId).toBe("A->B:0");
  });

  it("SA-05b: arrow label is serialized and materialized as bound text", () => {
    const arrow: ExcalidrawElement = {
      ...BASE,
      mermaidId: "A->B:0",
      type: "arrow",
      points: [[0, 0], [100, 50]],
      label: "start",
    };
    const payload = toExcalidrawPayload([arrow]);

    const arrowEl = payload.find((e) => e.type === "arrow");
    const textEl = payload.find(
      (e) => e.type === "text" && e.containerId === "exc-1",
    ) as (ExcalidrawElement & { text?: string }) | undefined;

    expect(arrowEl).toBeDefined();
    expect((arrowEl as unknown as { label?: { text?: string } }).label?.text).toBe("start");
    expect(arrowEl?.boundElements).toEqual([
      { id: "exc-1:label", type: "text" },
    ]);
    expect(textEl).toBeDefined();
    expect(textEl?.text).toBe("start");
    expect(textEl?.containerId).toBe("exc-1");
  });

  it("SA-06: fillStyle solid on element passes through toExcalidrawPayload (not hardcoded to hachure)", () => {
    const el: ExcalidrawElement = {
      id: "exc-1",
      mermaidId: "auth",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      roughness: 1,
      fontFamily: "Excalifont",
      fillStyle: "solid",
    };
    const [result] = toExcalidrawPayload([el]);
    expect(result.fillStyle).toBe("solid");
  });

  it("SA-07: fillStyle absent on element → defaults to hachure in toExcalidrawPayload", () => {
    const el: ExcalidrawElement = {
      id: "exc-1",
      mermaidId: "auth",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      roughness: 1,
      fontFamily: "Excalifont",
    };
    const [result] = toExcalidrawPayload([el]);
    expect(result.fillStyle).toBe("hachure");
  });
});

// ── H0-05: Opacity passthrough ────────────────────────────────────────────────
// H0-05a: toExcalidrawPayload reads el.opacity; output equals el.opacity when
//         set; defaults to 100 when absent/undefined.
// H0-05b: Zero opacity is not clobbered — el.opacity === 0 → output === 0.
// H0-05c: At least 3 test cases: absent → 100, explicit 50 → 50, explicit 0 → 0.

describe("H0-05: opacity passthrough in toExcalidrawPayload", () => {
  it("H0-05a: element without opacity field → output opacity defaults to 100", () => {
    const el: ExcalidrawElement = {
      id: "exc-1",
      mermaidId: "auth",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      roughness: 1,
      fontFamily: "Excalifont",
      // opacity is absent
    };
    const [result] = toExcalidrawPayload([el]);
    expect(result.opacity).toBe(100);
  });

  it("H0-05a: element with opacity: 50 → output opacity === 50", () => {
    const el: ExcalidrawElement = {
      id: "exc-1",
      mermaidId: "auth",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      roughness: 1,
      fontFamily: "Excalifont",
      opacity: 50,
    };
    const [result] = toExcalidrawPayload([el]);
    expect(result.opacity).toBe(50);
  });

  it("H0-05b: element with opacity: 0 → output opacity === 0 (zero not clobbered by default)", () => {
    const el: ExcalidrawElement = {
      id: "exc-1",
      mermaidId: "auth",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      roughness: 1,
      fontFamily: "Excalifont",
      opacity: 0,
    };
    const [result] = toExcalidrawPayload([el]);
    expect(result.opacity).toBe(0);
  });

  it("H0-05c: element with opacity: 75 → output opacity === 75", () => {
    const el: ExcalidrawElement = {
      id: "exc-1",
      mermaidId: "auth",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      roughness: 1,
      fontFamily: "Excalifont",
      opacity: 75,
    };
    const [result] = toExcalidrawPayload([el]);
    expect(result.opacity).toBe(75);
  });

  it("H0-05c: element with opacity: 100 → output opacity === 100", () => {
    const el: ExcalidrawElement = {
      id: "exc-1",
      mermaidId: "auth",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      roughness: 1,
      fontFamily: "Excalifont",
      opacity: 100,
    };
    const [result] = toExcalidrawPayload([el]);
    expect(result.opacity).toBe(100);
  });
});
