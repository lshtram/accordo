/**
 * H0-04: Layout-store structural validation tests
 *
 * H0-04a: readLayout() validates `nodes` shape — returns null if nodes is not
 *         a plain object, or if any node entry lacks numeric x, y, w, h or
 *         object style.
 * H0-04b: readLayout() validates `edges` shape — returns null if edges is not
 *         a plain object, or if any edge entry lacks string routing or array
 *         waypoints.
 * H0-04c: readLayout() validates `clusters` shape — returns null if clusters
 *         is not a plain object, or if any cluster entry lacks numeric x, y,
 *         w, h or string label.
 * H0-04d: readLayout() validates `unplaced` shape — returns null if unplaced
 *         is not an array of strings.
 * H0-04e: readLayout() validates `aesthetics` shape — returns null if
 *         aesthetics is not a plain object.
 * H0-04f: At least 8 test cases covering each validation rule.
 *
 * Determinism: per-test directories use a fixed incrementing counter with no
 * Date.now() or Math.random() — tests are fully deterministic.
 *
 * RED state: assertion-level via expect(result).toBeNull() which catches the
 * gap where readLayout returns the corrupt LayoutStore instead of null.
 *
 * Requirements: requirements-diagram-hardening.md §H0-04
 * Requirement IDs: H0-04a, H0-04b, H0-04c, H0-04d, H0-04e, H0-04f
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLayout } from "../layout/layout-store.js";
import type { LayoutStore } from "../types.js";

// ── Deterministic per-test tmpdir ────────────────────────────────────────────
// No Date.now() or Math.random() — a module-level counter is stable across runs.

let _dirCounter = 0;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `layout-store-valid-${++_dirCounter}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Valid fixture ─────────────────────────────────────────────────────────────

function makeValidLayout(): LayoutStore {
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

// ── H0-04a: nodes shape validation ────────────────────────────────────────────

describe("H0-04a: readLayout() validates `nodes` shape", () => {
  it("H0-04a: valid nodes object → LayoutStore returned (not null)", async () => {
    const filePath = join(tmpDir, "valid-nodes.layout.json");
    await writeFile(filePath, JSON.stringify(makeValidLayout()), "utf-8");

    const result = await readLayout(filePath);
    expect(result).not.toBeNull();
  });

  it("H0-04a: nodes is missing → null", async () => {
    const filePath = join(tmpDir, "missing-nodes.layout.json");
    const data = {
      version: "1.0",
      diagram_type: "flowchart",
      edges: {},
      clusters: {},
      unplaced: [],
      aesthetics: {},
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04a: nodes is a string (not an object) → null", async () => {
    const filePath = join(tmpDir, "nodes-string.layout.json");
    const data = { ...makeValidLayout(), nodes: "not-an-object" };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04a: node entry has string x → null", async () => {
    const filePath = join(tmpDir, "node-string-x.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      nodes: {
        auth: { x: "100" as unknown as number, y: 200, w: 180, h: 60, style: {} },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04a: node entry has string y → null", async () => {
    const filePath = join(tmpDir, "node-string-y.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      nodes: {
        auth: { x: 100, y: "200" as unknown as number, w: 180, h: 60, style: {} },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04a: node entry has non-numeric w → null", async () => {
    const filePath = join(tmpDir, "node-nan-w.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      nodes: {
        auth: { x: 100, y: 200, w: NaN, h: 60, style: {} },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04a: node entry has missing style → null", async () => {
    const filePath = join(tmpDir, "node-missing-style.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      nodes: {
        auth: { x: 100, y: 200, w: 180, h: 60 },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04a: node entry has non-object style → null", async () => {
    const filePath = join(tmpDir, "node-bad-style.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      nodes: {
        auth: { x: 100, y: 200, w: 180, h: 60, style: "not-an-object" as unknown as {} },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });
});

// ── H0-04b: edges shape validation ────────────────────────────────────────────

describe("H0-04b: readLayout() validates `edges` shape", () => {
  it("H0-04b: valid edges object → LayoutStore returned (not null)", async () => {
    const filePath = join(tmpDir, "valid-edges.layout.json");
    await writeFile(filePath, JSON.stringify(makeValidLayout()), "utf-8");

    const result = await readLayout(filePath);
    expect(result).not.toBeNull();
  });

  it("H0-04b: edges is a string (not an object) → null", async () => {
    const filePath = join(tmpDir, "edges-string.layout.json");
    const data = { ...makeValidLayout(), edges: "not-an-object" };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04b: edge entry has missing routing → null", async () => {
    const filePath = join(tmpDir, "edge-missing-routing.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      edges: {
        "auth->api:0": { waypoints: [], style: {} },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04b: edge entry has non-string routing → null", async () => {
    const filePath = join(tmpDir, "edge-bad-routing.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      edges: {
        "auth->api:0": { routing: 42 as unknown as string, waypoints: [], style: {} },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04b: edge entry has non-array waypoints → null", async () => {
    const filePath = join(tmpDir, "edge-bad-waypoints.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      edges: {
        "auth->api:0": { routing: "auto", waypoints: "not-an-array" as unknown as [], style: {} },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04b: edge entry has non-numeric waypoint coordinates → null", async () => {
    const filePath = join(tmpDir, "edge-bad-waypoint-coords.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      edges: {
        "auth->api:0": {
          routing: "auto",
          waypoints: [{ x: "bad" as unknown as number, y: 200 }],
          style: {},
        },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });
});

// ── H0-04c: clusters shape validation ──────────────────────────────────────────

describe("H0-04c: readLayout() validates `clusters` shape", () => {
  it("H0-04c: clusters is a string (not an object) → null", async () => {
    const filePath = join(tmpDir, "clusters-string.layout.json");
    const data = { ...makeValidLayout(), clusters: "not-an-object" };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04c: cluster entry has missing label → null", async () => {
    const filePath = join(tmpDir, "cluster-missing-label.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      clusters: {
        zone: { x: 60, y: 160, w: 560, h: 140, style: {} },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04c: cluster entry has non-string label → null", async () => {
    const filePath = join(tmpDir, "cluster-bad-label.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      clusters: {
        zone: { x: 60, y: 160, w: 560, h: 140, label: 42 as unknown as string, style: {} },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04c: cluster entry has non-numeric x → null", async () => {
    const filePath = join(tmpDir, "cluster-bad-x.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      clusters: {
        zone: { x: "sixty" as unknown as number, y: 160, w: 560, h: 140, label: "Zone", style: {} },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });
});

// ── H0-04d: unplaced shape validation ────────────────────────────────────────

describe("H0-04d: readLayout() validates `unplaced` shape", () => {
  it("H0-04d: unplaced is a string (not an array) → null", async () => {
    const filePath = join(tmpDir, "unplaced-string.layout.json");
    const data = { ...makeValidLayout(), unplaced: "not-an-array" };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04d: unplaced array contains a number (not a string) → null", async () => {
    const filePath = join(tmpDir, "unplaced-bad-element.layout.json");
    const data = { ...makeValidLayout(), unplaced: ["node1", 42, "node3"] };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04d: unplaced is null → null", async () => {
    const filePath = join(tmpDir, "unplaced-null.layout.json");
    const data = { ...makeValidLayout(), unplaced: null };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });
});

// ── H0-04e: aesthetics shape validation ──────────────────────────────────────

describe("H0-04e: readLayout() validates `aesthetics` shape", () => {
  it("H0-04e: aesthetics is a string (not an object) → null", async () => {
    const filePath = join(tmpDir, "aesthetics-string.layout.json");
    const data = { ...makeValidLayout(), aesthetics: "not-an-object" };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04e: aesthetics is null → null", async () => {
    const filePath = join(tmpDir, "aesthetics-null.layout.json");
    const data = { ...makeValidLayout(), aesthetics: null };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });
});

// ── H0-04f: Aggregate — at least 9 structural violation cases ──────────────
// H0-04f requires ≥ 8 test cases. We use 9 named cases (no template expression
// strings, no unused fields) with a clear assertion per case.

describe("H0-04f: validation coverage — at least 8 structural violation cases", () => {
  it("H0-04f: nodes is a string → returns null", async () => {
    const filePath = join(tmpDir, "h0-04f-nodes-string.layout.json");
    const data = { ...makeValidLayout(), nodes: "not-an-object" };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04f: nodes entry has string x → returns null", async () => {
    const filePath = join(tmpDir, "h0-04f-node-string-x.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      nodes: { auth: { x: "100" as unknown as number, y: 200, w: 180, h: 60, style: {} } },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04f: edge entry missing routing → returns null", async () => {
    const filePath = join(tmpDir, "h0-04f-edge-no-routing.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      edges: { "auth->api:0": { waypoints: [], style: {} } },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04f: edge waypoints is a string → returns null", async () => {
    const filePath = join(tmpDir, "h0-04f-edge-string-waypoints.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      edges: {
        "auth->api:0": {
          routing: "auto",
          waypoints: "not-an-array" as unknown as [],
          style: {},
        },
      },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04f: cluster entry missing label → returns null", async () => {
    const filePath = join(tmpDir, "h0-04f-cluster-no-label.layout.json");
    const data: LayoutStore = {
      ...makeValidLayout(),
      clusters: { zone: { x: 60, y: 160, w: 560, h: 140, style: {} } },
    };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04f: unplaced is a string → returns null", async () => {
    const filePath = join(tmpDir, "h0-04f-unplaced-string.layout.json");
    const data = { ...makeValidLayout(), unplaced: "not-an-array" };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04f: unplaced contains non-string element → returns null", async () => {
    const filePath = join(tmpDir, "h0-04f-unplaced-bad-element.layout.json");
    const data = { ...makeValidLayout(), unplaced: ["node1", 42, "node3"] };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04f: aesthetics is a string → returns null", async () => {
    const filePath = join(tmpDir, "h0-04f-aesthetics-string.layout.json");
    const data = { ...makeValidLayout(), aesthetics: "not-an-object" };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });

  it("H0-04f: aesthetics is null → returns null", async () => {
    const filePath = join(tmpDir, "h0-04f-aesthetics-null.layout.json");
    const data = { ...makeValidLayout(), aesthetics: null };
    await writeFile(filePath, JSON.stringify(data), "utf-8");

    const result = await readLayout(filePath);
    expect(result).toBeNull();
  });
});
