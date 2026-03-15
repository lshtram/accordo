/**
 * A3 — Layout store tests
 *
 * Tests cover the public contract of every export in layout/layout-store.ts.
 *
 * Tests are RED in Phase B (stubs throw "not implemented").
 * They turn GREEN in Phase C after implementation.
 *
 * I/O tests (readLayout, writeLayout) use a per-test tmpdir.
 * Pure mutator tests (patch*, remove*, addUnplaced) need no filesystem.
 *
 * Requirements: diag_arch_v4.2.md §5, diag_workplan.md §4.3
 *
 * LS-ID → function mapping (canonical):
 *   LS-01  layoutPathFor        — arch §5.1 (auxiliary file path derivation under .accordo/diagrams/)
 *   LS-02  createEmptyLayout    — arch §5.2 (empty layout shape and defaults)
 *   LS-03  createEmptyLayout    — arch §22  (aesthetics defaults: roughness=1, animationMode)
 *   LS-04  readLayout           — arch §5.3 (read + parse from disk; happy path)
 *   LS-05  readLayout           — arch §5.3 (returns null on missing / corrupt / unknown type)
 *   LS-06  writeLayout          — arch §5.4 (write serialised layout to disk)
 *   LS-07  patchNode            — arch §5.5 (immutable node field mutation)
 *   LS-08  patchEdge            — arch §5.6 (immutable edge field mutation)
 *   LS-09  patchCluster         — arch §5.7 (immutable cluster field mutation)
 *   LS-10  removeNode           — arch §5.8 (remove node by ID, no cascade)
 *   LS-11  removeEdge           — arch §5.9 (remove edge by key)
 *   LS-12  addUnplaced          — arch §5.10 (append to unplaced list with dedup)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  layoutPathFor,
  readLayout,
  writeLayout,
  createEmptyLayout,
  patchNode,
  patchEdge,
  patchCluster,
  removeNode,
  removeEdge,
  addUnplaced,
} from "../layout/layout-store.js";
import type { LayoutStore } from "../types.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

/**
 * Minimal two-node fixture — used for focused single-concern tests where a
 * small graph is deliberately easier to reason about (e.g. "is the return
 * value a new object?").
 */
function makeLayout(): LayoutStore {
  return {
    version: "1.0",
    diagram_type: "flowchart",
    nodes: {
      auth: { x: 100, y: 200, w: 180, h: 60, style: {} },
      api:  { x: 400, y: 200, w: 180, h: 60, style: {} },
    },
    edges: {
      "auth->api:0": { routing: "auto", waypoints: [], style: {} },
    },
    clusters: {
      zone: { x: 60, y: 160, w: 560, h: 140, label: "Zone", style: {} },
    },
    unplaced: [],
    aesthetics: { roughness: 1, animationMode: "draw-on", theme: "hand-drawn" },
  };
}

/**
 * Rich six-node microservices auth-flow fixture.
 *
 * Models a realistic gateway → auth-service → data-tier diagram with:
 *   - 6 nodes, some carrying seed values and style overrides
 *   - 6 edges including **two parallel pairs** (same src/dst, different ordinals)
 *       gateway->auth_svc:0  (login path — auto routing)
 *       gateway->auth_svc:1  (token-refresh path — orthogonal, has a waypoint)
 *       auth_svc->audit_log:0  (success audit — auto)
 *       auth_svc->audit_log:1  (failure audit — curved, two waypoints, stroke override)
 *   - 2 clusters with style overrides
 *   - 2 pre-populated unplaced IDs
 *
 * Used in tests that must exercise non-trivial isolation and identity logic
 * (parallel-edge immutability, multi-node patch isolation, unplaced dedup with
 * pre-existing entries, full round-trip fidelity).
 */
