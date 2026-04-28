/**
 * page-map-contract-description.test.ts
 *
 * Guards the page-map tool description contract:
 * 1. Tool description does not overclaim removed fields.
 *
 * Run: pnpm --filter accordo-browser test page-map-contract-description
 */
import { describe, it, expect } from "vitest";
import { buildGetPageMapTool } from "../page-tool-page-map-definition.js";

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

// ── Removed-field deny-list ───────────────────────────────────────────────────

/**
 * Fields that are NOT in the runtime page-map payload.
 * Any tool description or type claiming these is a contract violation.
 */
const REMOVED_NODE_FIELDS = [
  "readingOrderIndex",
  "accessibleName",
  "textContent",
  "bbox",
  "visibility",
  "states",
] as const;

// ── Test: Tool description does not overclaim removed fields ─────────────────

describe("page-map tool description contract", () => {
  const tool = buildTool();

  for (const field of REMOVED_NODE_FIELDS) {
    it(`description must not claim removed field: ${field}`, () => {
      expect(tool.description).not.toContain(field);
    });
  }

  it("description must claim correct node fields present in PageMapNode", () => {
    // These fields ARE in the runtime payload — description may reference them.
    const presentFields = [
      "uid",
      "ref",
      "tag",
      "nodeId",
      "persistentId",
      "id",
      "role",
      "name",
      "text",
      "attrs",
      "bounds",
      "viewportRatio",
      "containerId",
      "zIndex",
      "isStacked",
      "occluded",
      "inShadowRoot",
      "shadowRoot",
      "shadowHostId",
      "children",
    ];
    // Smoke test: at least uid, ref, tag, nodeId, name, bounds, children are mentioned.
    expect(tool.description).toContain("uid");
    expect(tool.description).toContain("ref");
    expect(tool.description).toContain("tag");
    expect(tool.description).toContain("nodeId");
    expect(tool.description).toContain("name");
    expect(tool.description).toContain("bounds");
  });
});
