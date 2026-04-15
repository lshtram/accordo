/**
 * presentation-tools.test.ts — Tests for createPresentationTools
 *
 * The tool surface is identical to accordo-slidev — same 9 tool names, same
 * danger levels, same grouping. The only difference is the underlying deps
 * call through to Marp-specific implementations.
 *
 * Requirements covered:
 *   M50-TL-01  discover exists, ungrouped (prompt-visible), safe
 *   M50-TL-02  open opens a deck URI; returns error if invalid
 *   M50-TL-03  close ends the active session
 *   M50-TL-04  listSlides returns ordered slide metadata
 *   M50-TL-05  getCurrent returns current index + title
 *   M50-TL-06  goto moves to exact slide index
 *   M50-TL-07  next advances one slide
 *   M50-TL-08  prev goes back one slide
 *   M50-TL-09  generateNarration returns { narrations: [...] } wrapper
 *   M50-NFR-04 Tool handlers return structured errors (no uncaught throws)
 *   M50-NFR-05 All public exports have explicit return types
 *
 * Test state: ALL tests expected to FAIL with "not implemented" until implementation lands.
 */

import { describe, it, expect, vi } from "vitest";
import { createPresentationTools } from "../presentation-tools.js";
import type { PresentationToolDeps } from "../presentation-tools.js";

// Mock node:fs/promises so capture tests don't hit disk
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

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
    getSessionDeckUri: vi.fn().mockReturnValue(null),
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
  it("M50-TL-01 through M50-TL-10: returns exactly 10 tools", () => {
    // 9 original tools + accordo_webview_capture (M50-TL-10)
    const tools = createPresentationTools(makeDeps());
    expect(tools).toHaveLength(10);
  });

  it("M50-TL-01 through M50-TL-09: all expected tool names are present", () => {
    // Every one of the 9 tool names must appear in the returned array.
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
  it("M50-TL-01: discover is ungrouped (no group property) and dangerLevel safe", () => {
    // discover must be prompt-visible (ungrouped) and never require confirmation.
    const tools = createPresentationTools(makeDeps());
    const discover = getToolByName(tools, "accordo_presentation_discover");
    expect(discover.group).toBeUndefined();
    expect(discover.dangerLevel).toBe("safe");
  });

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

// ── Handler: discover ─────────────────────────────────────────────────────────

describe("accordo_presentation_discover handler", () => {
  it("M50-TL-01: calls discoverDeckFiles and returns { decks } array", async () => {
    // discover must return all found deck file paths.
    const deps = makeDeps({
      discoverDeckFiles: vi.fn().mockResolvedValue(["slides.md", "demo/deck.md"]),
    });
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_discover").handler({});
    expect(deps.discoverDeckFiles).toHaveBeenCalled();
    expect(result).toMatchObject({ decks: ["slides.md", "demo/deck.md"] });
  });

  it("M50-TL-01: returns empty decks array when none found", async () => {
    // Empty workspace — no decks found — must return { decks: [] }.
    const deps = makeDeps({ discoverDeckFiles: vi.fn().mockResolvedValue([]) });
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_discover").handler({});
    expect(result).toMatchObject({ decks: [] });
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

// ── Handler: listSlides ───────────────────────────────────────────────────────

describe("accordo_presentation_listSlides handler", () => {
  it("M50-TL-04: calls listSlides and returns result wrapped in { slides }", async () => {
    // listSlides handler must wrap the array in { slides: [...] }.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_listSlides").handler({});
    expect(deps.listSlides).toHaveBeenCalled();
    expect(result).toMatchObject({ slides: expect.any(Array) });
  });

  it("M50-NFR-04: propagates structured error when no session is open", async () => {
    // If listSlides returns error, handler must propagate it.
    const deps = makeDeps({ listSlides: vi.fn().mockResolvedValue({ error: "No session open" }) });
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_presentation_listSlides").handler({});
    expect(result).toMatchObject({ error: expect.any(String) });
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

// ── Handler: next / prev ──────────────────────────────────────────────────────

describe("accordo_presentation_next handler", () => {
  it("M50-TL-07: calls next()", async () => {
    // next handler must delegate to deps.next.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_next").handler({});
    expect(deps.next).toHaveBeenCalled();
  });
});

describe("accordo_presentation_prev handler", () => {
  it("M50-TL-08: calls prev()", async () => {
    // prev handler must delegate to deps.prev.
    const deps = makeDeps();
    const tools = createPresentationTools(deps);
    await getToolByName(tools, "accordo_presentation_prev").handler({});
    expect(deps.prev).toHaveBeenCalled();
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

// ── accordo_webview_capture — default output path ────────────────────────────

describe("accordo_webview_capture — default output path", () => {
  it("M50-TL-10: default output_path uses deck directory and stem when session is open", async () => {
    // When output_path is omitted and a session is open at /deck/slides.md,
    // the default path must be /deck/slides-slide1.svg (deck-dir/stem-slideN.svg).
    const deps = makeDeps({
      getCurrent: vi.fn().mockResolvedValue({ index: 0, title: "Intro" }),
      getSessionDeckUri: vi.fn().mockReturnValue("/deck/slides.md"),
    });
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_webview_capture").handler({}) as Record<string, unknown>;
    expect(result.captured).toBe(true);
    expect(result.output_path).toBe("/deck/slides-slide1.svg");
  });

  it("M50-TL-10: default output_path falls back to CWD when no session is open", async () => {
    // When output_path is omitted and no session is active, capture() will fail anyway,
    // but the path should still be derived relative to CWD as a safe fallback.
    const deps = makeDeps({
      getCurrent: vi.fn().mockResolvedValue({ index: 0, title: "Intro" }),
      getSessionDeckUri: vi.fn().mockReturnValue(null),
    });
    const tools = createPresentationTools(deps);
    const result = await getToolByName(tools, "accordo_webview_capture").handler({}) as Record<string, unknown>;
    expect(result.captured).toBe(true);
    expect(typeof result.output_path).toBe("string");
    expect((result.output_path as string).endsWith("slide1.svg")).toBe(true);
  });
});
