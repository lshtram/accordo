/**
 * runtime-harness.ts — Test utility for executing marp-webview-html output in a Node VM.
 *
 * Provides a fake browser environment (window, document, console, setTimeout) and
 * a harness that wraps the inline script extracted from the generated webview HTML.
 *
 * Alt+click verification pattern:
 *   const runtime = createRuntimeHarness(html);
 *   runtime.simulateAltClick(400, 300);           // fires Alt+click handler
 *   expect(runtime.getActiveSvgDataBlockId()).toMatch(/^slide:\d+:\d+\.\d{4}:\d+\.\d{4}$/);
 *   runtime.flushTimeouts();                      // drains setTimeout(0) → removes attribute
 *   expect(runtime.getActiveSvgDataBlockId()).toBeNull();
 */

import vm from "node:vm";
import type { MarpRenderResult } from "../types.js";

// ── Shared render-result fixture ───────────────────────────────────────────────

export const DEFAULT_RENDER_RESULT: MarpRenderResult = {
  html: "<section id='s0'><h1>Slide One</h1></section><section id='s1'><h1>Slide Two</h1></section>",
  css: "section { display: block; }",
  slideCount: 2,
  comments: ["", ""],
};

export const DEFAULT_NONCE = "test-nonce-123";
export const DEFAULT_CSP_SOURCE = "https://localhost";

// ── Inline script extraction ────────────────────────────────────────────────────

/** Extract the last (inline, nonce-tagged) script body from generated HTML. */
export function extractInlineScript(html: string): string {
  const matches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  const body = matches.at(-1)?.[1];
  if (!body) throw new Error("inline script not found");
  return body;
}

// ── Slide model ────────────────────────────────────────────────────────────────

interface SlideModel {
  classList: {
    _active: boolean;
    add: (name: string) => void;
    remove: (name: string) => void;
  };
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  _blockId: string | null;
  outerHTML: string;
}

function makeSlide(index: number, count: number): SlideModel {
  const isActive = index === 0; // first slide is active by default
  return {
    classList: {
      _active: isActive,
      add(name: string): void {
        if (name === "active") this["_active"] = true;
      },
      remove(name: string): void {
        if (name === "active") this["_active"] = false;
      },
    },
    getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
      return { left: 10, top: 20, width: 800, height: 600 };
    },
    setAttribute(name: string, value: string): void {
      if (name === "data-block-id") this["_blockId"] = value;
    },
    removeAttribute(name: string): void {
      if (name === "data-block-id") this["_blockId"] = null;
    },
    _blockId: null as string | null,
    outerHTML: `<svg data-marpit-svg="" viewBox="0 0 1280 720"><foreignObject width="1280" height="720"><section id="${index + 1}"><h1>Slide ${index + 1}</h1><script>/* marp polyfill */</script></section></foreignObject></svg>`,
  };
}

// ── RuntimeHarness ─────────────────────────────────────────────────────────────

export interface RuntimeHarness {
  dispatchMessage: (msg: Record<string, unknown>) => void;
  getPostMessages: () => Array<Record<string, unknown>>;
  getSlideContainerHtml: () => string;
  getSdkLoadCalls: () => number;
  /** Fire a click event with altKey=true on the slide container handler. */
  simulateAltClick: (clientX: number, clientY: number) => void;
  /** Current value of data-block-id on the active SVG (null when not set). */
  getActiveSvgDataBlockId: () => string | null;
  /** Whether each slide is currently active. */
  getSlideActiveStates: () => boolean[];
  /** Drain pending setTimeout callbacks. */
  flushTimeouts: () => void;
}

