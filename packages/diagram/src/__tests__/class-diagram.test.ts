/**
 * B — classDiagram parser tests
 *
 * Tests verify the public contract of parseMermaid() when applied to classDiagram
 * source. The class-diagram.ts parser does not exist yet — all tests are RED.
 *
 * mermaid is mocked so tests run in Node without a DOM.
 * The mock returns a controlled `parser.yy` db object per test.
 *
 * Requirements: REQ-CD-01 through REQ-CD-07
 *
 * API checklist:
 *   parseMermaid (classDiagram) — returns valid result with type "classDiagram"  [REQ-CD-01]
 *   parseMermaid (classDiagram) — class nodes with IDs and labels              [REQ-CD-02]
 *   parseMermaid (classDiagram) — attributes and methods per class            [REQ-CD-03]
 *   parseMermaid (classDiagram) — relationship types extracted                [REQ-CD-04]
 *   parseMermaid (classDiagram) — notes extracted                             [REQ-CD-05]
 *   parseMermaid (classDiagram) — direction extracted                         [REQ-CD-06]
 *   parseMermaid (classDiagram) — error returns valid:false with message       [REQ-CD-07]
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mermaid mock ──────────────────────────────────────────────────────────────
//
// We replace the mermaid module with a minimal fake that:
//  1. Exposes mermaidAPI.getDiagramFromText() returning a fake diagram object
//  2. Lets each test inject a custom db via __setMockDb()
//
// The mock lives in this file so the db factory can be controlled per-test
// with vi.mocked().
//
// Real mermaid 11.x classDiagram db API (ClassDB class):
//   db.classes     — Map<string, ClassNode>
//   db.relations  — ClassRelation[]
//   db.notes      — Map<string, ClassNote>
//   db.direction  — string
//
// ClassRelation shape: { id1, id2, relationTitle1, relationTitle2, type,
//                        title, text, style, relation: { type1, type2, lineType } }
//   relationType values: 0=AGGREGATION, 1=EXTENSION, 2=COMPOSITION, 3=DEPENDENCY, 4=LOLLIPOP
//   lineType values: 0=LINE (solid), 1=DOTTED_LINE (dashed)
//
// ClassNode shape: { id, type, label, text, shape:"classBox", cssClasses,
//                    members:[], methods:[], annotations:[], domId, ... }
//   cssClasses is a string (space-separated); annotations is a string[]
//
// ClassNote shape: { id, class, text, index }

interface MockClassMember {
  id: string;
  memberType: "method" | "attribute";
  visibility: string;
  text: string;
  cssStyle: string;
  classifier: string;
  parameters: string;
  returnType: string;
}

interface MockClassNode {
  id: string;
  type: string;
  label: string;
  text: string;
  shape: string;
  cssClasses: string;
  members: MockClassMember[];
  methods: MockClassMember[];
  annotations: string[];
  domId: string;
}

// Mermaid classDiagram relation types (ClassDB.relationType enum)
export const RELATION_TYPE = {
  AGGREGATION: 0,
  EXTENSION: 1,
  COMPOSITION: 2,
  DEPENDENCY: 3,
  LOLLIPOP: 4,
} as const;

// Mermaid classDiagram line types (ClassDB.lineType enum)
export const LINE_TYPE = {
  LINE: 0,
  DOTTED_LINE: 1,
} as const;

interface MockRelation {
  id1: string;
  id2: string;
  relationTitle1: string;
  relationTitle2: string;
  type: string;
  title: string;
  text: string;
  style: string[];
  relation: {
    type1: (typeof RELATION_TYPE)[keyof typeof RELATION_TYPE];
    type2: (typeof RELATION_TYPE)[keyof typeof RELATION_TYPE];
    lineType: (typeof LINE_TYPE)[keyof typeof LINE_TYPE];
  };
}

interface MockNote {
  id: string;
  class: string;
  text: string;
  index: number;
}

interface MockDb {
  classes: Map<string, MockClassNode>;
  relations: MockRelation[];
  notes: Map<string, MockNote>;
  direction: string;
}

let _mockDb: MockDb = {
  classes: new Map(),
  relations: [],
  notes: new Map(),
  direction: "TD",
};

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

// ── Helpers to build mock db objects ─────────────────────────────────────────

function makeClassNode(
  id: string,
  displayName: string,
  annotations?: string[]
): MockClassNode {
  return {
    id,
    type: "",
    label: displayName,
    text: displayName,
    shape: "classBox",
    cssClasses: "",
    members: [],
    methods: [],
    annotations: annotations ?? [],
    domId: id,
  };
}

// ── Import the module under test (after vi.mock declaration) ──────────────────

const { parseMermaid } = await import("../parser/adapter.js");

// ── 1. Type detection and valid result ───────────────────────────────────────

describe("parseMermaid — classDiagram type detection [REQ-CD-01]", () => {
  beforeEach(() => {
    setMockDb({
      classes: new Map([["Foo", makeClassNode("Foo", "Foo")]]),
      relations: [],
      notes: new Map(),
      direction: "TD",
    });
  });

  it("returns valid:true with diagram.type === 'classDiagram'", async () => {
    const result = await parseMermaid("classDiagram\n  class Foo");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.type).toBe("classDiagram");
  });

  it("result contains a diagram object when parsing succeeds", async () => {
    const result = await parseMermaid("classDiagram\n  class Foo");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram).toBeDefined();
    expect(typeof result.diagram).toBe("object");
  });
});

// ── 2. Class node extraction ───────────────────────────────────────────────────

describe("parseMermaid — classDiagram class nodes [REQ-CD-02]", () => {
  beforeEach(() => {
    setMockDb({
      classes: new Map([
        ["Animal", makeClassNode("Animal", "Animal")],
        ["Dog", makeClassNode("Dog", "Dog")],
        ["Cat", makeClassNode("Cat", "Cat")],
      ]),
      relations: [],
      notes: new Map(),
      direction: "TD",
    });
  });

  it("extracts all class IDs as node keys", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect([...result.diagram.nodes.keys()]).toEqual(
      expect.arrayContaining(["Animal", "Dog", "Cat"])
    );
  });

  it("extracts all three classes when db has three classes", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.size).toBe(3);
  });

  it("class label is the displayName", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("Animal")?.label).toBe("Animal");
  });

  it("node shape defaults to rectangle for classes", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("Animal")?.shape).toBe("rectangle");
  });
});

// ── 3. Attributes and methods ──────────────────────────────────────────────────

describe("parseMermaid — classDiagram attributes and methods [REQ-CD-03]", () => {
  it("extracts class annotations as node classes", async () => {
    setMockDb({
      classes: new Map([["Foo", makeClassNode("Foo", "Foo", ["service", "critical"])]]),
      relations: [],
      notes: new Map(),
      direction: "TD",
    });
    const result = await parseMermaid("classDiagram\n  class Foo");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("Foo")?.classes).toEqual(
      expect.arrayContaining(["service", "critical"])
    );
  });

  it("a class with no annotations has empty classes array", async () => {
    setMockDb({
      classes: new Map([["Bar", makeClassNode("Bar", "Bar")]]),
      relations: [],
      notes: new Map(),
      direction: "TD",
    });
    const result = await parseMermaid("classDiagram\n  class Bar");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("Bar")?.classes).toHaveLength(0);
  });
});

// ── 4. Relationship types ─────────────────────────────────────────────────────

describe("parseMermaid — classDiagram relationships [REQ-CD-04]", () => {
  beforeEach(() => {
    setMockDb({
      classes: new Map([
        ["Animal", makeClassNode("Animal", "Animal")],
        ["Dog", makeClassNode("Dog", "Dog")],
        ["Collar", makeClassNode("Collar", "Collar")],
        ["Shop", makeClassNode("Shop", "Shop")],
        ["Customer", makeClassNode("Customer", "Customer")],
        ["Order", makeClassNode("Order", "Order")],
        ["Product", makeClassNode("Product", "Product")],
      ]),
      relations: [
        // id1/id2 = source/target; relation.type1 maps to edge type:
        //   0=AGGREGATION, 1=EXTENSION, 2=COMPOSITION, 3=DEPENDENCY
        { id1: "Dog", id2: "Animal", relationTitle1: "", relationTitle2: "", type: "", title: "extends", text: "", style: [], relation: { type1: RELATION_TYPE.EXTENSION, type2: RELATION_TYPE.EXTENSION, lineType: LINE_TYPE.LINE } },
        { id1: "Dog", id2: "Collar", relationTitle1: "", relationTitle2: "", type: "", title: "has", text: "", style: [], relation: { type1: RELATION_TYPE.COMPOSITION, type2: RELATION_TYPE.COMPOSITION, lineType: LINE_TYPE.LINE } },
        { id1: "Shop", id2: "Customer", relationTitle1: "", relationTitle2: "", type: "", title: "owns", text: "", style: [], relation: { type1: RELATION_TYPE.AGGREGATION, type2: RELATION_TYPE.AGGREGATION, lineType: LINE_TYPE.LINE } },
        { id1: "Order", id2: "Product", relationTitle1: "", relationTitle2: "", type: "", title: "uses", text: "", style: [], relation: { type1: RELATION_TYPE.DEPENDENCY, type2: RELATION_TYPE.DEPENDENCY, lineType: LINE_TYPE.LINE } },
        // Plain association (no arrow markers): use LOLLIPOP on both ends → "none" arrow
        { id1: "Customer", id2: "Order", relationTitle1: "", relationTitle2: "", type: "", title: "", text: "", style: [], relation: { type1: RELATION_TYPE.LOLLIPOP, type2: RELATION_TYPE.LOLLIPOP, lineType: LINE_TYPE.LINE } },
      ],
      notes: new Map(),
      direction: "TD",
    });
  });

  it("extracts all five relationships", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges).toHaveLength(5);
  });

  it("relationship from/to are correct", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const inheritance = result.diagram.edges.find((e) => e.type === "inheritance");
    expect(inheritance?.from).toBe("Dog");
    expect(inheritance?.to).toBe("Animal");
  });

  it("relationship label text is extracted", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const composition = result.diagram.edges.find((e) => e.type === "composition");
    expect(composition?.label).toBe("has");
  });

  it("inheritance edge type is preserved", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges.some((e) => e.type === "inheritance")).toBe(true);
  });

  it("composition edge type is preserved", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges.some((e) => e.type === "composition")).toBe(true);
  });

  it("aggregation edge type is preserved", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges.some((e) => e.type === "aggregation")).toBe(true);
  });

  it("dependency edge type is preserved", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges.some((e) => e.type === "dependency")).toBe(true);
  });

  it("plain association edge type is preserved", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges.some((e) => e.type === "association")).toBe(true);
  });

  it("edges with no label have empty string label", async () => {
    const result = await parseMermaid("classDiagram\n  class Animal");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const assoc = result.diagram.edges.find((e) => e.type === "association");
    expect(assoc?.label).toBe("");
  });

  it("multiple edges between same pair get ordinals 0, 1, 2", async () => {
    setMockDb({
      classes: new Map([
        ["A", makeClassNode("A", "A")],
        ["B", makeClassNode("B", "B")],
      ]),
      relations: [
        { id1: "A", id2: "B", relationTitle1: "", relationTitle2: "", type: "", title: "first", text: "", style: [], relation: { type1: RELATION_TYPE.EXTENSION, type2: RELATION_TYPE.EXTENSION, lineType: LINE_TYPE.LINE } },
        { id1: "A", id2: "B", relationTitle1: "", relationTitle2: "", type: "", title: "second", text: "", style: [], relation: { type1: RELATION_TYPE.EXTENSION, type2: RELATION_TYPE.EXTENSION, lineType: LINE_TYPE.LINE } },
        { id1: "A", id2: "B", relationTitle1: "", relationTitle2: "", type: "", title: "third", text: "", style: [], relation: { type1: RELATION_TYPE.EXTENSION, type2: RELATION_TYPE.EXTENSION, lineType: LINE_TYPE.LINE } },
      ],
      notes: new Map(),
      direction: "TD",
    });
    const result = await parseMermaid("classDiagram\n  class A");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const abEdges = result.diagram.edges.filter((e) => e.from === "A" && e.to === "B");
    expect(abEdges.map((e) => e.ordinal)).toEqual([0, 1, 2]);
  });
});

// ── 5. Notes ─────────────────────────────────────────────────────────────────

describe("parseMermaid — classDiagram notes [REQ-CD-05]", () => {
  it("notes are extracted from db.notes", async () => {
    setMockDb({
      classes: new Map([["Foo", makeClassNode("Foo", "Foo")]]),
      relations: [],
      notes: new Map([["n1", { id: "n1", class: "Foo", text: "This is a note", index: 0 }]]),
      direction: "TD",
    });
    const result = await parseMermaid("classDiagram\n  class Foo");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // Notes are stored in diagram.clusters as single-member clusters
    expect(result.diagram.clusters.some((c) => c.label === "This is a note")).toBe(true);
  });

  it("multiple notes create multiple clusters", async () => {
    setMockDb({
      classes: new Map([
        ["Foo", makeClassNode("Foo", "Foo")],
        ["Bar", makeClassNode("Bar", "Bar")],
      ]),
      relations: [],
      notes: new Map([
        ["n1", { id: "n1", class: "Foo", text: "Note for Foo", index: 0 }],
        ["n2", { id: "n2", class: "Bar", text: "Note for Bar", index: 1 }],
      ]),
      direction: "TD",
    });
    const result = await parseMermaid("classDiagram\n  class Foo");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.clusters).toHaveLength(2);
  });

  it("note cluster members include the subject class ID", async () => {
    setMockDb({
      classes: new Map([["Foo", makeClassNode("Foo", "Foo")]]),
      relations: [],
      notes: new Map([["n1", { id: "n1", class: "Foo", text: "A note", index: 0 }]]),
      direction: "TD",
    });
    const result = await parseMermaid("classDiagram\n  class Foo");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const noteCluster = result.diagram.clusters.find((c) => c.label === "A note");
    expect(noteCluster?.members).toContain("Foo");
  });
});

// ── 6. Direction ─────────────────────────────────────────────────────────────

describe("parseMermaid — classDiagram direction [REQ-CD-06]", () => {
  it.each(["TD", "LR", "RL", "BT"] as const)(
    "detects direction %s",
    async (dir) => {
      setMockDb({
        classes: new Map([["A", makeClassNode("A", "A")]]),
        relations: [],
        notes: new Map(),
        direction: dir,
      });
      const result = await parseMermaid(`classDiagram\n  class A`);
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.diagram.direction).toBe(dir);
    }
  );

  it("normalizes 'TB' from mermaid to 'TD'", async () => {
    setMockDb({
      classes: new Map([["A", makeClassNode("A", "A")]]),
      relations: [],
      notes: new Map(),
      direction: "TB",
    });
    const result = await parseMermaid("classDiagram\n  class A");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.direction).toBe("TD");
  });
});

// ── 7. Error handling ───────────────────────────────────────────────────────

describe("parseMermaid — classDiagram error handling [REQ-CD-07]", () => {
  it("returns valid:false when getDiagramFromText throws", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(
      () => {
        throw Object.assign(new Error("class diagram parse error"), { hash: { line: 3 } });
      }
    );
    const result = await parseMermaid("classDiagram\n  class Foo");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error.message).toBeTruthy();
  });

  it("error result has a line number", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(
      () => {
        throw Object.assign(new Error("bad class syntax"), { hash: { line: 7 } });
      }
    );
    const result = await parseMermaid("classDiagram\n  class Foo -- invalid");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(typeof result.error.line).toBe("number");
  });
});

// ── 8. Empty classDiagram ────────────────────────────────────────────────────

describe("parseMermaid — classDiagram empty diagram", () => {
  beforeEach(() => {
    setMockDb({
      classes: new Map(),
      relations: [],
      notes: new Map(),
      direction: "TD",
    });
  });

  it("empty classDiagram returns empty node map", async () => {
    const result = await parseMermaid("classDiagram");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.size).toBe(0);
  });

  it("empty classDiagram returns empty edges array", async () => {
    const result = await parseMermaid("classDiagram");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges).toHaveLength(0);
  });

  it("empty classDiagram returns empty clusters array", async () => {
    const result = await parseMermaid("classDiagram");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.clusters).toHaveLength(0);
  });
});
