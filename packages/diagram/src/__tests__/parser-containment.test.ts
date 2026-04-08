/**
 * H0-02: Parser exception containment tests
 *
 * The containment contract (H0-02a/b/c/d):
 *   parseMermaid() catches ALL exceptions internally and returns a
 *   RESOLVED promise whose value is { valid: false, error: { message } }.
 *   The promise must NEVER reject past parseMermaid's boundary.
 *
 * Pattern for all tests:
 *   GREEN: parseMermaid catches → RESOLVES with { valid: false, error }
 *          → await parseMermaid() yields result → assertions pass.
 *   RED:   stub throws → exception propagates → await REJECTS →
 *          vitest marks test FAILED (uncaught exception during await).
 *          The catch block is never entered in RED because vitest has
 *          already failed the test before the catch runs.
 *
 * The catch blocks below are ONLY for cleanliness in GREEN state — they
 * prevent an uncaught rejection in test output if something unexpected
 * happens. They do NOT throw. In RED state vitest fails the test before
 * the catch is ever reached due to the unhandled rejection.
 *
 * For H0-02c, exact String(thrown) mapping is asserted:
 *   string throw → error.message === the exact string
 *   number  42   → error.message === "42"
 *   null         → error.message === "null"
 *   undefined    → error.message === "undefined"
 *
 * Requirements: requirements-diagram-hardening.md §H0-02
 * Requirement IDs: H0-02a, H0-02b, H0-02c, H0-02d
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mermaid mock ────────────────────────────────────────────────────────────────

interface MockDb {
  getVertices?: () => Record<string, unknown>;
  getEdges?: () => unknown[];
  getSubGraphs?: () => unknown[];
  getDirection?: () => string;
}

let _mockDb: MockDb = {};

const mermaidMock = {
  default: {
    initialize: vi.fn(),
    mermaidAPI: {
      getDiagramFromText: vi.fn((_source: string) => ({
        db: _mockDb,
      })),
      initialize: vi.fn(),
    },
  },
};

vi.mock("mermaid", () => mermaidMock);

function setMockDb(db: MockDb): void {
  _mockDb = db;
}

const { parseMermaid } = await import("../parser/adapter.js");

// ── H0-02a: Per-type parser dispatch wrapped in try/catch ────────────────────

describe("H0-02a: per-type parser dispatch wrapped in try/catch", () => {
  beforeEach(() => {
    setMockDb({
      getVertices: () => ({}),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockReset();
  });

  it("H0-02a: parseFlowchart throwing is contained → resolves { valid: false }", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(
      () => ({ db: {} })
    );
    const flowParser = await import("../parser/flowchart.js");
    vi.spyOn(flowParser, "parseFlowchart").mockImplementationOnce(() => {
      throw new Error("parseFlowchart CRASHED");
    });

    // GREEN: catch block inside parseMermaid → RESOLVES { valid: false }
    // RED:   await throws (unhandled rejection) → vitest FAILED
    const result = await parseMermaid("flowchart TD\n  A-->B");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("H0-02a: parseStateDiagram throwing is contained → resolves { valid: false }", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(
      () => ({ db: {} })
    );
    const stateParser = await import("../parser/state-diagram.js");
    vi.spyOn(stateParser, "parseStateDiagram").mockImplementationOnce(() => {
      throw new Error("parseStateDiagram CRASHED");
    });

    const result = await parseMermaid("stateDiagram-v2\n  [*]-->A");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("H0-02a: parseClassDiagram throwing is contained → resolves { valid: false }", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(
      () => ({ db: {} })
    );
    const classParser = await import("../parser/class-diagram.js");
    vi.spyOn(classParser, "parseClassDiagram").mockImplementationOnce(() => {
      throw new Error("parseClassDiagram CRASHED");
    });

    const result = await parseMermaid("classDiagram\n  class Foo");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ── H0-02b: Mermaid error catch uses type guard ──────────────────────────────

describe("H0-02b: mermaid error catch uses instanceof Error (not unsafe cast)", () => {
  it("H0-02b: getDiagramFromText throwing Error object is contained → resolves { valid: false }", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(() => {
      throw new Error("mermaid syntax error at line 3");
    });

    // GREEN: catch block inside parseMermaid → RESOLVES { valid: false }
    // RED:   await throws → vitest FAILED
    const result = await parseMermaid("flowchart TD\n  A--[broken");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ── H0-02c: Non-Error throws handled with String(thrown) message mapping ─────
//
// Each non-Error throw type is tested TWICE:
//   1. Containment: promise RESOLVES { valid: false } — verifies the throw
//      is caught and does not propagate.
//   2. Exact message: error.message === String(thrown) — verifies the
//      specific message value for each throw type.
//      string throw → message is the exact same string
//      number  42    → message is "42"
//      null         → message is "null"
//      undefined    → message is "undefined"

describe("H0-02c: non-Error throws return { valid: false } with meaningful String(thrown) message", () => {
  // String throw

  it("H0-02c: plain string throw is contained → resolves { valid: false }", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(() => {
      throw "plain string error";
    });

    const result = await parseMermaid("flowchart TD\n  A-->B");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("H0-02c: string throw → error.message is the exact thrown string", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(() => {
      throw "exact-string-thrown";
    });

    const result = await parseMermaid("flowchart TD\n  A-->B");
    expect(result.valid).toBe(false);
    expect(result.error.message).toBe("exact-string-thrown");
  });

  // Number throw

  it("H0-02c: number throw is contained → resolves { valid: false }", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(() => {
      throw 42;
    });

    const result = await parseMermaid("flowchart TD\n  A-->B");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("H0-02c: number throw → error.message is String(42) ('42')", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(() => {
      throw 42;
    });

    const result = await parseMermaid("flowchart TD\n  A-->B");
    expect(result.valid).toBe(false);
    expect(result.error.message).toBe("42");
  });

  // Null throw

  it("H0-02c: null throw is contained → resolves { valid: false }", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(() => {
      throw null;
    });

    const result = await parseMermaid("flowchart TD\n  A-->B");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("H0-02c: null throw → error.message is String(null) ('null')", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(() => {
      throw null;
    });

    const result = await parseMermaid("flowchart TD\n  A-->B");
    expect(result.valid).toBe(false);
    expect(result.error.message).toBe("null");
  });

  // Undefined throw

  it("H0-02c: undefined throw is contained → resolves { valid: false }", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(() => {
      throw undefined;
    });

    const result = await parseMermaid("flowchart TD\n  A-->B");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("H0-02c: undefined throw → error.message is String(undefined) ('undefined')", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(() => {
      throw undefined;
    });

    const result = await parseMermaid("flowchart TD\n  A-->B");
    expect(result.valid).toBe(false);
    expect(result.error.message).toBe("undefined");
  });
});

// ── H0-02d: Containment summary ────────────────────────────────────────────────
// Verifies all throw types (Error, string, number, null, undefined) resolve
// to { valid: false } — i.e., containment works for all cases.

describe("H0-02d: parser containment summary — all throw types resolve { valid: false }", () => {
  it("H0-02d: Error, string, number, null, undefined throws all return { valid: false }", async () => {
    const throwScenarios: Array<{ label: string; throwValue: unknown }> = [
      { label: "Error throw",    throwValue: new Error("test") },
      { label: "string throw",   throwValue: "string error" },
      { label: "number throw",   throwValue: 42 },
      { label: "null throw",      throwValue: null },
      { label: "undefined throw", throwValue: undefined },
    ];

    for (const { label, throwValue } of throwScenarios) {
      mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(
        () => { throw throwValue; }
      );
      const result = await parseMermaid("flowchart TD\n  A-->B");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    }
  });
});
