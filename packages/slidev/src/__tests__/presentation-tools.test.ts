/**
 * presentation-tools.test.ts — Tests for createPresentationTools
 *
 * Requirements covered:
 *   M44-TL-01  discover exists, prompt-visible (no group), safe
 *   M44-TL-02  open returns error for missing/invalid deck
 *   M44-TL-03  close ends session
 *   M44-TL-04  listSlides returns ordered slide metadata
 *   M44-TL-05  getCurrent returns current index + title
 *   M44-TL-06  goto moves to exact slide index
 *   M44-TL-07  next advances one slide
 *   M44-TL-08  prev goes back one slide
 *   M44-TL-09  generateNarration returns narration text
 *   M44-NFR-04  Tool handlers return structured errors (no uncaught throws)
 *   M44-NFR-05  All public exports have explicit return types
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
  it("M44-TL-02 through M44-TL-09: returns exactly 8 tools", () => {
    const tools = createPresentationTools(makeDeps());
    expect(tools).toHaveLength(9);
  });

  it("M44-TL-01 through M44-TL-09: all expected tool names present", () => {
    const tools = createPresentationTools(makeDeps());
    const names = tools.map((t) => t.name);
    expect(names).toContain("accordo_presentation_discover");
    expect(names).toContain("accordo_presentation_open");
    expect(names).toContain("accordo_presentation_close");
    expect(names).toContain("accordo_presentation_listSlides");
    expect(names).toContain("accordo_presentation_getCurrent");
    expect(names).toContain("accordo_presentation_goto");
    expect(names).toContain("accordo_presentation_next");
    expect(names).toContain("accordo_presentation_prev");
    expect(names).toContain("accordo_presentation_generateNarration");
  });
});

// ── Grouping and danger levels ────────────────────────────────────────────────

describe("createPresentationTools — grouping and danger levels", () => {
  it("M44-TL-01: discover is ungrouped (no group property) and dangerLevel safe", () => {
    const tools = createPresentationTools(makeDeps());
    const discover = getToolByName(tools, "accordo_presentation_discover");
    expect(discover.group).toBeUndefined();
    expect(discover.dangerLevel).toBe("safe");
  });

  it("M44-TL-02: open is in group 'presentation'", () => {
    const tools = createPresentationTools(makeDeps());
    const open = getToolByName(tools, "accordo_presentation_open");
    expect(open.group).toBe("presentation");
  });

  it("M44-TL-02: open danger level is 'moderate'", () => {
    const tools = createPresentationTools(makeDeps());
    const open = getToolByName(tools, "accordo_presentation_open");
    expect(open.dangerLevel).toBe("moderate");
  });

  it("M44-TL-03: close danger level is 'moderate'", () => {
    const tools = createPresentationTools(makeDeps());
    const close = getToolByName(tools, "accordo_presentation_close");
    expect(close.dangerLevel).toBe("moderate");
  });

  it("M44-TL-04 through 09: navigation/read tools are in group 'presentation' and 'safe'", () => {
    const tools = createPresentationTools(makeDeps());
    const readToolNames = [
      "accordo_presentation_listSlides",
      "accordo_presentation_getCurrent",
      "accordo_presentation_goto",
      "accordo_presentation_next",
      "accordo_presentation_prev",
      "accordo_presentation_generateNarration",
    ];
    for (const name of readToolNames) {
      const tool = getToolByName(tools, name);
      expect(tool.group).toBe("presentation");
      expect(tool.dangerLevel).toBe("safe");
    }
  });
});

// ── Handler: discover ────────────────────────────────────────────────────────

describe("accordo_presentation_discover handler", () => {
  it("M44-TL-01: calls discoverDeckFiles and returns { decks } array", async () => {
    const deps = makeDeps({
      discoverDeckFiles: vi.fn().mockResolvedValue(["slides.md", "demo/deck.md"]),
    });
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_discover").handler({});
    expect(deps.discoverDeckFiles).toHaveBeenCalled();
    expect(result).toMatchObject({ decks: ["slides.md", "demo/deck.md"] });
  });

  it("M44-TL-01: returns empty decks array when none found", async () => {
    const deps = makeDeps({ discoverDeckFiles: vi.fn().mockResolvedValue([]) });
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_discover").handler({});
    expect(result).toMatchObject({ decks: [] });
  });
});

// ── Handler: open ─────────────────────────────────────────────────────────────

describe("accordo_presentation_open handler", () => {
  it("M44-TL-02: calls openSession with deckUri argument", async () => {
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_open").handler({ deckUri: "/slides.md" });
    expect(deps.openSession).toHaveBeenCalledWith("/slides.md");
  });

  it("M44-TL-02 / M44-NFR-04: propagates structured error from openSession", async () => {
    const deps = makeDeps({ openSession: vi.fn().mockResolvedValue({ error: "File not found" }) });
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_open").handler({ deckUri: "/missing.md" });
    expect(result).toMatchObject({ error: "File not found" });
  });

  it("M44-NFR-04: missing deckUri arg returns structured error (no throw)", async () => {
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_open").handler({});
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

// ── Handler: close ────────────────────────────────────────────────────────────

describe("accordo_presentation_close handler", () => {
  it("M44-TL-03: calls closeSession", async () => {
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_close").handler({});
    expect(deps.closeSession).toHaveBeenCalled();
  });
});

// ── Handler: listSlides ───────────────────────────────────────────────────────

describe("accordo_presentation_listSlides handler", () => {
  it("M44-TL-04: calls listSlides and returns result", async () => {
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_listSlides").handler({});
    expect(deps.listSlides).toHaveBeenCalled();
    expect(result).toMatchObject({ slides: expect.any(Array) });
  });

  it("M44-NFR-04: propagates structured error when no session open", async () => {
    const deps = makeDeps({ listSlides: vi.fn().mockResolvedValue({ error: "No session open" }) });
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_listSlides").handler({});
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

// ── Handler: getCurrent ───────────────────────────────────────────────────────

describe("accordo_presentation_getCurrent handler", () => {
  it("M44-TL-05: calls getCurrent and returns index + title", async () => {
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_getCurrent").handler({});
    expect(deps.getCurrent).toHaveBeenCalled();
    expect(result).toMatchObject({ index: 0, title: "Introduction" });
  });
});

// ── Handler: goto ─────────────────────────────────────────────────────────────

describe("accordo_presentation_goto handler", () => {
  it("M44-TL-06: calls goto with the provided index", async () => {
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_goto").handler({ index: 2 });
    expect(deps.goto).toHaveBeenCalledWith(2);
  });

  it("M44-NFR-04: missing index returns structured error (no throw)", async () => {
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_goto").handler({});
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

// ── Handler: next / prev ──────────────────────────────────────────────────────

describe("accordo_presentation_next handler", () => {
  it("M44-TL-07: calls next()", async () => {
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_next").handler({});
    expect(deps.next).toHaveBeenCalled();
  });
});

describe("accordo_presentation_prev handler", () => {
  it("M44-TL-08: calls prev()", async () => {
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_prev").handler({});
    expect(deps.prev).toHaveBeenCalled();
  });
});

// ── Handler: generateNarration ────────────────────────────────────────────────

describe("accordo_presentation_generateNarration handler", () => {
  it("M44-TL-09: calls generateNarration with slideIndex when provided", async () => {
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_generateNarration").handler({ slideIndex: 1 });
    expect(deps.generateNarration).toHaveBeenCalledWith(1);
  });

  it("M44-TL-09: calls generateNarration with 'all' when no index provided", async () => {
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_generateNarration").handler({});
    expect(deps.generateNarration).toHaveBeenCalledWith("all");
  });

  it("M44-TL-09: returns narrations array", async () => {
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_generateNarration").handler({});
    expect(result).toMatchObject({ narrations: expect.any(Array) });
  });

  it("M44-NFR-04: propagates structured error from generateNarration", async () => {
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
  it("M44-NFR-05: all tools have inputSchema of type 'object'", () => {
    const tools = createPresentationTools(makeDeps());
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("M44-TL-02: open schema requires deckUri property", () => {
    const tools = createPresentationTools(makeDeps());
    const open = getToolByName(tools, "accordo_presentation_open");
    expect(open.inputSchema.properties).toHaveProperty("deckUri");
  });

  it("M44-TL-06: goto schema requires index property", () => {
    const tools = createPresentationTools(makeDeps());
    const goto = getToolByName(tools, "accordo_presentation_goto");
    expect(goto.inputSchema.properties).toHaveProperty("index");
  });
});
