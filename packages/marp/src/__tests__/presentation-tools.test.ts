/**
 * presentation-tools.test.ts — Tests for createPresentationTools
 *
 * The tool surface is identical to accordo-slidev — same 9 tool names, same
 * danger levels, same grouping. The only difference is the underlying deps
 * call through to Marp-specific implementations.
 *
 * Requirements covered:
 *   M50-TL-02  open opens a deck URI; returns error if invalid
 *   M50-TL-03  close ends the active session
 *   M50-TL-05  getCurrent returns current index + title
 *   M50-TL-06  goto moves to exact slide index
 *   M50-TL-09  generateNarration returns { narrations: [...] } wrapper
 *   M50-NFR-04 Tool handlers return structured errors (no uncaught throws)
 *   M50-NFR-05 All public exports have explicit return types
 */

import { describe, it, expect, vi } from "vitest";
import { createPresentationTools } from "../presentation-tools.js";
import type { PresentationToolDeps } from "../presentation-tools.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDeps(overrides?: Partial<PresentationToolDeps>): PresentationToolDeps {
  return {
    discoverDeckFiles: vi.fn().mockResolvedValue(["slides/intro.md", "slides/demo.md"]),
    openSession: vi.fn().mockResolvedValue({}),
    closeSession: vi.fn(),
    listSlides: vi.fn().mockResolvedValue([
      { index: 0, title: "Introduction" },
      { index: 1, title: "Demo" },
    ]),
    getCurrent: vi.fn().mockResolvedValue({ index: 0, title: "Introduction" }),
    goto: vi.fn().mockResolvedValue({}),
    next: vi.fn().mockResolvedValue({}),
    prev: vi.fn().mockResolvedValue({}),
    generateNarration: vi.fn().mockResolvedValue([
      { slideIndex: 0, narrationText: "Welcome to the presentation." },
    ]),
    capture: vi.fn().mockResolvedValue(Buffer.from("<svg></svg>")),
    ...overrides,
  };
}

