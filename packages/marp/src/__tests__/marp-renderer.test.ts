/**
 * marp-renderer.test.ts — Tests for MarpRenderer
 *
 * Requirements covered:
 *   M50-RENDER-01  Uses @marp-team/marp-core to convert Markdown to HTML
 *   M50-RENDER-02  Rendering is synchronous (no child process, no server)
 *   M50-RENDER-03  Returns structured output: { html, css, slideCount, comments }
 *   M50-RENDER-04  Supports Marp directives: marp: true, theme:, paginate:, _class:, header:, footer:
 *   M50-RENDER-05  Deterministic output for live-reload path (M50-PVD-07 integration in provider tests)
 *   M50-RENDER-06  Processes <!-- notes --> and <!-- speaker_notes --> speaker notes sections
 */

import { describe, it, expect } from "vitest";
import { MarpRenderer } from "../marp-renderer.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** One-slide Marp deck with no directives other than marp:true. */
const SINGLE_SLIDE = `---
marp: true
---

# Hello World

Welcome to the presentation.`;

/** Three-slide Marp deck separated by \`---\`. */
const THREE_SLIDES = `---
marp: true
---

# First Slide

Content A

---

# Second Slide

Content B

---

# Third Slide

Content C`;

// ── Basic rendering — M50-RENDER-01, M50-RENDER-02, M50-RENDER-03 ─────────────

describe("MarpRenderer — basic rendering (M50-RENDER-01, M50-RENDER-02, M50-RENDER-03)", () => {
  it("M50-RENDER-03: render() returns an object with html, css, slideCount, comments properties", () => {
    // Ensures the structured contract shape is correct.
    const renderer = new MarpRenderer();
    const result = renderer.render(SINGLE_SLIDE);

    expect(result).toBeDefined();
    expect(result).toHaveProperty("html");
    expect(result).toHaveProperty("css");
    expect(result).toHaveProperty("slideCount");
    expect(result).toHaveProperty("comments");
  });

  it("M50-RENDER-03: html is a non-empty string", () => {
    // Core contract — render must produce HTML output.
    const renderer = new MarpRenderer();
    const result = renderer.render(SINGLE_SLIDE);

    expect(typeof result.html).toBe("string");
    expect(result.html.length).toBeGreaterThan(0);
  });

  it("M50-RENDER-03: css is a non-empty string", () => {
    // Marp always injects theme CSS — must be returned to caller.
    const renderer = new MarpRenderer();
    const result = renderer.render(SINGLE_SLIDE);

    expect(typeof result.css).toBe("string");
    expect(result.css.length).toBeGreaterThan(0);
  });

  it("M50-RENDER-03: comments is an array", () => {
    // The comments array must always be present (empty or populated).
    const renderer = new MarpRenderer();
    const result = renderer.render(SINGLE_SLIDE);

    expect(Array.isArray(result.comments)).toBe(true);
  });

  it("M50-RENDER-01: HTML output contains <section> elements (Marp slide structure)", () => {
    // @marp-team/marp-core wraps each slide in a <section> — confirms marp-core is used.
    const renderer = new MarpRenderer();
    const result = renderer.render(SINGLE_SLIDE);

    expect(result.html).toContain("<section");
  });

  it("M50-RENDER-01: HTML output contains the slide's heading text", () => {
    // Confirms content is actually rendered, not just structure returned.
    const renderer = new MarpRenderer();
    const result = renderer.render(SINGLE_SLIDE);

    expect(result.html).toContain("Hello World");
  });

  it("M50-RENDER-02: render() is synchronous — returns a plain (non-Promise) value", () => {
    // Rendering must not be async. A Promise return value fails this test.
    const renderer = new MarpRenderer();
    const result = renderer.render(SINGLE_SLIDE);

    // If render() returns a Promise, it will not have an `html` property directly.
    expect(typeof (result as unknown as Promise<unknown>)?.then).not.toBe("function");
    expect(result.html).toBeDefined();
  });

  it("M50-RENDER-05: render() produces deterministic output (backing contract for M50-PVD-07 live-reload)", () => {
    // Consistent output on repeated renders is required for the live-reload path.
    // The file-change watcher trigger and webview push are tested in M50-PVD.
    const renderer = new MarpRenderer();
    const r1 = renderer.render(SINGLE_SLIDE);
    const r2 = renderer.render(SINGLE_SLIDE);

    expect(r1.slideCount).toBe(r2.slideCount);
    expect(r1.html.length).toBe(r2.html.length);
  });
});

// ── Slide counting — M50-RENDER-03 ────────────────────────────────────────────

