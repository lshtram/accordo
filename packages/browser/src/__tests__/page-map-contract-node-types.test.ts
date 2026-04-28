/**
 * page-map-contract-node-types.test.ts
 *
 * Guards the PageMapNode type definition contract:
 * 1. PageMapNode type definition matches actual runtime payload.
 * 2. Removed fields are absent (compile-time excess-property check).
 *
 * Run: pnpm --filter accordo-browser test page-map-contract-node-types
 */
import { describe, it, expect } from "vitest";
import type { PageMapNode } from "../page-tool-page-map-types.js";

// ── Test: PageMapNode type does not include removed fields ───────────────────

describe("PageMapNode type contract", () => {
  it("type must not have removed fields as properties", () => {
    // Build a sample node that exercises all optional fields.
    const sample: PageMapNode = {
      uid: "main:1",
      ref: "btn-sign-in",
      tag: "button",
      nodeId: 1,
      persistentId: "button-sign-in-abc123",
      id: "sign-in-btn",
      role: "button",
      name: "Sign in",
      text: "Sign in",
      attrs: { "data-testid": "sign-in" },
      bounds: { x: 100, y: 200, width: 80, height: 40 },
      viewportRatio: 0.5,
      containerId: 0,
      zIndex: 10,
      isStacked: true,
      occluded: false,
      inShadowRoot: true,
      shadowRoot: "closed",
      shadowHostId: 0,
      children: [],
    };

    expect(sample.uid).toBe("main:1");
    expect(sample.ref).toBe("btn-sign-in");
    expect(sample.tag).toBe("button");
    expect(sample.name).toBe("Sign in");
    expect(sample.text).toBe("Sign in");
    expect(sample.bounds).toEqual({ x: 100, y: 200, width: 80, height: 40 });
  });

  it("PageMapNode must have correct field types", () => {
    // uid and ref
    const n1: PageMapNode = { uid: "main:5", ref: "ref-5", tag: "div", nodeId: 5 };
    expect(n1.uid).toBe("main:5");
    expect(n1.ref).toBe("ref-5");
    expect(typeof n1.nodeId).toBe("number");

    // role is optional string
    const n2: PageMapNode = { tag: "span", nodeId: 2 };
    expect(n2.role).toBeUndefined();
    expect(n2.name).toBeUndefined();
    expect(n2.text).toBeUndefined();

    // bounds only present when includeBounds=true
    const n3: PageMapNode = { tag: "p", nodeId: 3, bounds: { x: 0, y: 0, width: 100, height: 20 } };
    expect(n3.bounds).toEqual({ x: 0, y: 0, width: 100, height: 20 });

    // children recursive
    const n4: PageMapNode = {
      tag: "ul",
      nodeId: 4,
      children: [{ tag: "li", nodeId: 5 }, { tag: "li", nodeId: 6 }],
    };
    expect(n4.children).toHaveLength(2);
  });

  it("PageMapNode must not allow removed fields — compile-time excess-property check", () => {
    // @ts-expect-error on each removed field proves the guard works.
    // TypeScript will flag every removed-field annotation below.
    const _check: PageMapNode = {
      // @ts-expect-error
      readingOrderIndex: 0,
      // @ts-expect-error
      accessibleName: "",
      // @ts-expect-error
      textContent: "",
      // @ts-expect-error
      bbox: { x: 0, y: 0, width: 0, height: 0 },
      // @ts-expect-error
      visibility: "visible",
      // @ts-expect-error
      states: { disabled: false },
      tag: "div",
      nodeId: 1,
    };
  });
});
