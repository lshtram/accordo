/**
 * accordo-marp — Marp Rendering Engine
 *
 * Wraps @marp-team/marp-core for in-process Markdown → HTML rendering.
 * Source: requirements-marp.md §4 M50-RENDER
 *
 * Requirements:
 *   M50-RENDER-01  Uses @marp-team/marp-core
 *   M50-RENDER-02  Rendering is synchronous
 *   M50-RENDER-03  Returns { html, css, slideCount, comments }
 *   M50-RENDER-04  Supports Marp directives
 *   M50-RENDER-05  Re-renders on file change
 *   M50-RENDER-06  Processes speaker notes
 */

import { Marp } from "@marp-team/marp-core";
import type { MarpRenderResult } from "./types.js";
import { ALL_ACCORDO_THEMES } from "./themes.js";

/** Regex matching either Marp speaker-notes comment syntax. */
const NOTES_SEPARATOR = /<!--\s*(?:notes|speaker_notes)\s*-->/;

/**
 * Split raw Markdown into per-slide strings, honouring the YAML front matter
 * block (if present) so the first slide's content is clean.
 */
function splitSlides(markdown: string): string[] {
  // Strip leading YAML front matter (--- ... ---) before splitting.
  const frontmatterMatch = markdown.match(/^---[\s\S]*?---\n?/);
  const body = frontmatterMatch
    ? markdown.slice(frontmatterMatch[0].length)
    : markdown;

  // Marp slide separator is a `---` on its own line (surrounded by newlines).
  return body.split(/\n---\n/);
}

/**
 * Extract the speaker-notes text from a single slide's raw Markdown content.
 * Returns the trimmed text that follows a `<!-- notes -->` or
 * `<!-- speaker_notes -->` marker, or `""` when no marker is present.
 */
function extractNoteFromSlide(slideMarkdown: string): string {
  const parts = slideMarkdown.split(NOTES_SEPARATOR);
  if (parts.length < 2) {
    return "";
  }
  return parts[1].trim();
}

/**
 * MarpRenderer — converts Markdown deck content to rendered HTML.
 *
 * M50-RENDER-01, M50-RENDER-02, M50-RENDER-03
 */
export class MarpRenderer {
  /**
   * Synchronously renders a Marp Markdown deck to HTML.
   *
   * @param markdown - Raw deck content (may include Marp frontmatter + directives)
   * @returns Render result with html, css, slideCount, and per-slide comments
   *
   * M50-RENDER-01: Uses @marp-team/marp-core
   * M50-RENDER-02: Rendering is synchronous (no child process)
   * M50-RENDER-03: Returns { html, css, slideCount, comments }
   * M50-RENDER-04: Supports marp: true, theme:, paginate:, _class:, header:, footer:
   * M50-RENDER-06: Extracts <!-- notes --> and <!-- speaker_notes --> per slide
   */
  render(markdown: string): MarpRenderResult {
    const marp = new Marp();
    // Register all custom Accordo themes so they're available via `theme:` frontmatter
    for (const css of ALL_ACCORDO_THEMES) {
      marp.themeSet.add(css);
    }
    const { html, css, comments: marpComments } = marp.render(markdown);

    // marpComments is string[][], one entry per slide — its length is the slide count.
    const slideCount = marpComments.length;

    // Split the original markdown to extract per-slide speaker notes from source.
    const slideTexts = splitSlides(markdown);

    const comments: string[] = Array.from({ length: slideCount }, (_, i) => {
      const slideText = slideTexts[i] ?? "";
      return extractNoteFromSlide(slideText);
    });

    return { html, css, slideCount, comments };
  }

  /**
   * Extracts speaker notes from a render result's comments array.
   * Returns null if no notes for the given slide index.
   *
   * M50-RENDER-06
   */
  getNotes(result: MarpRenderResult, slideIndex: number): string | null {
    if (slideIndex < 0 || slideIndex >= result.comments.length) {
      return null;
    }
    const note = result.comments[slideIndex];
    return note === "" ? null : note;
  }
}