export function createRuntimeHarness(html: string): RuntimeHarness {
  const script = extractInlineScript(html);

  type ListenerMap = Record<string, Array<(event: unknown) => void>>;
  const listeners: ListenerMap = {};
  const slideContainerClickListeners: Array<(event: unknown) => void> = [];
  const postMessages: Array<Record<string, unknown>> = [];
  let sdkLoadCalls = 0;
  let slideContainerHtml = "";

  // ── Slide initialization — done once, BEFORE vm.runInContext ─────────────
  // The production code does:
  //   var slides = Array.from(document.querySelectorAll('svg[data-marpit-svg]'));
  // This means the VM captures the EXACT array we return from querySelectorAll.
  // To keep them in sync, we initialize slides ONCE here and do NOT rebuild them.
  const initialContainer = /<div id="slide-container">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  const slideCount = Math.max(0, (initialContainer.match(/data-marpit-svg/g) ?? []).length);
  const slides: SlideModel[] = Array.from({ length: slideCount }, (_, i) => makeSlide(i, slideCount));

  // After buildSlideActivation runs inside the VM, slides[0].classList._active = true.
  // The Alt+click handler's querySelector will find slides[0].
  void initialContainer; // referenced above — silences linter

  // ── makeButton helper ───────────────────────────────────────────────────

  const makeButton = () => ({
    disabled: false,
    addEventListener(type: string, cb: (event: unknown) => void): void {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(cb);
    },
  });

  // ── Slide container stub ─────────────────────────────────────────────────

  const slideContainer = {
    get innerHTML(): string {
      return slideContainerHtml;
    },
    set innerHTML(value: string) {
      slideContainerHtml = value;
      // NOTE: we intentionally do NOT rebuild slides here.
      // The VM captured the slides array at runInContext time.
      // Modifying innerHTML at runtime (e.g. via marp:update) is reflected
      // in slideContainerHtml but the slide objects themselves are stable.
    },
    addEventListener(type: string, cb: (event: unknown) => void): void {
      if (type === "click") {
        slideContainerClickListeners.push(cb);
        return;
      }
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(cb);
    },
  };

  // Initial HTML — seed the container
  slideContainer.innerHTML = initialContainer;

  const counterEl = { textContent: "" };
  const cssTag = { textContent: "" };

  // ── document stub ─────────────────────────────────────────────────────────

  const documentStub = {
    querySelectorAll(selector: string): unknown[] {
      if (selector === "svg[data-marpit-svg]") return slides as unknown[];
      return [];
    },
    querySelector(selector: string): unknown {
      if (selector === "svg[data-marpit-svg].active") {
        return slides.find((s) => s.classList._active) ?? null;
      }
      return null;
    },
    getElementById(id: string): unknown {
      if (id === "slide-container") return slideContainer;
      if (id === "btn-prev") return makeButton();
      if (id === "btn-next") return makeButton();
      if (id === "slide-counter") return counterEl;
      if (id === "marp-core-css") return cssTag;
      return null;
    },
    addEventListener(type: string, cb: (event: unknown) => void): void {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(cb);
    },
    createElement(tag: string): unknown {
      return {};
    },
    body: {},
  };

  // ── SDK instance ──────────────────────────────────────────────────────────

  const sdkInstance = {
    init(): void {},
    loadThreads(): void {
      sdkLoadCalls++;
    },
    openPopover(threadId: unknown): void {
      postMessages.push({ type: "sdk:openPopover", threadId });
    },
  };

  // ── VM context ────────────────────────────────────────────────────────────

  let timeoutId = 0;
  const pendingTimeouts: Array<() => void> = [];

const context: Record<string, unknown> = {
    window: {
      addEventListener(type: string, cb: (event: unknown) => void): void {
        listeners[type] = listeners[type] ?? [];
        listeners[type].push(cb);
      },
      acquireVsCodeApi() {
        return {
          postMessage(msg: Record<string, unknown>) {
            postMessages.push(msg);
          },
        };
      },
      AccordoSDK: {
        AccordoCommentSDK: function (this: Record<string, unknown>) {
          Object.assign(this, sdkInstance);
        },
      },
      scrollTo(): void {},
    },
    document: documentStub,
    console,
    setTimeout: (fn: () => void) => {
      pendingTimeouts.push(fn);
      return ++timeoutId;
    },
    clearTimeout,
    Number,
    Math,
    Array,
    JSON,
    unescape,
    encodeURIComponent,
  };

  vm.createContext(context);
  // runInContext runs the production script synchronously.
  // The script captures `slides` via:
  //   var slides = Array.from(document.querySelectorAll('svg[data-marpit-svg]'));
  // Our documentStub.querySelectorAll returns the harness `slides` array.
  // The VM's local `slides` IS the harness `slides`. Modifications to
  // slides[i].classList._active (via classList.add('active')) ARE visible
  // to the harness because they share the same object reference.
  vm.runInContext(script, context);

  return {
    dispatchMessage(msg: Record<string, unknown>): void {
      for (const handler of listeners["message"] ?? []) {
        handler({ data: msg });
      }
    },
    getPostMessages(): Array<Record<string, unknown>> {
      return postMessages;
    },
    getSlideContainerHtml(): string {
      return slideContainer.innerHTML;
    },
    getSdkLoadCalls(): number {
      return sdkLoadCalls;
    },
    simulateAltClick(clientX: number, clientY: number): void {
      for (const handler of slideContainerClickListeners) {
        handler({ altKey: true, clientX, clientY });
      }
    },
    getActiveSvgDataBlockId(): string | null {
      const active = slides.find((s) => s.classList._active);
      return active ? (active["_blockId"] as string | null) : null;
    },
    getSlideActiveStates(): boolean[] {
      return slides.map((s) => s.classList._active);
    },
    flushTimeouts(): void {
      for (const fn of pendingTimeouts) {
        fn();
      }
      pendingTimeouts.length = 0;
    },
  };
}