function makeRichLayout(): LayoutStore {
  return {
    version: "1.0",
    diagram_type: "flowchart",
    nodes: {
      gateway:       { x: 120, y:  80, w: 160, h: 56, style: { backgroundColor: "#e8f4fd" }, seed: 42 },
      auth_svc:      { x: 360, y:  80, w: 160, h: 56, style: { backgroundColor: "#fef9e7" } },
      user_db:       { x: 600, y:  80, w: 160, h: 56, style: {} },
      token_store:   { x: 360, y: 220, w: 160, h: 56, style: { backgroundColor: "#fdecea" }, seed: 7 },
      audit_log:     { x: 600, y: 220, w: 160, h: 56, style: {} },
      session_cache: { x: 120, y: 220, w: 160, h: 56, style: { strokeDash: true } },
    },
    edges: {
      // Parallel pair — login vs token-refresh from gateway to auth service
      "gateway->auth_svc:0": { routing: "auto",        waypoints: [],                                              style: {} },
      "gateway->auth_svc:1": { routing: "orthogonal",  waypoints: [{ x: 240, y: 150 }],                           style: { strokeDash: true } },
      // Single edges to data tier
      "auth_svc->user_db:0":     { routing: "auto",   waypoints: [],                                               style: {} },
      "auth_svc->token_store:0": { routing: "direct", waypoints: [],                                               style: {} },
      // Parallel pair — success vs failure audit paths
      "auth_svc->audit_log:0":   { routing: "auto",   waypoints: [],                                               style: {} },
      "auth_svc->audit_log:1":   { routing: "curved", waypoints: [{ x: 500, y: 180 }, { x: 560, y: 200 }],        style: { strokeColor: "#e74c3c", strokeWidth: 2 } },
    },
    clusters: {
      frontend_zone: { x:  60, y: 40, w: 220, h: 120, label: "Frontend",         style: {} },
      backend_zone:  { x: 300, y: 40, w: 520, h: 320, label: "Backend Services", style: { backgroundColor: "#f8f9fa" } },
    },
    unplaced: ["notification_svc", "metrics_agent"],
    aesthetics: { roughness: 1, animationMode: "draw-on", theme: "hand-drawn" },
  };
}

// ── Per-test tmpdir ───────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `layout-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── 1. layoutPathFor ──────────────────────────────────────────────────────────
// §3 two-file model: stores under <workspaceRoot>/.accordo/diagrams/<rel-path>

describe("layoutPathFor", () => {
  it("LS-01: places layout under .accordo/diagrams/ preserving relative path", () => {
    expect(layoutPathFor("/workspace/diagrams/arch.mmd", "/workspace")).toBe(
      "/workspace/.accordo/diagrams/diagrams/arch.layout.json"
    );
  });

  it("LS-01: works for a file at the workspace root level", () => {
    expect(layoutPathFor("/workspace/arch.mmd", "/workspace")).toBe(
      "/workspace/.accordo/diagrams/arch.layout.json"
    );
  });

  it("LS-01: handles nested subdirectory", () => {
    expect(layoutPathFor("/ws/a/b/c.mmd", "/ws")).toBe(
      "/ws/.accordo/diagrams/a/b/c.layout.json"
    );
  });
});

// ── 2. createEmptyLayout ──────────────────────────────────────────────────────
// §5 schema: version, diagram_type, empty collections, aesthetic defaults

describe("createEmptyLayout", () => {
  it("LS-02: version is '1.0'", () => {
    expect(createEmptyLayout("flowchart").version).toBe("1.0");
  });

  it("LS-02: diagram_type matches the supplied argument", () => {
    expect(createEmptyLayout("classDiagram").diagram_type).toBe("classDiagram");
  });

  it("LS-02: nodes is an empty object", () => {
    expect(createEmptyLayout("flowchart").nodes).toEqual({});
  });

  it("LS-02: edges is an empty object", () => {
    expect(createEmptyLayout("flowchart").edges).toEqual({});
  });

  it("LS-02: clusters is an empty object", () => {
    expect(createEmptyLayout("flowchart").clusters).toEqual({});
  });

  it("LS-02: unplaced is an empty array", () => {
    expect(createEmptyLayout("flowchart").unplaced).toEqual([]);
  });

  it("LS-03: aesthetics.roughness defaults to 1 (hand-drawn — §22)", () => {
    expect(createEmptyLayout("flowchart").aesthetics.roughness).toBe(1);
  });

  it("LS-03: aesthetics.animationMode defaults to 'static' (draw-on deferred to diag.2)", () => {
    expect(createEmptyLayout("flowchart").aesthetics.animationMode).toBe(
      "static"
    );
  });
});

// ── 3. readLayout — valid file ────────────────────────────────────────────────
// §5 read contract: parse *.layout.json into LayoutStore

