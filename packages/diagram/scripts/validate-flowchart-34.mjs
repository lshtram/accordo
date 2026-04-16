#!/usr/bin/env node
/**
 * Validation script for the SVG geometry polyfill fix.
 *
 * This script runs as a standalone Node.js ESM file (not via vitest) to test
 * that the jsdom + SVG geometry polyfill path produces real node/edge elements
 * (not an image fallback) for flowchart-34.mmd.
 *
 * Run with: node scripts/validate-flowchart-34.mjs
 * Must be run from the packages/diagram directory.
 */

import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Step 1: Create jsdom environment ──────────────────────────────────────────

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost",
  contentType: "text/html",
  includeNodeLocations: false,
  runScripts: "outside-only",
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;

// ── Step 2: Apply SVG geometry polyfills ──────────────────────────────────────
// These mirror the polyfills in panel-core.ts _applySvgPolyfills().

/** Bounding box result type */
class BBox {
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
}

function _bboxFromRect(el) {
  const x = parseFloat(el.getAttribute?.("x") ?? "0");
  const y = parseFloat(el.getAttribute?.("y") ?? "0");
  const w = parseFloat(el.getAttribute?.("width") ?? "0");
  const h = parseFloat(el.getAttribute?.("height") ?? "0");
  return new BBox(x, y, w, h);
}

function _bboxFromCircle(el) {
  const cx = parseFloat(el.getAttribute?.("cx") ?? "0");
  const cy = parseFloat(el.getAttribute?.("cy") ?? "0");
  const r = parseFloat(el.getAttribute?.("r") ?? "0");
  return new BBox(cx - r, cy - r, r * 2, r * 2);
}

function _bboxFromEllipse(el) {
  const cx = parseFloat(el.getAttribute?.("cx") ?? "0");
  const cy = parseFloat(el.getAttribute?.("cy") ?? "0");
  const rx = parseFloat(el.getAttribute?.("rx") ?? "0");
  const ry = parseFloat(el.getAttribute?.("ry") ?? "0");
  return new BBox(cx - rx, cy - ry, rx * 2, ry * 2);
}

function _bboxFromLine(el) {
  const x1 = parseFloat(el.getAttribute?.("x1") ?? "0");
  const y1 = parseFloat(el.getAttribute?.("y1") ?? "0");
  const x2 = parseFloat(el.getAttribute?.("x2") ?? "0");
  const y2 = parseFloat(el.getAttribute?.("y2") ?? "0");
  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  return new BBox(minX, minY, Math.max(x2 - x1, 1) || 1, Math.max(y2 - y1, 1) || 1);
}

function _pathCoords(d) {
  const nums = [];
  const re = /(?:^|[ML])\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    nums.push(parseFloat(m[1]), parseFloat(m[2]));
  }
  return nums;
}

