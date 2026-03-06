#!/usr/bin/env node
/**
 * validate-deck.mjs — Validate a Slidev .deck.md file
 *
 * Usage: node skills/presentations/validate-deck.mjs <path-to-deck.md>
 *
 * Checks:
 *  - Valid YAML frontmatter (title, theme present)
 *  - Slide separators (---)
 *  - Speaker notes on every slide
 *  - No slides with excessive text (>10 lines visible)
 *  - At least one visual element (mermaid, grid, image, or two-cols layout)
 *  - Cover slide has background image
 *  - Slide count in reasonable range (3-20)
 *
 * Exit code 0 = all checks pass, 1 = warnings, 2 = errors
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ── Helpers ──────────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";

const errors = [];
const warnings = [];

function error(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

// ── Slidev-aware slide splitter ──────────────────────────────────────────────

/**
 * Parse a Slidev deck into slides, correctly handling:
 *  1. YAML frontmatter (--- ... ---) as part of the first slide
 *  2. Code fences (``` ... ```) that may contain ---
 *  3. Slide separators: a line that is exactly "---" (with optional trailing whitespace)
 *     NOT inside a code fence.
 */
function parseSlidevSlides(raw) {
  const lines = raw.split("\n");
  const slides = [];
  let current = [];
  let inCodeFence = false;
  let inFrontmatter = false;
  let frontmatterDone = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect code fences (``` or ````+)
    if (/^(`{3,})/.test(trimmed)) {
      // Toggle code fence state
      if (!inCodeFence) {
        inCodeFence = true;
      } else {
        // Only close if the fence marker has no other content
        if (/^`{3,}\s*$/.test(trimmed)) {
          inCodeFence = false;
        }
      }
      current.push(line);
      continue;
    }

    // Handle YAML frontmatter: first non-empty content must be ---
    if (!frontmatterDone && !inCodeFence) {
      if (i === 0 && trimmed === "---") {
        inFrontmatter = true;
        current.push(line);
        continue;
      }
      if (inFrontmatter && trimmed === "---") {
        // End of frontmatter — still part of slide 0
        inFrontmatter = false;
        frontmatterDone = true;
        current.push(line);
        continue;
      }
    }

    // Slide separator: exactly "---" on its own line, NOT in a code fence, NOT in frontmatter
    if (!inCodeFence && !inFrontmatter && /^---\s*$/.test(trimmed)) {
      slides.push(current.join("\n"));
      current = [];
      continue;
    }

    current.push(line);
  }

  // Push the last slide
  if (current.length > 0) {
    slides.push(current.join("\n"));
  }

  return slides;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const filePath = process.argv[2];

if (!filePath) {
  console.error(`${RED}Usage: node validate-deck.mjs <path-to-deck.md>${RESET}`);
  process.exit(2);
}

const absPath = resolve(filePath);
if (!existsSync(absPath)) {
  console.error(`${RED}File not found: ${absPath}${RESET}`);
  process.exit(2);
}

const raw = readFileSync(absPath, "utf-8");

// ── Parse Structure ──────────────────────────────────────────────────────────

const slideBlocks = parseSlidevSlides(raw);

console.log(`\n${BOLD}${CYAN}Validating: ${filePath}${RESET}\n`);
console.log(`  Slides found: ${slideBlocks.length}`);

// ── Check 1: Frontmatter ────────────────────────────────────────────────────

const firstBlock = slideBlocks[0] || "";
const frontmatterMatch = firstBlock.match(/^---\s*\n([\s\S]*?)\n---/);

if (!frontmatterMatch) {
  error("Missing YAML frontmatter in first slide");
} else {
  const fm = frontmatterMatch[1];
  if (!fm.includes("title:")) warn("Frontmatter missing 'title'");
  if (!fm.includes("theme:")) warn("Frontmatter missing 'theme'");
  if (!fm.includes("background:") && !fm.includes("layout: default")) {
    warn("Cover slide has no background image");
  }
}

// ── Check 2: Slide Count ────────────────────────────────────────────────────

if (slideBlocks.length < 3) {
  warn(`Only ${slideBlocks.length} slides — consider adding more content`);
} else if (slideBlocks.length > 20) {
  warn(`${slideBlocks.length} slides — consider condensing (aim for ≤15)`);
}

// ── Check 3: Speaker Notes ──────────────────────────────────────────────────

let slidesWithoutNotes = 0;
const notesPattern = /<!--\s*notes?\s*-->/i;

for (let i = 0; i < slideBlocks.length; i++) {
  if (!notesPattern.test(slideBlocks[i])) {
    slidesWithoutNotes++;
    warn(`Slide ${i + 1} has no speaker notes (<!-- notes -->)`);
  }
}

// ── Check 4: Text Density ───────────────────────────────────────────────────

for (let i = 0; i < slideBlocks.length; i++) {
  const block = slideBlocks[i];
  // Remove code blocks, mermaid, HTML, frontmatter, notes
  const stripped = block
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^---[\s\S]*?---/m, "")
    .trim();

  const visibleLines = stripped.split("\n").filter(l => l.trim().length > 0);
  if (visibleLines.length > 8) {
    warn(`Slide ${i + 1} has ${visibleLines.length} visible lines — keep to 5 items max (split if needed)`);
  }
}

// ── Check 5: Visual Elements ────────────────────────────────────────────────

const hasVClicks = /v-click|v-clicks/i.test(raw);
const hasMermaid = /```mermaid/i.test(raw);
const hasGrid = /grid.*grid-cols/i.test(raw);
const hasTwoCols = /layout:\s*two-cols/i.test(raw);
const hasImage = /background:|<img|image-right|image-left/i.test(raw);

if (hasVClicks) warn("v-clicks detected — agent can't step through animations; remove <v-clicks> and make all content immediately visible");
if (!hasMermaid && !hasGrid && !hasTwoCols && !hasImage) {
  warn("No visual elements found (diagrams, grids, images, or multi-column layouts)");
}

// ── Check 6: End Slide ──────────────────────────────────────────────────────

const lastBlock = slideBlocks[slideBlocks.length - 1] || "";
if (!lastBlock.includes("layout: end") && !lastBlock.toLowerCase().includes("thank")) {
  warn("No closing slide (layout: end or 'Thank You')");
}

// ── Report ───────────────────────────────────────────────────────────────────

console.log("");

if (errors.length > 0) {
  console.log(`${RED}${BOLD}Errors (${errors.length}):${RESET}`);
  for (const e of errors) console.log(`  ${RED}✗ ${e}${RESET}`);
}

if (warnings.length > 0) {
  console.log(`${YELLOW}${BOLD}Warnings (${warnings.length}):${RESET}`);
  for (const w of warnings) console.log(`  ${YELLOW}⚠ ${w}${RESET}`);
}

if (errors.length === 0 && warnings.length === 0) {
  console.log(`${GREEN}${BOLD}✓ All checks passed!${RESET}`);
}

// Summary
console.log(`\n${CYAN}Summary:${RESET}`);
console.log(`  Slides:     ${slideBlocks.length}`);
console.log(`  Has notes:  ${slideBlocks.length - slidesWithoutNotes}/${slideBlocks.length}`);
console.log(`  v-clicks:   ${hasVClicks ? "✓" : "✗"}`);
console.log(`  Diagrams:   ${hasMermaid ? "✓" : "✗"}`);
console.log(`  Multi-col:  ${hasTwoCols || hasGrid ? "✓" : "✗"}`);
console.log(`  Images:     ${hasImage ? "✓" : "✗"}`);
console.log("");

if (errors.length > 0) process.exit(2);
if (warnings.length > 0) process.exit(1);
process.exit(0);
