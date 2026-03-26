/**
 * DOM setup for browser package tests.
 *
 * Creates a stable JSDOM fixture and mocks getBoundingClientRect so that
 * page-understanding handler tests can exercise size/position logic without
 * a real browser layout engine.
 *
 * Element → rect mapping (used by capture_region tests):
 *   #tiny-element      5×5 in-viewport  → no-target (too small)
 *   #small-but-valid  10×10 in-viewport  → success at boundary
 *   #large-img       600×400 in-viewport  → large image
 *   #below-fold        0×0 off-screen (top=5000)  → element-off-screen
 *   #some-element      0×0 (no layout)   → capture-failed
 *   #screenshot-target 200×150 in-viewport → success
 *   #btn               80×30 in-viewport  → success
 */

import { beforeEach, vi } from "vitest";

const RECT_MAP: Record<string, DOMRect> = {};

function makeRect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x, y, width: w, height: h,
    top: y, right: x + w, bottom: y + h, left: x,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  document.title = "Test Page";

  document.body.innerHTML = `
    <button id="submit-btn">Submit</button>
    <div data-testid="login-btn">Login</div>
    <div data-testid="login-form">Form</div>
    <div id="main">Main content</div>
    <div>plain no stable id</div>
    <div id="content">
      <div class="dynamic-class-xyz">Dynamic</div>
    </div>
    <div>plain1</div>
    <div>plain2</div>
    <div id="small-but-valid">small valid</div>
    <div id="below-fold">below fold content</div>
    <div id="some-element">some element</div>
    <div id="large-img">large image</div>
    <div id="screenshot-target">screenshot target</div>
    <div id="btn">button element</div>
    <div id="tiny-element">tiny</div>
    <div id="123">element ref-123</div>
  `;

  // Map element ids to their bounding rects
  Object.assign(RECT_MAP, {
    "submit-btn":       makeRect(10, 10, 120, 40),
    "main":             makeRect(10, 60, 800, 200),
    "content":          makeRect(10, 270, 800, 100),
    "small-but-valid":  makeRect(10, 380, 10, 10),
    "below-fold":       makeRect(10, 5000, 400, 40),   // off-screen (top >> viewport)
    "large-img":        makeRect(10, 430, 600, 400),
    "screenshot-target": makeRect(10, 440, 200, 150),
    "btn":              makeRect(10, 450, 80, 30),
    "tiny-element":     makeRect(10, 460, 5, 5),       // too small
    // some-element: zero rect → capture-failed
    "some-element":     makeRect(0, 0, 0, 0),
  });

  // Patch getBoundingClientRect globally
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const id = this.id;
    if (id && RECT_MAP[id]) return RECT_MAP[id];
    // Default: small in-viewport rect
    return makeRect(0, 0, 100, 40);
  });
});