function _bboxFromPath(el) {
  const d = el.getAttribute?.("d") ?? "";
  const nums = _pathCoords(d);
  if (nums.length < 4) return new BBox(0, 0, 0, 0);
  let minX = nums[0], maxX = nums[0], minY = nums[1], maxY = nums[1];
  for (let i = 0; i < nums.length; i += 2) {
    const px = nums[i], py = nums[i + 1];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return new BBox(minX, minY, Math.max(maxX - minX, 1), Math.max(maxY - minY, 1));
}

function _bboxFromPoly(el) {
  const raw = el.getAttribute?.("points") ?? "";
  const nums = [];
  for (const part of raw.trim().split(/[\s,]+/)) {
    const n = parseFloat(part);
    if (!isNaN(n)) nums.push(n);
  }
  if (nums.length < 4) return new BBox(0, 0, 0, 0);
  let minX = nums[0], maxX = nums[0], minY = nums[1], maxY = nums[1];
  for (let i = 0; i < nums.length; i += 2) {
    if (i + 1 >= nums.length) break;
    const px = nums[i], py = nums[i + 1];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return new BBox(minX, minY, Math.max(maxX - minX, 1), Math.max(maxY - minY, 1));
}

function _bboxFromText(el) {
  const children = el.children;
  if (children && children.length > 0) {
    let union = new BBox(Infinity, Infinity, -Infinity, -Infinity);
    let hasChildren = false;
    for (let i = 0; i < children.length; i++) {
      const childBbox = _bboxFromElement(children[i], true);
      if (childBbox.width > 0 || childBbox.height > 0) {
        hasChildren = true;
        const minX = Math.min(union.x, childBbox.x);
        const minY = Math.min(union.y, childBbox.y);
        const maxX = Math.max(union.x + union.width, childBbox.x + childBbox.width);
        const maxY = Math.max(union.y + union.height, childBbox.y + childBbox.height);
        union = new BBox(minX, minY, maxX - minX, maxY - minY);
      }
    }
    if (hasChildren) return union;
  }
  const x = parseFloat(el.getAttribute?.("x") ?? "0");
  const y = parseFloat(el.getAttribute?.("y") ?? "0");
  const text = el.textContent ?? "";
  const approxWidth = Math.max(text.length * 8, 20);
  const approxHeight = 16;
  return new BBox(x, y - approxHeight * 0.8, approxWidth, approxHeight);
}

function _bboxFromForeignObject(el) {
  const x = parseFloat(el.getAttribute?.("x") ?? "0");
  const y = parseFloat(el.getAttribute?.("y") ?? "0");
  const w = parseFloat(el.getAttribute?.("width") ?? "0");
  const h = parseFloat(el.getAttribute?.("height") ?? "0");
  return new BBox(x, y, w, h);
}

function _bboxFromImage(el) {
  const x = parseFloat(el.getAttribute?.("x") ?? "0");
  const y = parseFloat(el.getAttribute?.("y") ?? "0");
  const w = parseFloat(el.getAttribute?.("width") ?? "0");
  const h = parseFloat(el.getAttribute?.("height") ?? "0");
  return new BBox(x, y, w, h);
}

function _bboxFromElement(el, recurse = false) {
  const localName = el.localName ?? "";
  switch (localName) {
    case "rect": return _bboxFromRect(el);
    case "circle": return _bboxFromCircle(el);
    case "ellipse": return _bboxFromEllipse(el);
    case "line": return _bboxFromLine(el);
    case "polygon": case "polyline": return _bboxFromPoly(el);
    case "path": return _bboxFromPath(el);
    case "text": case "tspan": return _bboxFromText(el);
    case "foreignObject": return _bboxFromForeignObject(el);
    case "image": return _bboxFromImage(el);
  }
  if (recurse && el.children) {
    let union = new BBox(Infinity, Infinity, -Infinity, -Infinity);
    let hasChildren = false;
    for (let i = 0; i < el.children.length; i++) {
      const cb = _bboxFromElement(el.children[i], true);
      if (cb.width > 0 || cb.height > 0) {
        hasChildren = true;
        const minX = Math.min(union.x, cb.x);
        const minY = Math.min(union.y, cb.y);
        const maxX = Math.max(union.x + union.width, cb.x + cb.width);
        const maxY = Math.max(union.y + union.height, cb.y + cb.height);
        union = new BBox(minX, minY, maxX - minX, maxY - minY);
      }
    }
    if (hasChildren) return union;
  }
  return new BBox(0, 0, 0, 0);
}

function _svgGetBBox() {
  return _bboxFromElement(this, true);
}

function _svgGetComputedTextLength() {
  const text = this.textContent ?? "";
  return Math.max(text.length * 8, 20);
}

// Apply to jsdom window's SVG element prototypes
const svgProto = window.SVGElement?.prototype;
const svgTextProto = window.SVGTextElement?.prototype;
const svgTSpanProto = window.SVGTSpanElement?.prototype;

console.log("window.SVGElement:", typeof window.SVGElement);
console.log("window.SVGTextElement:", typeof window.SVGTextElement);
console.log("window.SVGTSpanElement:", typeof window.SVGTSpanElement);

if (svgProto && !svgProto.getBBox) {
  svgProto.getBBox = _svgGetBBox;
  console.log("Applied getBBox to SVGElement.prototype");
}
if (svgTextProto && !svgTextProto.getBBox) {
  svgTextProto.getBBox = _svgGetBBox;
  console.log("Applied getBBox to SVGTextElement.prototype");
}
if (svgTSpanProto && !svgTSpanProto.getBBox) {
  svgTSpanProto.getBBox = _svgGetBBox;
  console.log("Applied getBBox to SVGTSpanElement.prototype");
}
if (svgTextProto && !svgTextProto.getComputedTextLength) {
  svgTextProto.getComputedTextLength = _svgGetComputedTextLength;
  console.log("Applied getComputedTextLength to SVGTextElement.prototype");
}
if (svgTSpanProto && !svgTSpanProto.getComputedTextLength) {
  svgTSpanProto.getComputedTextLength = _svgGetComputedTextLength;
  console.log("Applied getComputedTextLength to SVGTSpanElement.prototype");
}

// ── Step 3: Parse the diagram ──────────────────────────────────────────────────

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scriptDir = /data/projects/accordo/packages/diagram/scripts/
// From scripts/ -> diagram/ -> packages/ -> accordo/ (3 up = workspace root)
// Then demo/flowchart-v2/flowchart-34.mmd
const diagramPath = resolve(scriptDir, "../../../demo/flowchart-v2/flowchart-34.mmd");
const diagramSrc = readFileSync(diagramPath, "utf-8").trim();

console.log("\nDiagram source:");
console.log(diagramSrc);
console.log();

const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
console.log("Parsing diagram via parseMermaidToExcalidraw...");
const result = await parseMermaidToExcalidraw(diagramSrc);

const elTypes = result.elements.map(el => el.type);
const elIds = result.elements.map(el => el.id);

console.log("\nResult element types:", elTypes);
console.log("Result element IDs:", elIds);

const hasNonImage = elTypes.some(t => t !== "image");
const hasRect = elTypes.some(t => t === "rectangle");
const hasArrow = elTypes.some(t => t === "arrow");

console.log("\nHas non-image elements:", hasNonImage);
console.log("Has rectangle nodes:", hasRect);
console.log("Has arrow edges:", hasArrow);

if (!hasNonImage) {
  console.error("\nFAILED: Output is image-only fallback. SVG polyfills may not be working.");
  process.exit(1);
} else {
  console.log("\nSUCCESS: Got real node/edge elements from mermaid.");
  process.exit(0);
}