describe("readLayout — valid file", () => {
  it("LS-04: returns a LayoutStore when the file contains valid JSON", async () => {
    const filePath = join(tmpDir, "valid.layout.json");
    await writeFile(filePath, JSON.stringify(makeLayout()), "utf-8");

    const result = await readLayout(filePath);

    expect(result).not.toBeNull();
    expect(result?.version).toBe("1.0");
    expect(result?.diagram_type).toBe("flowchart");
  });

  it("LS-04: parses nodes, edges, clusters, and aesthetics correctly", async () => {
    const filePath = join(tmpDir, "full.layout.json");
    const layout = makeLayout();
    await writeFile(filePath, JSON.stringify(layout), "utf-8");

    const result = await readLayout(filePath);

    expect(result?.nodes["auth"].x).toBe(100);
    expect(result?.edges["auth->api:0"].routing).toBe("auto");
    expect(result?.clusters["zone"].label).toBe("Zone");
    expect(result?.aesthetics.roughness).toBe(1);
  });
});

// ── 4. readLayout — error paths ───────────────────────────────────────────────
// §5 validation: null for missing, corrupt, wrong-version, non-spatial type

describe("readLayout — error paths", () => {
  it("LS-05: returns null when the file does not exist", async () => {
    const result = await readLayout(join(tmpDir, "does-not-exist.layout.json"));
    expect(result).toBeNull();
  });

  it("LS-05: returns null when the file contains corrupt JSON", async () => {
    const filePath = join(tmpDir, "corrupt.layout.json");
    await writeFile(filePath, "{ this is not valid json", "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("LS-05: returns null when version is not '1.0'", async () => {
    const filePath = join(tmpDir, "wrong-version.layout.json");
    const data = { ...makeLayout(), version: "2.0" };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("LS-05: returns null when diagram_type is a sequential (non-spatial) type", async () => {
    const filePath = join(tmpDir, "wrong-type.layout.json");
    // sequential diagrams do not get a layout sidecar (§2.2)
    const data = { ...makeLayout(), diagram_type: "sequenceDiagram" };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });
});

// ── 5. writeLayout ────────────────────────────────────────────────────────────
// §5 write contract: persist LayoutStore as JSON; round-trip safe

describe("writeLayout", () => {
  it("LS-06: writes a file that exists on disk afterwards", async () => {
    const filePath = join(tmpDir, "out.layout.json");
    await writeLayout(filePath, makeLayout());

    // Use node:fs directly to avoid circular dependency on readLayout correctness
    const raw = await readFile(filePath, "utf-8");
    expect(raw.length).toBeGreaterThan(0);
  });

  it("LS-06: written content is parseable JSON with correct top-level fields", async () => {
    const filePath = join(tmpDir, "out2.layout.json");
    await writeLayout(filePath, makeLayout());

    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["version"]).toBe("1.0");
    expect(parsed["diagram_type"]).toBe("flowchart");
    expect(typeof parsed["nodes"]).toBe("object");
  });

  it("LS-06: round-trip — writeLayout then readLayout returns an equivalent structure", async () => {
    const filePath = join(tmpDir, "roundtrip.layout.json");
    const original = makeLayout();
    await writeLayout(filePath, original);

    const result = await readLayout(filePath);
    expect(result).toEqual(original);
  });
});

// ── 6. patchNode ─────────────────────────────────────────────────────────────
// §5.1: per-node overrides; §5 immutable pattern

describe("patchNode", () => {
  it("LS-07: updates the specified fields on the target node", () => {
    const layout = makeLayout();
    const result = patchNode(layout, "auth", { x: 999, y: 888 });

    expect(result.nodes["auth"].x).toBe(999);
    expect(result.nodes["auth"].y).toBe(888);
  });

  it("LS-07: leaves unpatched fields on the node unchanged", () => {
    const layout = makeLayout();
    const result = patchNode(layout, "auth", { x: 999 });

    expect(result.nodes["auth"].w).toBe(180); // unpatched
    expect(result.nodes["auth"].h).toBe(60);  // unpatched
  });

  it("LS-07: returns a new LayoutStore — original is not mutated", () => {
    const layout = makeLayout();
    const result = patchNode(layout, "auth", { x: 999 });

    expect(result).not.toBe(layout);
    expect(layout.nodes["auth"].x).toBe(100); // original unchanged
  });

  it("LS-07: does not affect other nodes", () => {
    const layout = makeLayout();
    const result = patchNode(layout, "auth", { x: 999 });

    expect(result.nodes["api"]).toEqual(layout.nodes["api"]);
  });
});

// ── 7. patchEdge ─────────────────────────────────────────────────────────────
// §5.1: per-edge overrides; §5 immutable pattern

describe("patchEdge", () => {
  it("LS-08: updates the routing field on the target edge", () => {
    const layout = makeLayout();
    const result = patchEdge(layout, "auth->api:0", { routing: "orthogonal" });

    expect(result.edges["auth->api:0"].routing).toBe("orthogonal");
  });

  it("LS-08: returns a new LayoutStore — original is not mutated", () => {
    const layout = makeLayout();
    const result = patchEdge(layout, "auth->api:0", { routing: "direct" });

    expect(result).not.toBe(layout);
    expect(layout.edges["auth->api:0"].routing).toBe("auto"); // original unchanged
  });
});

// ── 8. patchCluster ──────────────────────────────────────────────────────────
// §5.1: per-cluster overrides; §5 immutable pattern

describe("patchCluster", () => {
  it("LS-09: updates position fields on the target cluster", () => {
    const layout = makeLayout();
    const result = patchCluster(layout, "zone", { x: 999, y: 888 });

    expect(result.clusters["zone"].x).toBe(999);
    expect(result.clusters["zone"].y).toBe(888);
  });

  it("LS-09: returns a new LayoutStore — original is not mutated", () => {
    const layout = makeLayout();
    const result = patchCluster(layout, "zone", { x: 999 });

    expect(result).not.toBe(layout);
    expect(layout.clusters["zone"].x).toBe(60); // original unchanged
  });
});

// ── 9. removeNode ─────────────────────────────────────────────────────────────
// reconciler contract: drop node from layout map; §5 immutable pattern

describe("removeNode", () => {
  it("LS-10: removes the named node from the nodes map", () => {
    const layout = makeLayout();
    const result = removeNode(layout, "auth");

    expect(result.nodes["auth"]).toBeUndefined();
  });

  it("LS-10: returns a new LayoutStore — original is not mutated", () => {
    const layout = makeLayout();
    const result = removeNode(layout, "auth");

    expect(result).not.toBe(layout);
    expect(layout.nodes["auth"]).toBeDefined(); // original unchanged
  });

  it("LS-10: does not remove other nodes", () => {
    const layout = makeLayout();
    const result = removeNode(layout, "auth");

    expect(result.nodes["api"]).toBeDefined();
  });
});

// ── 10. removeEdge ────────────────────────────────────────────────────────────
// reconciler contract: drop edge from layout map; §5 immutable pattern

describe("removeEdge", () => {
  it("LS-11: removes the named edge from the edges map", () => {
    const layout = makeLayout();
    const result = removeEdge(layout, "auth->api:0");

    expect(result.edges["auth->api:0"]).toBeUndefined();
  });

  it("LS-11: returns a new LayoutStore — original is not mutated", () => {
    const layout = makeLayout();
    const result = removeEdge(layout, "auth->api:0");

    expect(result).not.toBe(layout);
    expect(layout.edges["auth->api:0"]).toBeDefined(); // original unchanged
  });
});

// ── 11. addUnplaced ───────────────────────────────────────────────────────────
// §5 "unplaced" field: accumulates ids pending layout assignment; deduplicates

describe("addUnplaced", () => {
  it("LS-12: appends new node IDs to the unplaced array", () => {
    const layout = makeLayout(); // unplaced: []
    const result = addUnplaced(layout, ["n1", "n2"]);

    expect(result.unplaced).toContain("n1");
    expect(result.unplaced).toContain("n2");
  });

  it("LS-12: does not duplicate IDs already present in unplaced", () => {
    const layout = { ...makeLayout(), unplaced: ["already"] };
    const result = addUnplaced(layout, ["already", "new"]);

    const count = result.unplaced.filter((id) => id === "already").length;
    expect(count).toBe(1);
    expect(result.unplaced).toContain("new");
  });

  it("LS-12: returns a new LayoutStore — original is not mutated", () => {
    const layout = makeLayout();
    const result = addUnplaced(layout, ["x"]);

    expect(result).not.toBe(layout);
    expect(layout.unplaced).toHaveLength(0); // original unchanged
  });
});

// ── 12. Rich fixture — full round-trip integrity ──────────────────────────────
// LS-04 / LS-06: a complex layout (parallel edges, waypoints, seed values,
// multi-cluster, pre-populated unplaced) must survive write → read unchanged.

describe("round-trip with rich fixture", () => {
  it("LS-04 / LS-06: preserves all 6 nodes, including optional seed values", async () => {
    const filePath = join(tmpDir, "rich.layout.json");
    const original = makeRichLayout();
    await writeLayout(filePath, original);
    const result = await readLayout(filePath);

    expect(result?.nodes).toEqual(original.nodes);
    expect(result?.nodes["gateway"].seed).toBe(42);
    expect(result?.nodes["token_store"].seed).toBe(7);
    expect(result?.nodes["user_db"].seed).toBeUndefined();  // never set on plain nodes
  });

  it("LS-04 / LS-06: preserves parallel edges with waypoints and style overrides", async () => {
    const filePath = join(tmpDir, "rich-edges.layout.json");
    const original = makeRichLayout();
    await writeLayout(filePath, original);
    const result = await readLayout(filePath);

    // Plain edge
    expect(result?.edges["gateway->auth_svc:0"].routing).toBe("auto");
    // Parallel edge — different routing, has a waypoint
    expect(result?.edges["gateway->auth_svc:1"].routing).toBe("orthogonal");
    expect(result?.edges["gateway->auth_svc:1"].waypoints).toEqual([{ x: 240, y: 150 }]);
    // Two-waypoint edge with stroke override
    expect(result?.edges["auth_svc->audit_log:1"].waypoints).toHaveLength(2);
    expect(result?.edges["auth_svc->audit_log:1"].style).toEqual({ strokeColor: "#e74c3c", strokeWidth: 2 });
  });

  it("LS-04 / LS-06: preserves clusters, pre-populated unplaced list, and aesthetics", async () => {
    const filePath = join(tmpDir, "rich-meta.layout.json");
    const original = makeRichLayout();
    await writeLayout(filePath, original);
    const result = await readLayout(filePath);

    expect(result?.clusters["backend_zone"].label).toBe("Backend Services");
    expect(result?.clusters["backend_zone"].style).toEqual({ backgroundColor: "#f8f9fa" });
    expect(result?.unplaced).toEqual(["notification_svc", "metrics_agent"]);
    expect(result?.aesthetics).toEqual(original.aesthetics);
  });

  it("LS-06: second writeLayout to same path overwrites the first", async () => {
    const filePath = join(tmpDir, "overwrite.layout.json");
    await writeLayout(filePath, makeLayout()); // first write: 2 nodes

    const updated = { ...makeRichLayout(), diagram_type: "classDiagram" as const };
    await writeLayout(filePath, updated);      // second write: 6 nodes, different type

    const result = await readLayout(filePath);
    expect(result?.diagram_type).toBe("classDiagram");
    expect(Object.keys(result?.nodes ?? {})).toHaveLength(6);
  });
});

// ── 13. Parallel edge isolation ───────────────────────────────────────────────
// LS-08 / LS-11: patching or removing one ordinal of a parallel pair must leave
// the other ordinal completely untouched — this is the key correctness property
// of the edge-key identity scheme (EdgeKey = "from->to:ordinal").

describe("parallel edge isolation", () => {
  it("LS-08: patching gateway->auth_svc:0 routing does not change :1", () => {
    const layout = makeRichLayout();
    const result = patchEdge(layout, "gateway->auth_svc:0", { routing: "direct" });

    expect(result.edges["gateway->auth_svc:0"].routing).toBe("direct");
    // :1 must be byte-for-byte identical to the original
    expect(result.edges["gateway->auth_svc:1"].routing).toBe("orthogonal");
    expect(result.edges["gateway->auth_svc:1"].waypoints).toEqual([{ x: 240, y: 150 }]);
    expect(result.edges["gateway->auth_svc:1"].style).toEqual({ strokeDash: true });
  });

  it("LS-08: patching auth_svc->audit_log:1 waypoints does not change :0", () => {
    const layout = makeRichLayout();
    const newWaypoints = [{ x: 999, y: 999 }];
    const result = patchEdge(layout, "auth_svc->audit_log:1", { waypoints: newWaypoints });

    expect(result.edges["auth_svc->audit_log:1"].waypoints).toEqual(newWaypoints);
    // :0 is unaffected
    expect(result.edges["auth_svc->audit_log:0"].waypoints).toEqual([]);
    expect(result.edges["auth_svc->audit_log:0"].routing).toBe("auto");
  });

  it("LS-11: removing gateway->auth_svc:0 leaves gateway->auth_svc:1 intact", () => {
    const layout = makeRichLayout();
    const result = removeEdge(layout, "gateway->auth_svc:0");

    expect(result.edges["gateway->auth_svc:0"]).toBeUndefined();
    expect(result.edges["gateway->auth_svc:1"]).toBeDefined();
    expect(result.edges["gateway->auth_svc:1"].routing).toBe("orthogonal");
  });

  it("LS-11: removing auth_svc->audit_log:1 leaves auth_svc->audit_log:0 intact", () => {
    const layout = makeRichLayout();
    const result = removeEdge(layout, "auth_svc->audit_log:1");

    expect(result.edges["auth_svc->audit_log:1"]).toBeUndefined();
    expect(result.edges["auth_svc->audit_log:0"]).toBeDefined();
    expect(result.edges["auth_svc->audit_log:0"].routing).toBe("auto");
  });
});

// ── 14. Multi-node isolation ──────────────────────────────────────────────────
// LS-07 / LS-10: with 6 nodes, a mutation must touch exactly 1; the other 5
// must match the original reference identity (toEqual, no value drift).

describe("multi-node isolation", () => {
  it("LS-07: patching auth_svc leaves all 5 sibling nodes byte-for-byte unchanged", () => {
    const layout = makeRichLayout();
    const result = patchNode(layout, "auth_svc", { x: 9999, y: 9999, w: 1, h: 1 });

    expect(result.nodes["auth_svc"].x).toBe(9999);
    for (const id of ["gateway", "user_db", "token_store", "audit_log", "session_cache"] as const) {
      expect(result.nodes[id]).toEqual(layout.nodes[id]);
    }
  });

  it("LS-10: removing auth_svc removes exactly 1 node; incident edges are NOT auto-removed (reconciler's job)", () => {
    const layout = makeRichLayout();
    const result = removeNode(layout, "auth_svc");

    expect(result.nodes["auth_svc"]).toBeUndefined();
    expect(Object.keys(result.nodes)).toHaveLength(5); // was 6
    // The store does NOT cascade-delete edges — that is the reconciler's responsibility
    expect(result.edges["auth_svc->user_db:0"]).toBeDefined();
    expect(result.edges["auth_svc->token_store:0"]).toBeDefined();
    expect(result.edges["auth_svc->audit_log:0"]).toBeDefined();
    expect(result.edges["auth_svc->audit_log:1"]).toBeDefined();
  });
});

// ── 15. addUnplaced — intra-batch and pre-populated dedup ─────────────────────
// LS-12: duplicates within the new batch must also be collapsed, not just
// duplicates against the existing unplaced list.

describe("addUnplaced — deduplication edge cases", () => {
  it("LS-12: intra-batch duplicates are collapsed (only first occurrence retained)", () => {
    const layout = makeLayout(); // unplaced: []
    const result = addUnplaced(layout, ["tracing", "tracing", "metrics"]);

    expect(result.unplaced.filter((id) => id === "tracing")).toHaveLength(1);
    expect(result.unplaced).toContain("metrics");
    expect(result.unplaced).toHaveLength(2);
  });

  it("LS-12: adding to rich fixture's pre-populated list appends only genuinely new IDs", () => {
    const layout = makeRichLayout(); // unplaced: ["notification_svc", "metrics_agent"]
    const result = addUnplaced(layout, ["notification_svc", "tracing", "metrics_agent"]);

    // "tracing" is the only new entry
    expect(result.unplaced).toHaveLength(3);
    expect(result.unplaced).toEqual(["notification_svc", "metrics_agent", "tracing"]);
  });
});

// ── 16. readLayout accepts all six spatial diagram types ──────────────────────
// LS-05: each SpatialDiagramType must parse successfully; sequential types must
// not (covered in group 4). Explicit iteration avoids false-green from a test
// that only checks one representative value.

describe("readLayout — all spatial diagram types are valid", () => {
  const spatialTypes = [
    "flowchart",
    "block-beta",
    "classDiagram",
    "stateDiagram-v2",
    "erDiagram",
    "mindmap",
  ] as const;

  for (const diagramType of spatialTypes) {
    it(`LS-05: accepts diagram_type "${diagramType}"`, async () => {
      const safeName = diagramType.replace(/[^a-zA-Z0-9]/g, "_");
      const filePath = join(tmpDir, `${safeName}.layout.json`);
      const data: LayoutStore = { ...makeLayout(), diagram_type: diagramType };
      await writeFile(filePath, JSON.stringify(data), "utf-8");

      const result = await readLayout(filePath);

      expect(result).not.toBeNull();
      expect(result?.diagram_type).toBe(diagramType);
    });
  }
});