describe("MarpRenderer — slide counting (M50-RENDER-03)", () => {
  it("M50-RENDER-03: single-slide deck returns slideCount = 1", () => {
    // Baseline slide count contract.
    const renderer = new MarpRenderer();
    const result = renderer.render(SINGLE_SLIDE);

    expect(result.slideCount).toBe(1);
  });

  it("M50-RENDER-03: 3-slide deck (--- separated) returns slideCount = 3", () => {
    // Three content slides separated by --- must each be counted.
    const renderer = new MarpRenderer();
    const result = renderer.render(THREE_SLIDES);

    expect(result.slideCount).toBe(3);
  });

  it("M50-RENDER-03: deck with no --- separator returns slideCount = 1", () => {
    // Plain markdown (no --- slide breaks) is a single slide.
    const renderer = new MarpRenderer();
    const markdown = "---\nmarp: true\n---\n\n# Only Slide\n\nJust one slide here.";
    const result = renderer.render(markdown);

    expect(result.slideCount).toBe(1);
  });

  it("M50-RENDER-03: comments array length equals slideCount", () => {
    // One entry per slide — even if empty — ensures per-slide alignment.
    const renderer = new MarpRenderer();
    const result = renderer.render(THREE_SLIDES);

    expect(result.comments).toHaveLength(result.slideCount);
  });

  it("M50-RENDER-03: 2-slide deck returns slideCount = 2", () => {
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
---

# Slide One

---

# Slide Two`;
    const result = renderer.render(markdown);

    expect(result.slideCount).toBe(2);
  });
});

// ── Directive support — M50-RENDER-04 ─────────────────────────────────────────

describe("MarpRenderer — Marp directives (M50-RENDER-04)", () => {
  it("M50-RENDER-04: marp: true in frontmatter renders without error", () => {
    // The `marp: true` directive is the mandatory activation flag.
    const renderer = new MarpRenderer();

    expect(() => renderer.render(SINGLE_SLIDE)).not.toThrow();
    const result = renderer.render(SINGLE_SLIDE);
    expect(result.html).toContain("<section");
  });

  it("M50-RENDER-04: theme: default directive renders and produces non-empty CSS", () => {
    // Theme directive must be processed (or gracefully ignored) — no throw allowed.
    // We verify CSS is non-empty, confirming the theme was applied.
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
theme: default
---

# Theme Test`;

    expect(() => renderer.render(markdown)).not.toThrow();
    const result = renderer.render(markdown);
    expect(result.slideCount).toBe(1);
    expect(result.css.length).toBeGreaterThan(0);
  });

  it("M50-RENDER-04: paginate: true directive renders and produces CSS (page number styles)", () => {
    // Pagination directive — Marp adds page-number styles when enabled.
    // We verify CSS is non-empty as evidence of pagination processing.
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
paginate: true
---

# Paginated Slide`;

    expect(() => renderer.render(markdown)).not.toThrow();
    const result = renderer.render(markdown);
    expect(result.css.length).toBeGreaterThan(0);
  });

  it("M50-RENDER-04: _class: lead directive renders without error", () => {
    // _class is a local directive applied to a single slide.
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
---

<!-- _class: lead -->

# Lead Slide`;

    expect(() => renderer.render(markdown)).not.toThrow();
    const result = renderer.render(markdown);
    expect(result.slideCount).toBe(1);
    expect(result.html).toContain("lead");
  });

  it("M50-RENDER-04: header: directive renders and header text appears in HTML", () => {
    // Global header directive adds header text to all slides.
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
header: "My Presentation"
---

# Slide with Header`;

    expect(() => renderer.render(markdown)).not.toThrow();
    const result = renderer.render(markdown);
    // Header text is embedded in the HTML output by Marp
    expect(result.html).toContain("My Presentation");
  });

  it("M50-RENDER-04: footer: directive renders and footer text appears in HTML", () => {
    // Global footer directive — similar to header but at the bottom.
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
footer: "Page %d"
---

# Slide with Footer`;

    expect(() => renderer.render(markdown)).not.toThrow();
    const result = renderer.render(markdown);
    // Footer text is embedded in the HTML output by Marp
    expect(result.html).toContain("Page %d");
  });

  it("M50-RENDER-04: multiple directives together render without error", () => {
    // Real-world deck typically combines multiple directives.
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
theme: default
paginate: true
header: "Accordo IDE"
footer: "Page %d"
---

# Full Directives

Some content

---

<!-- _class: lead -->

# Lead Slide`;

    expect(() => renderer.render(markdown)).not.toThrow();
    const result = renderer.render(markdown);
    expect(result.slideCount).toBe(2);
  });
});

// ── Speaker notes extraction — M50-RENDER-06 ──────────────────────────────────