function getToolByName(tools: ReturnType<typeof createPresentationTools>, name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ── Tool count and names ──────────────────────────────────────────────────────

describe("createPresentationTools — tool count and names", () => {
  it("M50-TL-01 through M50-TL-09: returns exactly 5 tools (4 removed)", () => {
    // 5 remaining tools: open, close, getCurrent, goto, generateNarration
    // 4 removed: discover, listSlides, next, prev
    const tools = createPresentationTools(makeDeps());
    expect(tools).toHaveLength(5);
  });

  it("M50-TL-01 through M50-TL-09: all expected tool names are present", () => {
    // Every one of the 5 tool names must appear in the returned array.
    // Note: discover, listSlides, next, prev are removed from public MCP surface.
    const tools = createPresentationTools(makeDeps());
    const names = tools.map((t) => t.name);
    expect(names).toContain("accordo_presentation_open");
    expect(names).toContain("accordo_presentation_close");
    expect(names).toContain("accordo_presentation_getCurrent");
    expect(names).toContain("accordo_presentation_goto");
    expect(names).toContain("accordo_presentation_generateNarration");
  });

  it("removed tools are not in the returned array", () => {
    // discover, listSlides, next, prev were removed from public MCP surface.
    const tools = createPresentationTools(makeDeps());
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("accordo_presentation_discover");
    expect(names).not.toContain("accordo_presentation_listSlides");
    expect(names).not.toContain("accordo_presentation_next");
    expect(names).not.toContain("accordo_presentation_prev");
  });
});

// ── Grouping and danger levels ────────────────────────────────────────────────

describe("createPresentationTools — grouping and danger levels", () => {
  it("M50-TL-02: open is in group 'presentation'", () => {
    // Session management tools belong to the presentation group.
    const tools = createPresentationTools(makeDeps());
    const open = getToolByName(tools, "accordo_presentation_open");
    expect(open.group).toBe("presentation");
  });

  it("M50-TL-02: open danger level is 'moderate'", () => {
    // Opening a session has side effects — it is a moderate danger operation.
    const tools = createPresentationTools(makeDeps());
    const open = getToolByName(tools, "accordo_presentation_open");
    expect(open.dangerLevel).toBe("moderate");
  });

  it("M50-TL-03: close danger level is 'moderate'", () => {
    // Closing a session is also a moderate-danger side effect.
    const tools = createPresentationTools(makeDeps());
    const close = getToolByName(tools, "accordo_presentation_close");
    expect(close.dangerLevel).toBe("moderate");
  });

  it("M50-TL-03: close is in group 'presentation'", () => {
    const tools = createPresentationTools(makeDeps());
    const close = getToolByName(tools, "accordo_presentation_close");
    expect(close.group).toBe("presentation");
  });

  it("M50-TL-04 through M50-TL-09: navigation/read tools are in group 'presentation' and 'safe'", () => {
    // All read/navigation tools: presentation group, safe danger level.
    // Note: listSlides, next, prev removed from public MCP surface.
    const tools = createPresentationTools(makeDeps());
    const readToolNames = [
      "accordo_presentation_getCurrent",
      "accordo_presentation_goto",
      "accordo_presentation_generateNarration",
    ];
    for (const name of readToolNames) {
      const tool = getToolByName(tools, name);
      expect(tool.group).toBe("presentation");
      expect(tool.dangerLevel).toBe("safe");
    }
  });
});

// ── Handler: open ─────────────────────────────────────────────────────────────

describe("accordo_presentation_open handler", () => {
  it("M50-TL-02: calls openSession with deckUri argument", async () => {
    // The deckUri arg must be forwarded to deps.openSession verbatim.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_open").handler({ deckUri: "/slides.md" });
    expect(deps.openSession).toHaveBeenCalledWith("/slides.md");
  });

  it("M50-TL-02: success response includes opened:true and deckUri (not empty)", async () => {
    // On success, handler must return { opened: true, deckUri } for deterministic automation checks.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_open").handler({ deckUri: "/slides.md" });
    expect(result).toMatchObject({ opened: true, deckUri: "/slides.md" });
  });

  it("M50-TL-02 / M50-NFR-04: propagates structured error from openSession", async () => {
    // If openSession returns { error }, the handler must propagate it.
    const deps = makeDeps({ openSession: vi.fn().mockResolvedValue({ error: "File not found" }) });
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_open").handler({ deckUri: "/missing.md" });
    expect(result).toMatchObject({ error: "File not found" });
  });

  it("M50-NFR-04: missing deckUri returns structured error (no throw)", async () => {
    // When deckUri is absent, handler must return { error } not throw.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_open").handler({});
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

// ── Handler: close ────────────────────────────────────────────────────────────

describe("accordo_presentation_close handler", () => {
  it("M50-TL-03: calls closeSession", async () => {
    // close handler must delegate to deps.closeSession.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_close").handler({});
    expect(deps.closeSession).toHaveBeenCalled();
  });
});

// ── Handler: getCurrent ───────────────────────────────────────────────────────

describe("accordo_presentation_getCurrent handler", () => {
  it("M50-TL-05: calls getCurrent and returns { index, title } with 1-based index", async () => {
    // getCurrent handler must return the 1-based slide number and title.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_getCurrent").handler({});
    expect(deps.getCurrent).toHaveBeenCalled();
    expect(result).toMatchObject({ index: 1, title: "Introduction" });
  });
});

// ── Handler: goto ─────────────────────────────────────────────────────────────

describe("accordo_presentation_goto handler", () => {
  it("M50-TL-06: calls goto with the provided index converted to 0-based", async () => {
    // goto handler receives 1-based slide number and converts to 0-based before calling deps.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_goto").handler({ index: 2 });
    expect(deps.goto).toHaveBeenCalledWith(1);
  });

  it("M50-NFR-04: missing index returns structured error (no throw)", async () => {
    // When index arg is absent, return { error } instead of throwing.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_goto").handler({});
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

// ── Handler: generateNarration ────────────────────────────────────────────────

describe("accordo_presentation_generateNarration handler", () => {
  it("M50-TL-09: calls generateNarration with slideIndex converted to 0-based when provided", async () => {
    // When slideIndex is given (1-based), subtract 1 before calling deps.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_generateNarration").handler({ slideIndex: 1 });
    expect(deps.generateNarration).toHaveBeenCalledWith(0);
  });

  it("M50-TL-09: calls generateNarration with 'all' when no slideIndex provided", async () => {
    // When slideIndex is absent, default to 'all'.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_generateNarration").handler({});
    expect(deps.generateNarration).toHaveBeenCalledWith("all");
  });

  it("M50-TL-09: returns { narrations: [...] } wrapper around the array", async () => {
    // Handler must wrap the narration array in { narrations }.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_generateNarration").handler({});
    expect(result).toMatchObject({ narrations: expect.any(Array) });
  });

  it("M50-TL-09: returns narration slideIndex as 1-based", async () => {
    // Public presentation tools use 1-based slide numbers in both inputs and outputs.
    const deps = makeDeps({
      generateNarration: vi.fn().mockResolvedValue([
        { slideIndex: 1, narrationText: "Second slide narration." },
      ]),
    });
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_generateNarration").handler({ slideIndex: 2 });
    expect(result).toMatchObject({
      narrations: [{ slideIndex: 2, narrationText: "Second slide narration." }],
    });
  });

  it("M50-NFR-04: propagates structured error from generateNarration", async () => {
    // When deps.generateNarration returns { error }, the handler propagates it.
    const deps = makeDeps({
      generateNarration: vi.fn().mockResolvedValue({ error: "No deck open" }),
    });
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_generateNarration").handler({});
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

// ── Input schema ──────────────────────────────────────────────────────────────

describe("createPresentationTools — input schemas", () => {
  it("M50-NFR-05: all tools have inputSchema of type 'object'", () => {
    // Every tool inputSchema must be a valid JSON Schema object type.
    const tools = createPresentationTools(makeDeps());
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("M50-TL-02: open schema requires deckUri property", () => {
    // The deckUri is the required param for open.
    const tools = createPresentationTools(makeDeps());
    const open = getToolByName(tools, "accordo_presentation_open");
    expect(open.inputSchema.properties).toHaveProperty("deckUri");
  });

  it("M50-TL-06: goto schema requires index property", () => {
    // The index is the required param for goto.
    const tools = createPresentationTools(makeDeps());
    const goto = getToolByName(tools, "accordo_presentation_goto");
    expect(goto.inputSchema.properties).toHaveProperty("index");
  });

  it("M50-TL-09: generateNarration schema has optional slideIndex property", () => {
    // slideIndex is optional (absent = 'all').
    const tools = createPresentationTools(makeDeps());
    const gen = getToolByName(tools, "accordo_presentation_generateNarration");
    expect(gen.inputSchema.properties).toHaveProperty("slideIndex");
  });

  it("M50-NFR-05: all tools have a non-empty description", () => {
    // Every tool must have a meaningful description for the system prompt.
    const tools = createPresentationTools(makeDeps());
    for (const tool of tools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});
