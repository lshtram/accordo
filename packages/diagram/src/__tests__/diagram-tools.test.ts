/**
 * A14 — diagram-tools tests  (Phase B — all RED, all turn GREEN in Phase C)
 *
 * Tests cover the full public contract of diagram-tools.ts:
 *   – ToolResult envelope shape         DT-01..DT-03
 *   – resolveGuarded path guard         DT-04..DT-06
 *   – listHandler                       DT-07..DT-11
 *   – getHandler                        DT-12..DT-17
 *   – createHandler                     DT-18..DT-24
 *   – patchHandler                      DT-25..DT-35
 *   – renderHandler                     DT-36..DT-41
 *   – styleGuideHandler                 DT-42..DT-46
 *   – createDiagramTools array          DT-47..DT-48
 *   – patchHandler nodeStyles A14-v2    DT-49..DT-52
 *   – patchHandler placeNodes() fix      DT-53..DT-58
 *   – patchHandler edgeStyles T-01       DT-59..DT-66
 *
 * BACKFILL NOTE (A14-v2): DT-49..DT-52 were written after the width/height
 * segregation and new style fields were implemented (implementation-before-test
 * exception agreed by reviewer). The implementation already exists; these tests
 * verify its contract.
 *
 * Source: diag_workplan.md §4.14
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, basename, dirname } from "node:path";

import {
  DiagToolError,
  resolveGuarded,
  listHandler,
  getHandler,
  createHandler,
  patchHandler,
  renderHandler,
  styleGuideHandler,
  createDiagramTools,
} from "../tools/diagram-tools.js";
import { layoutPathFor } from "../layout/layout-store.js";
import type {
  DiagramToolContext,
  DiagramPanelLike,
  DiagramListEntry,
  DiagramGetResult,
  DiagramCreateResult,
  DiagramPatchResult,
  DiagramRenderResult,
  DiagramStyleGuideResult,
  ToolResult,
  ErrorCode,
} from "../tools/diagram-tools.js";
import type { DiagramType, ParsedNode, ParsedEdge, ParsedCluster } from "../types.js";

// ── Small flowchart used by many tests ───────────────────────────────────────

const SIMPLE_FLOWCHART = "flowchart TD\nA-->B\n";
const TWO_NODE_FLOWCHART = "flowchart TD\nX-->Y\n";
const INVALID_MERMAID = "this is not valid mermaid source at all\n";

// ── Fresh tmpdir helpers ──────────────────────────────────────────────────────

let tmpDir: string;

function makeCtx(overrides?: Partial<DiagramToolContext>): DiagramToolContext {
  return {
    workspaceRoot: tmpDir,
    getPanel: () => undefined,
    ...overrides,
  };
}

function makePanel(mmdPath: string): DiagramPanelLike {
  return {
    mmdPath,
    requestExport: async (_format) => Buffer.from("<svg/>"),
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dt-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// DT-01..DT-03  ToolResult envelope
// ─────────────────────────────────────────────────────────────────────────────

describe("ToolResult envelope", () => {
  // DT-01: ok result — listHandler (empty dir) returns { ok: true, data: [] }
  it("DT-01: ok result has ok:true and data array", async () => {
    const result = await listHandler({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.data)).toBe(true);
    }
  });

  // DT-02: err result — getHandler on missing file returns { ok: false, errorCode, message }
  it("DT-02: error result has ok:false, errorCode, and message", async () => {
    const result = await getHandler({ path: "nonexistent.mmd" }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.errorCode).toBe("string");
      expect(typeof result.message).toBe("string");
    }
  });

  // DT-03: ErrorCode covers all 6 expected values
  it("DT-03: all ErrorCode values are valid strings", () => {
    const codes: ErrorCode[] = [
      "FILE_NOT_FOUND",
      "PARSE_ERROR",
      "TRAVERSAL_DENIED",
      "ALREADY_EXISTS",
      "PANEL_NOT_OPEN",
      "PANEL_MISMATCH",
    ];
    expect(codes).toHaveLength(6);
    for (const code of codes) {
      expect(typeof code).toBe("string");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DT-04..DT-06  resolveGuarded
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveGuarded", () => {
  // DT-04: valid relative path inside root → returns absolute path
  it("DT-04: resolves relative path to absolute under workspaceRoot", () => {
    const result = resolveGuarded(tmpDir, "diagrams/arch.mmd");
    expect(result).toBe(join(tmpDir, "diagrams/arch.mmd"));
  });

  // DT-05: ../.. escape → throws DiagToolError with TRAVERSAL_DENIED
  it("DT-05: path that escapes root throws DiagToolError TRAVERSAL_DENIED", () => {
    expect(() => resolveGuarded(tmpDir, "../../etc/passwd")).toThrow(DiagToolError);
    try {
      resolveGuarded(tmpDir, "../../etc/passwd");
    } catch (e) {
      expect(e instanceof DiagToolError).toBe(true);
      expect((e as DiagToolError).errorCode).toBe("TRAVERSAL_DENIED");
    }
  });

  // DT-06: absolute path outside root → TRAVERSAL_DENIED
  it("DT-06: absolute path outside workspaceRoot throws DiagToolError TRAVERSAL_DENIED", () => {
    const outsidePath = "/etc/hosts";
    expect(() => resolveGuarded(tmpDir, outsidePath)).toThrow(DiagToolError);
    try {
      resolveGuarded(tmpDir, outsidePath);
    } catch (e) {
      expect((e as DiagToolError).errorCode).toBe("TRAVERSAL_DENIED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DT-07..DT-11  listHandler
// ─────────────────────────────────────────────────────────────────────────────

describe("listHandler", () => {
  // DT-07: empty workspace → data: []
  it("DT-07: empty workspace returns empty array", async () => {
    const result = await listHandler({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });

  // DT-08: two .mmd files → two entries returned
  it("DT-08: discovers all .mmd files in the workspace", async () => {
    await writeFile(join(tmpDir, "a.mmd"), SIMPLE_FLOWCHART);
    await writeFile(join(tmpDir, "b.mmd"), TWO_NODE_FLOWCHART);

    const result = await listHandler({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
    }
  });

  // DT-09: non-.mmd files are not included
  it("DT-09: non-.mmd files are excluded from results", async () => {
    await writeFile(join(tmpDir, "readme.md"), "# Readme");
    await writeFile(join(tmpDir, "notes.txt"), "notes");
    await writeFile(join(tmpDir, "diagram.mmd"), SIMPLE_FLOWCHART);

    const result = await listHandler({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
    }
  });

  // DT-10: each entry contains path, type, nodeCount
  it("DT-10: every entry has path, type, and nodeCount fields", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await listHandler({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry: DiagramListEntry = result.data[0]!;
      expect(typeof entry.path).toBe("string");
      expect(entry.type === null || typeof entry.type === "string").toBe(true);
      expect(typeof entry.nodeCount).toBe("number");
      expect(entry.nodeCount).toBeGreaterThan(0);
    }
  });

  // DT-11: .mmd files in subdirectories are found
  it("DT-11: discovers .mmd files recursively in subdirectories", async () => {
    const sub = join(tmpDir, "services");
    await mkdir(sub);
    await writeFile(join(sub, "service.mmd"), TWO_NODE_FLOWCHART);

    const result = await listHandler({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      // Path should be relative to workspaceRoot
      expect(result.data[0]!.path).not.toContain(tmpDir);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DT-12..DT-17  getHandler
// ─────────────────────────────────────────────────────────────────────────────

describe("getHandler", () => {
  // DT-12: path does not exist → FILE_NOT_FOUND
  it("DT-12: non-existent file returns FILE_NOT_FOUND error", async () => {
    const result = await getHandler({ path: "ghost.mmd" }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("FILE_NOT_FOUND");
    }
  });

  // DT-13: traversal path → TRAVERSAL_DENIED
  it("DT-13: traversal path returns TRAVERSAL_DENIED error", async () => {
    const result = await getHandler({ path: "../../etc/passwd" }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("TRAVERSAL_DENIED");
    }
  });

  // DT-14: valid mermaid → returns type, nodes, edges
  it("DT-14: valid flowchart returns type, non-empty nodes and edges", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await getHandler({ path: "arch.mmd" }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const d: DiagramGetResult = result.data;
      expect(d.type).toBe("flowchart");
      // nodes is ParsedNode[]
      expect(d.nodes.length).toBeGreaterThan(0);
      const node = d.nodes[0] as ParsedNode;
      expect(typeof node.id).toBe("string");
      expect(typeof node.label).toBe("string");
      // edges is ParsedEdge[]
      expect(d.edges.length).toBeGreaterThan(0);
      const edge = d.edges[0] as ParsedEdge;
      expect(typeof edge.from).toBe("string");
      expect(typeof edge.to).toBe("string");
    }
  });

  // DT-15: invalid mermaid content → PARSE_ERROR
  it("DT-15: invalid mermaid source returns PARSE_ERROR", async () => {
    await writeFile(join(tmpDir, "bad.mmd"), INVALID_MERMAID);

    const result = await getHandler({ path: "bad.mmd" }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("PARSE_ERROR");
    }
  });

  // DT-16: .mmd without .layout.json → layout: null
  it("DT-16: missing layout file returns layout: null", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await getHandler({ path: "arch.mmd" }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.layout).toBeNull();
    }
  });

  // DT-17: .mmd with valid .layout.json → layout returned
  it("DT-17: present layout file is included in result", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    const layoutData = {
      version: "1.0",
      diagram_type: "flowchart",
      nodes: {},
      edges: {},
      clusters: {},
      unplaced: [],
      aesthetics: {},
    };
    const lp17 = layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir);
    await mkdir(dirname(lp17), { recursive: true });
    await writeFile(lp17, JSON.stringify(layoutData));

    const result = await getHandler({ path: "arch.mmd" }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.layout).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DT-18..DT-24  createHandler
// ─────────────────────────────────────────────────────────────────────────────

describe("createHandler", () => {
  // DT-18: file already exists, no force → ALREADY_EXISTS
  it("DT-18: existing file without force flag returns ALREADY_EXISTS", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await createHandler(
      { path: "arch.mmd", content: TWO_NODE_FLOWCHART },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("ALREADY_EXISTS");
    }
  });

  // DT-19: file exists with force: true → overwrites
  it("DT-19: force:true overwrites existing file", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await createHandler(
      { path: "arch.mmd", content: TWO_NODE_FLOWCHART, force: true },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    const written = await readFile(join(tmpDir, "arch.mmd"), "utf-8");
    expect(written).toBe(TWO_NODE_FLOWCHART);
  });

  // DT-20: invalid mermaid → PARSE_ERROR, no file written
  it("DT-20: invalid mermaid returns PARSE_ERROR and does not create files", async () => {
    const result = await createHandler(
      { path: "bad.mmd", content: INVALID_MERMAID },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("PARSE_ERROR");
    }
    // Neither .mmd nor .layout.json should appear on disk
    const checkFile = async (p: string) => {
      try {
        await readFile(p);
        return true;
      } catch {
        return false;
      }
    };
    expect(await checkFile(join(tmpDir, "bad.mmd"))).toBe(false);
  });

  // DT-21: traversal path → TRAVERSAL_DENIED, no file written
  it("DT-21: traversal path returns TRAVERSAL_DENIED and writes nothing", async () => {
    const result = await createHandler(
      { path: "../../etc/evil.mmd", content: SIMPLE_FLOWCHART },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("TRAVERSAL_DENIED");
    }
  });

  // DT-22: valid create → .mmd file written to disk
  it("DT-22: successful create writes .mmd file to disk with exact content", async () => {
    const result = await createHandler(
      { path: "new.mmd", content: SIMPLE_FLOWCHART },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const d: DiagramCreateResult = result.data;
      expect(d.created).toBe(true);
      expect(typeof d.type).toBe("string");
      expect(typeof d.layoutPath).toBe("string");
      expect(d.layoutPath.endsWith(".layout.json")).toBe(true);
    }
    const written = await readFile(join(tmpDir, "new.mmd"), "utf-8");
    expect(written).toBe(SIMPLE_FLOWCHART);
  });

  // DT-23: valid create → .layout.json written alongside
  it("DT-23: successful create also writes .layout.json file", async () => {
    await createHandler({ path: "new.mmd", content: SIMPLE_FLOWCHART }, makeCtx());
    const layoutExists = await readFile(layoutPathFor(join(tmpDir, "new.mmd"), tmpDir), "utf-8").then(
      () => true,
      () => false,
    );
    expect(layoutExists).toBe(true);
  });

  // DT-24: nodeCount in result matches parsed diagram
  it("DT-24: returned nodeCount matches number of nodes in the diagram", async () => {
    // SIMPLE_FLOWCHART has 2 nodes: A, B
    const result = await createHandler(
      { path: "count.mmd", content: SIMPLE_FLOWCHART },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const d: DiagramCreateResult = result.data;
      expect(d.nodeCount).toBe(2);
      expect(d.type).toBe("flowchart");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DT-25..DT-33  patchHandler
// ─────────────────────────────────────────────────────────────────────────────

describe("patchHandler", () => {
  // DT-25: file does not exist → FILE_NOT_FOUND
  it("DT-25: non-existent file returns FILE_NOT_FOUND", async () => {
    const result = await patchHandler(
      { path: "ghost.mmd", content: SIMPLE_FLOWCHART },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("FILE_NOT_FOUND");
    }
  });

  // DT-26: traversal path → TRAVERSAL_DENIED
  it("DT-26: traversal path returns TRAVERSAL_DENIED", async () => {
    const result = await patchHandler(
      { path: "../../escape.mmd", content: SIMPLE_FLOWCHART },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("TRAVERSAL_DENIED");
    }
  });

  // DT-27: invalid new content → PARSE_ERROR, original file unchanged
  it("DT-27: invalid content returns PARSE_ERROR and leaves original file unchanged", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await patchHandler(
      { path: "arch.mmd", content: INVALID_MERMAID },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("PARSE_ERROR");

    const onDisk = await readFile(join(tmpDir, "arch.mmd"), "utf-8");
    expect(onDisk).toBe(SIMPLE_FLOWCHART); // original untouched
  });

  // DT-28: valid patch → .mmd updated on disk
  it("DT-28: successful patch writes new content to .mmd file", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await patchHandler(
      { path: "arch.mmd", content: TWO_NODE_FLOWCHART },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    const onDisk = await readFile(join(tmpDir, "arch.mmd"), "utf-8");
    expect(onDisk).toBe(TWO_NODE_FLOWCHART);
  });

  // DT-29: valid patch → .layout.json updated
  it("DT-29: successful patch updates the .layout.json alongside the .mmd", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    await patchHandler({ path: "arch.mmd", content: TWO_NODE_FLOWCHART }, makeCtx());

    const layoutRaw = await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8");
    const layout = JSON.parse(layoutRaw);
    expect(layout.version).toBe("1.0");
    expect(layout.diagram_type).toBe("flowchart");
  });

  // DT-30: changes summary reflects node delta
  it("DT-30: changes summary reflects nodes added and removed", async () => {
    // Start: A-->B  (2 nodes), Patch to: X-->Y (2 different nodes)
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await patchHandler(
      { path: "arch.mmd", content: TWO_NODE_FLOWCHART },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const d: DiagramPatchResult = result.data;
      // changes.nodesRemoved is readonly NodeId[]
      expect(Array.isArray(d.changes.nodesRemoved)).toBe(true);
      expect(d.changes.nodesRemoved).toHaveLength(2); // A, B removed
      // changes.nodesAdded is readonly NodeId[]
      expect(Array.isArray(d.changes.nodesAdded)).toBe(true);
      expect(d.changes.nodesAdded).toHaveLength(2); // X, Y added
    }
  });

  // DT-31: missing .layout.json → fallback seeds from computeInitialLayout(oldParsed)
  it("DT-31: missing layout.json triggers fallback and patch still succeeds", async () => {
    // Write only the .mmd, no .layout.json
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await patchHandler(
      { path: "arch.mmd", content: TWO_NODE_FLOWCHART },
      makeCtx(),
    );
    expect(result.ok).toBe(true);

    // A layout.json should now exist after the patch
    const layoutExists = await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir)).then(
      () => true,
      () => false,
    );
    expect(layoutExists).toBe(true);
  });

  // DT-32: corrupt .layout.json → same fallback as missing
  it("DT-32: corrupt layout.json triggers the same fallback as missing", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    const lp32 = layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir);
    await mkdir(dirname(lp32), { recursive: true });
    await writeFile(lp32, "{ this is not valid json");

    const result = await patchHandler(
      { path: "arch.mmd", content: TWO_NODE_FLOWCHART },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Layout file should have been rewritten with valid JSON
      const raw = await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8");
      const layout = JSON.parse(raw);
      expect(layout.version).toBe("1.0");
    }
  });

  // DT-33: nodeStyles → written to layout.json for existing nodes
  it("DT-33: nodeStyles param persists style overrides into .layout.json", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        nodeStyles: { A: { backgroundColor: "#ff0000", fontColor: "#ffffff" } },
      },
      makeCtx(),
    );
    expect(result.ok).toBe(true);

    const layoutRaw = await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8");
    const layout = JSON.parse(layoutRaw);
    expect(layout.nodes.A.style.backgroundColor).toBe("#ff0000");
    expect(layout.nodes.A.style.fontColor).toBe("#ffffff");
  });

  // DT-34: nodeStyles for a node not in the diagram → silently ignored
  it("DT-34: nodeStyles for an absent node ID is silently ignored", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        nodeStyles: { GHOST: { backgroundColor: "#00ff00" } },
      },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    // No error, layout file exists and is valid JSON
    const layoutRaw = await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8");
    const layout = JSON.parse(layoutRaw);
    expect(layout.nodes.GHOST).toBeUndefined();
  });

  // DT-35: @rename annotation → mermaidCleaned returned
  it("DT-35: mermaidCleaned is returned when @rename annotations are processed", async () => {
    // Source with a @rename annotation using the correct %% comment syntax (no leading spaces)
    const withRename =
      "flowchart TD\n%% @rename: A -> Alpha\nA-->B\n";
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await patchHandler(
      { path: "arch.mmd", content: withRename },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.data.mermaidCleaned).toBe("string");
      expect(result.data.mermaidCleaned).not.toContain("%% @rename");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DT-36..DT-41  renderHandler
// ─────────────────────────────────────────────────────────────────────────────

describe("renderHandler", () => {
  // DT-36: no panel open → PANEL_NOT_OPEN
  it("DT-36: no open panel returns PANEL_NOT_OPEN", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await renderHandler(
      { path: "arch.mmd", format: "svg" },
      makeCtx({ getPanel: () => undefined }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("PANEL_NOT_OPEN");
    }
  });

  // DT-37: panel open for a different file → PANEL_MISMATCH (message names both paths)
  it("DT-37: panel for different file returns PANEL_MISMATCH with both paths in message", async () => {
    await writeFile(join(tmpDir, "a.mmd"), SIMPLE_FLOWCHART);
    await writeFile(join(tmpDir, "b.mmd"), TWO_NODE_FLOWCHART);

    const panelForB = makePanel(join(tmpDir, "b.mmd"));
    const result = await renderHandler(
      { path: "a.mmd", format: "svg" },
      makeCtx({ getPanel: () => panelForB }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("PANEL_MISMATCH");
      // Message must name the requested path AND the panel's path
      expect(result.message).toContain("a.mmd");
      expect(result.message).toContain("b.mmd");
    }
  });

  // DT-38: path traversal → TRAVERSAL_DENIED
  it("DT-38: traversal in path returns TRAVERSAL_DENIED before panel is checked", async () => {
    const result = await renderHandler(
      { path: "../../etc/passwd", format: "svg" },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("TRAVERSAL_DENIED");
    }
  });

  // DT-39: output_path traversal → TRAVERSAL_DENIED
  it("DT-39: traversal in output_path returns TRAVERSAL_DENIED", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    const panel = makePanel(join(tmpDir, "arch.mmd"));

    const result = await renderHandler(
      { path: "arch.mmd", format: "svg", output_path: "../../evil.svg" },
      makeCtx({ getPanel: () => panel }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("TRAVERSAL_DENIED");
    }
  });

  // DT-40: success → buffer written to disk, bytes returned
  it("DT-40: successful render writes buffer to output_path and returns byte count", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    const panel = makePanel(join(tmpDir, "arch.mmd"));
    const outPath = "arch.svg";

    const result = await renderHandler(
      { path: "arch.mmd", format: "svg", output_path: outPath },
      makeCtx({ getPanel: () => panel }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const d: DiagramRenderResult = result.data;
      expect(d.rendered).toBe(true);
      expect(d.bytes).toBeGreaterThan(0);

      const written = await readFile(join(tmpDir, outPath));
      expect(written.toString()).toBe("<svg/>");
    }
  });

  // DT-41: default output_path = same dir, stem.format
  it("DT-41: omitted output_path defaults to same-directory stem with format extension", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    const panel = makePanel(join(tmpDir, "arch.mmd"));

    const result = await renderHandler(
      { path: "arch.mmd", format: "svg" },
      makeCtx({ getPanel: () => panel }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const d: DiagramRenderResult = result.data;
      expect(d.output_path.endsWith(".svg")).toBe(true);
      expect(basename(d.output_path)).toBe("arch.svg");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DT-42..DT-44  styleGuideHandler
// ─────────────────────────────────────────────────────────────────────────────

describe("styleGuideHandler", () => {
  // DT-42: returns ok: true
  it("DT-42: returns ok:true", () => {
    const result = styleGuideHandler({});
    expect(result.ok).toBe(true);
  });

  // DT-43: returns message and skills array
  it("DT-43: returns message and skills array pointing to the skill file", () => {
    const result = styleGuideHandler({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const d: DiagramStyleGuideResult = result.data;
      expect(typeof d.message).toBe("string");
      expect(d.message).toContain("skills/diagrams/skill.md");
      expect(Array.isArray(d.skills)).toBe(true);
      expect(d.skills.length).toBeGreaterThan(0);
      expect(d.skills[0]).toHaveProperty("id");
      expect(d.skills[0]).toHaveProperty("path");
      expect(d.skills[0]).toHaveProperty("description");
    }
  });

  // DT-44: skills array includes accordo-diagrams skill
  it("DT-44: skills includes accordo-diagrams with diagram guidance", () => {
    const result = styleGuideHandler({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { skills } = result.data;
      const diagramSkill = skills.find((s) => s.id === "accordo-diagrams");
      expect(diagramSkill).toBeDefined();
      expect(diagramSkill!.path).toBe("skills/diagrams/skill.md");
      expect(diagramSkill!.description).toContain("nodeStyles");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DT-47..DT-48  createDiagramTools
// ─────────────────────────────────────────────────────────────────────────────

describe("createDiagramTools", () => {
  const ctx = makeCtx();
  let tools: ReturnType<typeof createDiagramTools>;

  beforeEach(() => {
    tools = createDiagramTools(ctx);
  });

  // DT-47: returns exactly 6 tools
  it("DT-47: returns an array with exactly 6 tool definitions", () => {
    expect(tools).toHaveLength(6);
  });

  // DT-48: each tool has required fields + callable handler
  it("DT-48: every tool definition has name, description, inputSchema, and a callable handler", () => {
    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.startsWith("accordo_diagram_")).toBe(true);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.handler).toBe("function");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DT-49..DT-52  patchHandler nodeStyles — A14-v2 (width/height + new style fields)
//
// Backfill — implementation already exists; tests were written after the fact
// per reviewer-approved exception.
// ─────────────────────────────────────────────────────────────────────────────

describe("patchHandler nodeStyles — A14-v2 width/height and new style fields", () => {
  // DT-49: nodeStyles.width → written to layout.json as nodes.A.w, NOT in nodes.A.style
  it("DT-49: nodeStyles width → stored as layout.nodes.A.w, not in .style", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        nodeStyles: { A: { width: 300 } },
      },
      makeCtx(),
    );
    expect(result.ok).toBe(true);

    const layout = JSON.parse(await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"));
    expect(layout.nodes.A.w).toBe(300);
    // Must NOT appear inside the style sub-object
    expect(layout.nodes.A.style?.width).toBeUndefined();
  });

  // DT-50: nodeStyles.height → written to layout.json as nodes.A.h, NOT in nodes.A.style
  it("DT-50: nodeStyles height → stored as layout.nodes.A.h, not in .style", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        nodeStyles: { A: { height: 120 } },
      },
      makeCtx(),
    );
    expect(result.ok).toBe(true);

    const layout = JSON.parse(await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"));
    expect(layout.nodes.A.h).toBe(120);
    expect(layout.nodes.A.style?.height).toBeUndefined();
  });

  // DT-51: nodeStyles.fillStyle → written to nodes.A.style.fillStyle
  it("DT-51: nodeStyles fillStyle → stored in layout.nodes.A.style.fillStyle", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        nodeStyles: { A: { fillStyle: "cross-hatch" } },
      },
      makeCtx(),
    );
    expect(result.ok).toBe(true);

    const layout = JSON.parse(await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"));
    expect(layout.nodes.A.style.fillStyle).toBe("cross-hatch");
  });

  // DT-52: nodeStyles with strokeStyle + roughness + fontFamily → all written to nodes.A.style
  it("DT-52: nodeStyles strokeStyle/roughness/fontFamily → all persisted in layout.nodes.A.style", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const result = await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        nodeStyles: { A: { strokeStyle: "dotted", roughness: 0, fontFamily: "Nunito" } },
      },
      makeCtx(),
    );
    expect(result.ok).toBe(true);

    const layout = JSON.parse(await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"));
    expect(layout.nodes.A.style.strokeStyle).toBe("dotted");
    expect(layout.nodes.A.style.roughness).toBe(0);
    expect(layout.nodes.A.style.fontFamily).toBe("Nunito");
    // width/height must not bleed into style
    expect(layout.nodes.A.style?.width).toBeUndefined();
    expect(layout.nodes.A.style?.height).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DT-53..DT-58  patchHandler — placeNodes() placement fix
//
// These tests verify that when patchHandler adds new nodes via `content`,
// placeNodes() assigns them x/y/w/h and clears layout.unplaced.
//
// Each test is written so that if the placeNodes() block were removed from
// patchHandler (the "placement fix"), the test would fail.
// ─────────────────────────────────────────────────────────────────────────────

describe("patchHandler placeNodes() placement fix — DT-53..DT-58", () => {
  // DT-53: New node added via `content` appears in layout.nodes with finite x/y/w/h
  it("DT-53: new node added via content is written to layout.nodes with x/y/w/h", async () => {
    // Start with A-->B; patch to add node C
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const patchedContent = "flowchart TD\nA-->B\nB-->C\n";
    await patchHandler({ path: "arch.mmd", content: patchedContent }, makeCtx());

    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );

    // Node C must exist in layout.nodes (not stuck in unplaced[])
    expect(layout.nodes.C).toBeDefined();
    // All four position/size fields must be finite numbers
    expect(Number.isFinite(layout.nodes.C.x)).toBe(true);
    expect(Number.isFinite(layout.nodes.C.y)).toBe(true);
    expect(Number.isFinite(layout.nodes.C.w)).toBe(true);
    expect(Number.isFinite(layout.nodes.C.h)).toBe(true);
  });

  // DT-54: layout.unplaced[] is empty after adding new nodes
  it("DT-54: unplaced[] is [] after patch adds new nodes", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    const patchedContent = "flowchart TD\nA-->B\nB-->C\n";
    await patchHandler({ path: "arch.mmd", content: patchedContent }, makeCtx());

    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    expect(layout.unplaced).toEqual([]);
  });

  // DT-55: Newly placed node does not overlap an existing positioned node
  it("DT-55: newly placed node does not overlap an existing positioned node", async () => {
    // Write layout.json directly so that node A has a known fixed position
    const mmdPath = join(tmpDir, "arch.mmd");
    const lpPath  = layoutPathFor(mmdPath, tmpDir);
    await writeFile(mmdPath, SIMPLE_FLOWCHART);
    await mkdir(dirname(lpPath), { recursive: true });
    await writeFile(
      lpPath,
      JSON.stringify({
        version: "1.0",
        diagram_type: "flowchart",
        nodes: {
          A: { id: "A", x: 100, y: 0, w: 100, h: 60, style: {} },
          B: { id: "B", x: 300, y: 0, w: 100, h: 60, style: {} },
        },
        edges: {},
        clusters: {},
        unplaced: [],
        aesthetics: { roughness: 1, animationMode: "draw-on" },
      }),
    );

    // Patch adds node C connected to A; placeNodes() must position C without overlapping A
    const patchedContent = "flowchart TD\nA-->B\nA-->C\n";
    await patchHandler({ path: "arch.mmd", content: patchedContent }, makeCtx());

    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    const A = layout.nodes.A;
    const C = layout.nodes.C;

    // AABB overlap check (same logic as placeNodes' rectsOverlap)
    const overlaps = !(
      A.x + A.w <= C.x ||
      C.x + C.w <= A.x ||
      A.y + A.h <= C.y ||
      C.y + C.h <= A.y
    );
    expect(overlaps).toBe(false);
  });

  // DT-56: Two new nodes added in the same patch do not overlap each other
  it("DT-56: two new nodes added in the same patch do not overlap each other", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    // Add two new nodes C and D in the same rank (both children of B)
    const patchedContent = "flowchart TD\nA-->B\nB-->C\nB-->D\n";
    await patchHandler({ path: "arch.mmd", content: patchedContent }, makeCtx());

    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    const C = layout.nodes.C;
    const D = layout.nodes.D;

    const overlaps = !(
      C.x + C.w <= D.x ||
      D.x + D.w <= C.x ||
      C.y + C.h <= D.y ||
      D.y + D.h <= C.y
    );
    expect(overlaps).toBe(false);
  });

  // DT-57: Node with explicit nodeStyles x/y override is NOT moved by placeNodes()
  it("DT-57: nodeStyles x/y override prevents placeNodes() from moving the node", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    // Explicitly pin node A at (999, 999) — placeNodes() must NOT override this
    await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        nodeStyles: { A: { x: 999, y: 999 } },
      },
      makeCtx(),
    );

    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    expect(layout.nodes.A.x).toBe(999);
    expect(layout.nodes.A.y).toBe(999);
  });

  // DT-58: layout.unplaced[] is also empty when no new nodes were added (regression guard)
  it("DT-58: unplaced[] is [] even when no new nodes were added (regression guard)", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);

    // Patch with identical content — nothing new added
    await patchHandler({ path: "arch.mmd", content: SIMPLE_FLOWCHART }, makeCtx());

    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    expect(layout.unplaced).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DT-59..DT-66  patchHandler edgeStyles — T-01
//
// Tests for the edgeStyles argument added to accordo_diagram_patch.
// Edge keys use the 'source->target:index' format (e.g. 'A->B:0').
// ─────────────────────────────────────────────────────────────────────────────

describe("patchHandler edgeStyles — T-01", () => {
  // DT-59: edgeStyles strokeColor is written to layout.json edges[key].style.strokeColor
  it("DT-59: edgeStyles strokeColor → stored in edges['A->B:0'].style.strokeColor", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    // Create initial layout
    await patchHandler({ path: "arch.mmd", content: SIMPLE_FLOWCHART }, makeCtx());

    // Apply strokeColor to edge A->B:0
    await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        edgeStyles: { "A->B:0": { strokeColor: "#E74C3C" } },
      },
      makeCtx(),
    );

    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    expect(layout.edges["A->B:0"].style.strokeColor).toBe("#E74C3C");
  });

  // DT-60: edgeStyles routing is written to EdgeLayout.routing (NOT inside style)
  it("DT-60: edgeStyles routing → stored in edges['A->B:0'].routing, NOT in .style", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    await patchHandler({ path: "arch.mmd", content: SIMPLE_FLOWCHART }, makeCtx());

    await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        edgeStyles: { "A->B:0": { routing: "orthogonal" } },
      },
      makeCtx(),
    );

    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    expect(layout.edges["A->B:0"].routing).toBe("orthogonal");
    // routing must NOT appear inside .style
    expect(layout.edges["A->B:0"].style.routing).toBeUndefined();
  });

  // DT-61: unknown edgeStyles key is silently skipped (no error)
  it("DT-61: unknown edge key in edgeStyles is silently skipped", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    await patchHandler({ path: "arch.mmd", content: SIMPLE_FLOWCHART }, makeCtx());

    const result = await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        edgeStyles: { "NONEXISTENT->EDGE:0": { strokeColor: "#f00" } },
      },
      makeCtx(),
    );

    expect(result.ok).toBe(true);
  });

  // DT-62: unknown style field inside edgeStyles is silently dropped (whitelist)
  it("DT-62: unknown style field inside edgeStyles is silently dropped", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    await patchHandler({ path: "arch.mmd", content: SIMPLE_FLOWCHART }, makeCtx());

    await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        edgeStyles: { "A->B:0": { strokeColor: "#f00", unknownField: "garbage" } as Record<string, unknown> },
      },
      makeCtx(),
    );

    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    expect(layout.edges["A->B:0"].style.strokeColor).toBe("#f00");
    expect(layout.edges["A->B:0"].style.unknownField).toBeUndefined();
  });

  // DT-63: absent edgeStyles → no error, edges unchanged
  it("DT-63: absent edgeStyles param → no error, edges unchanged", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    await patchHandler({ path: "arch.mmd", content: SIMPLE_FLOWCHART }, makeCtx());

    const layoutBefore = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );

    // Patch with no edgeStyles
    await patchHandler({ path: "arch.mmd", content: SIMPLE_FLOWCHART }, makeCtx());

    const layoutAfter = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    expect(layoutAfter.edges).toEqual(layoutBefore.edges);
  });

  // DT-64: multiple style fields applied in one call
  it("DT-64: multiple style fields applied in one edgeStyles call", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    await patchHandler({ path: "arch.mmd", content: SIMPLE_FLOWCHART }, makeCtx());

    await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        edgeStyles: {
          "A->B:0": { strokeColor: "#E74C3C", strokeWidth: 3, strokeStyle: "dashed" },
        },
      },
      makeCtx(),
    );

    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    expect(layout.edges["A->B:0"].style.strokeColor).toBe("#E74C3C");
    expect(layout.edges["A->B:0"].style.strokeWidth).toBe(3);
    expect(layout.edges["A->B:0"].style.strokeStyle).toBe("dashed");
  });

  // DT-65: routing + style fields applied together in one call
  it("DT-65: routing and style fields applied together", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    await patchHandler({ path: "arch.mmd", content: SIMPLE_FLOWCHART }, makeCtx());

    await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        edgeStyles: {
          "A->B:0": { routing: "direct", strokeColor: "#27AE60" },
        },
      },
      makeCtx(),
    );

    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    expect(layout.edges["A->B:0"].routing).toBe("direct");
    expect(layout.edges["A->B:0"].style.strokeColor).toBe("#27AE60");
  });

  // DT-66: edgeStyles partial patch preserves existing style fields (deep-merge guard)
  // Proves that patching strokeColor doesn't wipe a previously set strokeWidth.
  it("DT-66: edgeStyles partial patch → existing style fields preserved", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    await patchHandler({ path: "arch.mmd", content: SIMPLE_FLOWCHART }, makeCtx());

    // Step 1: Set strokeColor on edge A->B:0
    await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        edgeStyles: { "A->B:0": { strokeColor: "#f00" } },
      },
      makeCtx(),
    );

    // Step 2: Set strokeWidth WITHOUT specifying strokeColor
    await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        edgeStyles: { "A->B:0": { strokeWidth: 2 } },
      },
      makeCtx(),
    );

    // Assert both fields are present — strokeColor was NOT wiped by the second patch
    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    expect(layout.edges["A->B:0"].style.strokeColor).toBe("#f00");
    expect(layout.edges["A->B:0"].style.strokeWidth).toBe(2);
  });

  // DT-67: edgeStyles strokeDash is written to layout.json edges[key].style.strokeDash
  it("DT-67: edgeStyles strokeDash → stored in edges['A->B:0'].style.strokeDash", async () => {
    await writeFile(join(tmpDir, "arch.mmd"), SIMPLE_FLOWCHART);
    await patchHandler({ path: "arch.mmd", content: SIMPLE_FLOWCHART }, makeCtx());

    await patchHandler(
      {
        path: "arch.mmd",
        content: SIMPLE_FLOWCHART,
        edgeStyles: { "A->B:0": { strokeDash: true } },
      },
      makeCtx(),
    );

    const layout = JSON.parse(
      await readFile(layoutPathFor(join(tmpDir, "arch.mmd"), tmpDir), "utf-8"),
    );
    expect(layout.edges["A->B:0"].style.strokeDash).toBe(true);
  });
});
