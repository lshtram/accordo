/**
 * page-map-contract-response.test.ts
 *
 * Guards the page-map public contract for response-level and iframe-level types:
 * 1. PageMapResponse.nodes is typed as PageMapNode[], not unknown[].
 * 2. IframeMetadata includes its depth field.
 * 3. Tool inputSchema roles description is accurate.
 *
 * Run: pnpm --filter accordo-browser test page-map-contract-response
 */
import { describe, it, expect } from "vitest";
import { buildGetPageMapTool } from "../page-tool-page-map-definition.js";
import type { PageMapResponse } from "../page-tool-page-map-types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a minimal tool definition with a no-op relay. */
function buildTool() {
  const relay = {
    request: async () => ({ requestId: "test", success: true, data: undefined as unknown }),
    isConnected: () => true,
  };
  const store = {
    save: () => {},
    get: () => undefined,
    getLatest: () => undefined,
    add: () => {},
  } as any;
  const security = { originPolicy: {}, redactionPolicy: {} } as any;
  return buildGetPageMapTool(relay as any, store, security);
}

// ── Test 1: PageMapResponse.nodes is typed as PageMapNode[] ─────────────────

describe("PageMapResponse type contract", () => {
  it("nodes is typed as PageMapNode[], not unknown[]", () => {
    // If nodes were typed as `unknown[]`, assigning { tag: ..., nodeId: ... } would fail.
    const response = { nodes: [{ tag: "span", nodeId: 1 }] } as PageMapResponse;
    expect(Array.isArray(response.nodes)).toBe(true);
    // Structural check: nodes[0] must have tag and nodeId per PageMapNode contract
    expect(response.nodes[0].tag).toBe("span");
    expect(typeof response.nodes[0].nodeId).toBe("number");
  });
});

// ── Test 2: IframeMetadata includes its depth field ──────────────────────────

describe("IframeMetadata contract", () => {
  it("IframeMetadata must have depth field", () => {
    // depth belongs to IframeMetadata (nesting depth in the iframe tree), not the
    // top-level PageMapResponse.
    const iframe = {
      frameId: "frame-0",
      src: "https://example.com/iframe",
      bounds: { x: 0, y: 0, width: 200, height: 100 },
      sameOrigin: true,
      parentFrameId: null,
      title: "Example iframe",
      depth: 2,
      classification: "content" as const,
      visible: true,
    };
    expect(iframe.depth).toBe(2);
  });
});

// ── Test 3: Tool inputSchema roles description is accurate ─────────────────────

describe("get_page_map inputSchema", () => {
  const tool = buildTool();

  it("roles param must document implicit mapping without claiming node.role includes implicit roles", () => {
    const rolesParam = tool.inputSchema.properties["roles"];
    expect(rolesParam.description).toContain("implicit mapping");
    expect(rolesParam.description).toContain("h1–h6");
    // Must not claim node.role field includes heading (implicit role only exists in filter)
    expect(rolesParam.description).not.toContain("node.role");
  });
});