describe("MarpRenderer — speaker notes extraction (M50-RENDER-06)", () => {
  it("M50-RENDER-06: <!-- notes --> comment is extracted into comments array", () => {
    // The primary Marp speaker notes syntax must be captured per-slide.
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
---

# Slide One

Some content

<!-- notes -->

This is the spoken note for slide one.`;

    const result = renderer.render(markdown);
    expect(result.comments[0]).toContain("spoken note");
  });

  it("M50-RENDER-06: <!-- speaker_notes --> comment is extracted into comments array", () => {
    // Alternative speaker_notes syntax must also be supported.
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
---

# Slide One

Content here.

<!-- speaker_notes -->

Say this to the audience.`;

    const result = renderer.render(markdown);
    expect(result.comments[0]).toContain("Say this");
  });

  it("M50-RENDER-06: slide with no notes has empty string in comments array", () => {
    // Every slide must have a corresponding comments entry (empty string if no notes).
    const renderer = new MarpRenderer();
    const result = renderer.render(SINGLE_SLIDE);

    expect(result.comments[0]).toBe("");
  });

  it("M50-RENDER-06: multiple slides with mixed notes — correct per-slide extraction", () => {
    // Notes on slide 2 must not bleed into slide 1 or slide 3.
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
---

# Slide One

No notes here.

---

# Slide Two

Has speaker notes.

<!-- notes -->

Speak about the architecture diagram.

---

# Slide Three

Also no notes.`;

    const result = renderer.render(markdown);
    expect(result.comments).toHaveLength(3);
    expect(result.comments[0]).toBe(""); // slide 1 — no notes
    expect(result.comments[1]).toContain("architecture diagram"); // slide 2 — has notes
    expect(result.comments[2]).toBe(""); // slide 3 — no notes
  });

  it("M50-RENDER-06: all slides with notes — all entries populated", () => {
    // When every slide has notes, the comments array must be fully populated.
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
---

# Slide One

Content A.

<!-- notes -->

Note for slide one.

---

# Slide Two

Content B.

<!-- notes -->

Note for slide two.`;

    const result = renderer.render(markdown);
    expect(result.comments).toHaveLength(2);
    expect(result.comments[0]).toContain("Note for slide one");
    expect(result.comments[1]).toContain("Note for slide two");
  });

  it("M50-RENDER-06: no notes in any slide — all comments entries are empty strings", () => {
    // When there are no speaker notes, the comments array should be all empty strings.
    const renderer = new MarpRenderer();
    const result = renderer.render(THREE_SLIDES);

    expect(result.comments).toHaveLength(3);
    result.comments.forEach((note) => expect(note).toBe(""));
  });
});

// ── getNotes helper — M50-RENDER-06 ───────────────────────────────────────────

describe("MarpRenderer — getNotes() helper (M50-RENDER-06)", () => {
  it("M50-RENDER-06: getNotes() returns the note text for a slide that has notes", () => {
    // Convenience accessor must return the correct note string.
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
---

# Slide

Content.

<!-- notes -->

Narrator says hello.`;

    const result = renderer.render(markdown);
    const note = renderer.getNotes(result, 0);

    expect(note).toContain("Narrator says hello");
  });

  it("M50-RENDER-06: getNotes() returns null for a slide with no notes", () => {
    // Slides without notes must return null (not empty string or undefined).
    const renderer = new MarpRenderer();
    const result = renderer.render(SINGLE_SLIDE);

    expect(renderer.getNotes(result, 0)).toBeNull();
  });

  it("M50-RENDER-06: getNotes() returns null for an out-of-range slide index", () => {
    // Guard against index overflow — must not throw, must return null.
    const renderer = new MarpRenderer();
    const result = renderer.render(SINGLE_SLIDE);

    expect(renderer.getNotes(result, 999)).toBeNull();
  });

  it("M50-RENDER-06: getNotes() returns null for a negative slide index", () => {
    const renderer = new MarpRenderer();
    const result = renderer.render(SINGLE_SLIDE);

    expect(renderer.getNotes(result, -1)).toBeNull();
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe("MarpRenderer — edge cases", () => {
  it("M50-RENDER-03: empty string input does not throw", () => {
    const renderer = new MarpRenderer();
    expect(() => renderer.render("")).not.toThrow();
  });

  it("M50-RENDER-03: empty string input returns a MarpRenderResult with correct shape", () => {
    const renderer = new MarpRenderer();
    const result = renderer.render("");
    expect(result).toHaveProperty("html");
    expect(result).toHaveProperty("css");
    expect(result).toHaveProperty("slideCount");
    expect(result).toHaveProperty("comments");
    expect(typeof result.slideCount).toBe("number");
    expect(Array.isArray(result.comments)).toBe(true);
  });

  it("M50-RENDER-03: deck with only frontmatter and no content slides renders gracefully", () => {
    const renderer = new MarpRenderer();
    const markdown = `---
marp: true
theme: default
---`;
    expect(() => renderer.render(markdown)).not.toThrow();
    const result = renderer.render(markdown);
    expect(typeof result.slideCount).toBe("number");
    expect(result.slideCount).toBeGreaterThanOrEqual(0);
  });

  it("M50-RENDER-03: deck with only content (no frontmatter) renders without error", () => {
    const renderer = new MarpRenderer();
    const markdown = `# No Frontmatter

Just content without a YAML front matter block.

---

# Second Slide`;
    expect(() => renderer.render(markdown)).not.toThrow();
    const result = renderer.render(markdown);
    expect(result.html.length).toBeGreaterThan(0);
  });

  it("M50-RENDER-03: deck with very long content renders without error", () => {
    const renderer = new MarpRenderer();
    const slides = Array.from(
      { length: 10 },
      (_, i) => `# Slide ${i + 1}\n\nContent for slide ${i + 1}.\n\n- Item A\n- Item B\n- Item C`,
    ).join("\n\n---\n\n");
    const markdown = `---\nmarp: true\n---\n\n${slides}`;
    expect(() => renderer.render(markdown)).not.toThrow();
    const result = renderer.render(markdown);
    expect(result.slideCount).toBe(10);
  });
});
