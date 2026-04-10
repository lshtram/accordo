/**
 * A18 — Comment SDK overlay module.
 *
 * Pure browser code. No Node.js imports. No VSCode extension-host APIs.
 * Bundled by esbuild via webview.ts IIFE entry.
 *
 * Responsibilities:
 *   1. sdk.init() — initialize the Accordo Comment SDK on the Excalidraw canvas.
 *   2. IdMap setup — mermaidId ↔ excalidraw element ID mapping.
 *   3. Alt+click hit-test + custom comment input overlay.
 *   4. comments:load handler — convert CommentThread[] → SdkThread[] + sdk.loadThreads().
 *   5. host:focus-thread handler — sdk.openPopover().
 *   6. Pin re-render on scroll/zoom (via sdk.loadThreads() on appState changes).
 *
 * Source: diag_workplan.md §4.16 (A18-W) / diag_arch_v4.2.md §25
 */

import { AccordoCommentSDK } from "@accordo/comment-sdk";
import type { SdkThread } from "@accordo/comment-sdk";
import { hitsEdgePolyline, edgePolylineMidpoint } from "./comment-overlay-geometry.js";

// showToast is imported lazily (at call time, not import time) to avoid
// triggering the Excalidraw module-load chain in unit tests that import
// this module without a DOM.  excalidraw-canvas.ts sets window.__accordoShowToast
// during bootstrap, so the reference is always valid at runtime.
function getShowToast(): (msg: string) => void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const win = typeof window !== "undefined" ? window : null;
  const fn = win && (win as Window & { __accordoShowToast?: (msg: string) => void }).__accordoShowToast;
  return fn ?? (() => { /* no-op before canvas bootstrap */ });
}
// Re-export geometry helpers so they are accessible via comment-overlay module
export { hitsEdgePolyline, edgePolylineMidpoint };

// ── Module-level state ────────────────────────────────────────────────────────

const sdk = new AccordoCommentSDK();
export { sdk };

/** mermaidId (no prefix) → excalidraw element ID */
let idMap = new Map<string, string>();

/** Full blockId (with "node:"/"edge:"/"cluster:" prefix) → excalidraw element ID */
let reverseMap = new Map<string, string>();

/** Current threads rendered by the SDK. */
let currentSdkThreads: SdkThread[] = [];

// ── A18-W03 — Convert CommentThread[] → SdkThread[] ────────────────────────

type AnyCommentThread = {
  id: string;
  anchor: { kind: string; coordinates?: unknown; [k: string]: unknown };
  status: "open" | "resolved";
  comments: Array<{
    id: string;
    author: { kind: string; name: string };
    body: string;
    createdAt: string;
  }>;
};

function toSdkThreads(threads: AnyCommentThread[]): SdkThread[] {
  return threads
    .filter((t) => {
      if (t.anchor.kind !== "surface") return false;
      const coords = t.anchor.coordinates as Record<string, unknown> | undefined;
      return typeof coords?.["nodeId"] === "string";
    })
    .map((t) => {
      const coords = t.anchor.coordinates as Record<string, string>;
      return {
        id: t.id,
        blockId: coords["nodeId"],
        status: t.status,
        hasUnread: false,
        comments: t.comments.map((c) => {
          const authorKind = c.author.kind === "agent" ? "agent" : "user";
          return {
            id: c.id,
            author: { kind: authorKind, name: c.author.name },
            body: c.body,
            createdAt: c.createdAt,
          };
        }),
      };
    });
}

// ── A18-W01 — Rebuild idMap from host:load-scene elements ───────────────────

function rebuildIdMap(
  elements: Array<{ id: string; customData?: { mermaidId?: string; kind?: string } }>,
): void {
  idMap = new Map();
  reverseMap = new Map();
  for (const el of elements) {
    const mermaidId = el.customData?.mermaidId;
    if (!mermaidId) continue;
    // Skip overlay text/label elements — they are not commentable
    if (mermaidId.endsWith(":text") || mermaidId.endsWith(":label")) continue;
    idMap.set(mermaidId, el.id);
    const kind = el.customData?.kind;
    const prefix =
      kind === "edge" ? "edge" : kind === "cluster" ? "cluster" : mermaidId.includes("->") ? "edge" : "node";
    reverseMap.set(el.id, `${prefix}:${mermaidId}`);
  }
}

// ── A18-W04 — Pin size CSS scaling ───────────────────────────────────────────
// Injects/updates a <style> tag that overrides .accordo-pin dimensions so pins
// scale proportionally with the Excalidraw canvas zoom level.
// Base size: 22 × 22 px at zoom 1.0.

let _pinSizeStyle: HTMLStyleElement | null = null;
let _lastZoom: number = 1;

function _updatePinSizeCss(zoom: number): void {
  if (!_pinSizeStyle) {
    _pinSizeStyle = document.createElement("style");
    _pinSizeStyle.id = "accordo-pin-zoom";
    document.head.appendChild(_pinSizeStyle);
  }
  const sz = Math.round(22 * zoom);
  const fs = Math.round(11 * zoom);
  _pinSizeStyle.textContent = `.accordo-pin{width:${sz}px;height:${sz}px;font-size:${fs}px;}`;
  _lastZoom = zoom;
}

// ── A18-W05 — Custom inline input overlay ────────────────────────────────────

// vscode is accessed via window.__accordoVscode (set by excalidraw-canvas.ts setVscodeApi)



function showCommentInputOverlay(clientX: number, clientY: number, blockId: string): void {
  const win = window as Window & { __accordoVscode?: { postMessage(msg: unknown): void } };
  const vscode = win.__accordoVscode!;
  // Remove any existing overlay first
  document.getElementById("accordo-comment-input")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "accordo-comment-input";
  overlay.style.cssText = [
    "position:fixed",
    `left:${clientX}px`,
    `top:${clientY + 10}px`,
    "z-index:10000",
    "background:var(--vscode-editor-background,#1e1e1e)",
    "border:1px solid var(--vscode-input-border,#3c3c3c)",
    "border-radius:4px",
    "padding:8px",
    "box-shadow:0 2px 8px rgba(0,0,0,0.45)",
    "display:flex",
    "flex-direction:column",
    "gap:6px",
    "min-width:220px",
  ].join(";");

  const textarea = document.createElement("textarea");
  textarea.placeholder = "Add a comment…";
  textarea.rows = 3;
  textarea.style.cssText = [
    "resize:none",
    "width:220px",
    "background:var(--vscode-input-background,#3c3c3c)",
    "color:var(--vscode-input-foreground,#cccccc)",
    "border:1px solid var(--vscode-input-border,#3c3c3c)",
    "border-radius:2px",
    "padding:4px",
    "font-size:12px",
    "font-family:var(--vscode-font-family,system-ui)",
    "outline:none",
    "box-sizing:border-box",
  ].join(";");

  const row = document.createElement("div");
  row.style.cssText = "display:flex;justify-content:flex-end;gap:4px;";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = [
    "background:transparent",
    "color:var(--vscode-button-secondaryForeground,#cccccc)",
    "border:1px solid var(--vscode-button-secondaryBackground,#3c3c3c)",
    "border-radius:2px",
    "padding:3px 10px",
    "cursor:pointer",
    "font-size:12px",
  ].join(";");

  const submitBtn = document.createElement("button");
  submitBtn.textContent = "Comment";
  submitBtn.style.cssText = [
    "background:var(--vscode-button-background,#0e639c)",
    "color:var(--vscode-button-foreground,#fff)",
    "border:none",
    "border-radius:2px",
    "padding:3px 10px",
    "cursor:pointer",
    "font-size:12px",
  ].join(";");

  function dismiss(): void {
    overlay.remove();
    document.removeEventListener("click", outsideClick, true);
  }

  function submit(): void {
    const body = textarea.value.trim();
    if (!body) {
      // Visual shake to tell the user the textarea is empty
      textarea.style.outline = "1px solid var(--vscode-inputValidation-errorBorder,#f48771)";
      textarea.focus();
      return;
    }
    vscode.postMessage({ type: "comment:create", blockId, body });
    dismiss();
    getShowToast()("Comment added");
  }

  cancelBtn.addEventListener("click", (e) => { e.stopPropagation(); dismiss(); });
  submitBtn.addEventListener("click", (e) => { e.stopPropagation(); submit(); });

  // Stop Excalidraw from stealing key/mouse events while the overlay is open.
  for (const evtType of ["keydown", "keyup", "keypress", "mousedown", "mouseup"] as const) {
    overlay.addEventListener(evtType, (e) => e.stopPropagation());
  }

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); dismiss(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.stopPropagation(); submit(); }
  });

  row.appendChild(cancelBtn);
  row.appendChild(submitBtn);
  overlay.appendChild(textarea);
  overlay.appendChild(row);
  document.body.appendChild(overlay);
  textarea.focus();

  // Close on outside click (capture phase so it fires before other handlers)
  function outsideClick(e: Event): void {
    if (!overlay.contains(e.target as Node)) {
      dismiss();
    }
  }
  // Small timeout prevents the same Alt+click that opened the overlay from
  // immediately dismissing it via the outside-click listener.
  setTimeout(() => document.addEventListener("click", outsideClick, true), 50);
}

// ── SDK initialization (called by webview.ts after canvas is mounted) ─────────

// We need the vscode API to post comment messages, but we set it via
// setCommentOverlayVscodeApi from webview.ts bootstrap (before React mounts).
// The SDK init requires the Excalidraw handle + canvas root, which are
// available only after handleExcalidrawApi fires. We use a polling approach
// (via window.__accordoCanvasReady) to detect when the canvas is ready.

let _initPollingActive = false;

function pollForCanvasReady(): void {
  if (_initPollingActive) return;
  _initPollingActive = true;

  const interval = setInterval(() => {
    const win = window as Window & {
      __accordoCanvasReady?: boolean;
      __accordoRepositionPins?: (zoom?: number) => void;
      __accordoHandle?: {
        getSceneElements(): Array<{ id: string; customData?: { mermaidId?: string; kind?: string } }>;
        getAppState(): { scrollX: number; scrollY: number; zoom: { value: number } };
      };
    };

    if (!win.__accordoCanvasReady) return;
    clearInterval(interval);
    _initPollingActive = false;

    const handle = win.__accordoHandle!;
    const canvasRoot = document.getElementById("excalidraw-root");
    if (!canvasRoot) return;

    // Wire showToast from excalidraw-canvas into the window for comment-overlay's use
    // (comment-overlay's getShowToast reads from window.__accordoShowToast at call time).
    // The SDK callbacks post messages via ui.postMessage which already routes to vscode.
    sdk.init({
      container: canvasRoot,
      coordinateToScreen: (blockId: string) => {
        const colonIdx = blockId.indexOf(":");
        if (colonIdx < 0) return null;
        const mermaidId = blockId.slice(colonIdx + 1);
        const excalId = idMap.get(mermaidId);
        if (!excalId) return null;
        const elements = handle.getSceneElements();
        const el = elements.find((e) => e.id === excalId) as {
          x: number; y: number; width: number; height: number;
          points?: ReadonlyArray<readonly [number, number]>;
        } | undefined;
        if (!el) return null;
        const appState = handle.getAppState() as {
          scrollX: number;
          scrollY: number;
          zoom: { value: number };
        };
        const rect = canvasRoot.getBoundingClientRect();
        const z = appState.zoom.value;
        const isEdge = blockId.startsWith("edge:");
        const pinMid = isEdge ? edgePolylineMidpoint(el) : null;
        const pinSceneX = pinMid ? pinMid.x : el.x + el.width;
        const pinSceneY = pinMid ? pinMid.y : el.y;
        const x = (pinSceneX + appState.scrollX) * z + rect.left;
        const y = (pinSceneY + appState.scrollY) * z + rect.top;
        return { x, y };
      },
      callbacks: {
        onCreate() { /* handled by Alt+click overlay */ },
        onReply(threadId, body) {
          const vs = (window as Window & { __accordoVscode?: { postMessage(msg: unknown): void } }).__accordoVscode!;
          vs.postMessage({ type: "comment:reply", threadId, body });
        },
        onResolve(threadId) {
          const vs = (window as Window & { __accordoVscode?: { postMessage(msg: unknown): void } }).__accordoVscode!;
          vs.postMessage({ type: "comment:resolve", threadId });
        },
        onReopen(threadId) {
          const vs = (window as Window & { __accordoVscode?: { postMessage(msg: unknown): void } }).__accordoVscode!;
          vs.postMessage({ type: "comment:reopen", threadId });
        },
        onDelete(threadId, commentId) {
          const vs = (window as Window & { __accordoVscode?: { postMessage(msg: unknown): void } }).__accordoVscode!;
          vs.postMessage({ type: "comment:delete", threadId, commentId });
        },
      },
    });

    // ── A18-W02 / A18-W05 — Alt+click hit-test + custom input overlay ──────
    canvasRoot.addEventListener("click", (rawEvent: Event) => {
      const e = rawEvent as MouseEvent;
      if (!e.altKey) return;
      const elements = handle.getSceneElements() as Array<
        { id: string; customData?: { mermaidId?: string; kind?: string; type?: string }; x: number; y: number; width: number; height: number; points?: ReadonlyArray<readonly [number, number]> }
      >;
      const appState = handle.getAppState() as {
        scrollX: number;
        scrollY: number;
        zoom: { value: number };
      };
      const rect = canvasRoot.getBoundingClientRect();
      const sceneX = (e.clientX - rect.left) / appState.zoom.value - appState.scrollX;
      const sceneY = (e.clientY - rect.top) / appState.zoom.value - appState.scrollY;
      let hitBlockId: string | null = null;
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i]!;
        const mermaidId = el.customData?.mermaidId;
        if (!mermaidId) continue;
        if (mermaidId.endsWith(":text") || mermaidId.endsWith(":label")) continue;
        const isEdge = el.customData?.kind === "edge" || el.customData?.type === "arrow";
        const hit = isEdge
          ? hitsEdgePolyline(sceneX, sceneY, el)
          : sceneX >= el.x && sceneX <= el.x + el.width &&
            sceneY >= el.y && sceneY <= el.y + el.height;
        if (hit) {
          hitBlockId = reverseMap.get(el.id) ?? null;
          if (!hitBlockId) {
            const prefix = mermaidId.includes("->") ? "edge" : "node";
            hitBlockId = `${prefix}:${mermaidId}`;
          }
          break;
        }
      }
      if (!hitBlockId) return;
      e.preventDefault();
      e.stopPropagation();
      showCommentInputOverlay(e.clientX, e.clientY, hitBlockId);
    });

    // ── A18-W04 — Pin re-render on scroll/zoom ─────────────────────────────
    // Excalidraw uses CSS transforms for pan/zoom (not DOM scroll), so
    // PinPositioner's DOM scroll listeners never fire. Instead, excalidraw-canvas.ts
    // calls window.__accordoRepositionPins(zoom) from its handleChange callback
    // when it detects scrollX/scrollY/zoom value changes.
    _updatePinSizeCss(1); // initial default zoom

    // DR-4: Expose repositionPins on window to avoid circular import with excalidraw-canvas
    win.__accordoRepositionPins = repositionPins;
  }, 50);
}

export function initCommentSdk(): void {
  pollForCanvasReady();
}

// ── Message handler helpers for comment messages ──────────────────────────────

/**
 * Handle comments:load message from the host.
 * Called by webview.ts window message listener.
 */
export function handleCommentsLoad(threads: unknown[]): void {
  currentSdkThreads = toSdkThreads(threads as AnyCommentThread[]);
  sdk.loadThreads(currentSdkThreads);
}

/**
 * Handle host:focus-thread message from the host.
 * Called by webview.ts window message listener.
 */
export function handleFocusThread(threadId: string): void {
  sdk.openPopover(threadId);
}

/**
 * Reposition all comment pins — called when the Excalidraw viewport scrolls or zooms.
 * Uses in-place style.left/top updates (via sdk.reposition()) to avoid DOM
 * recreation and visible flicker. Zoom changes also update pin size CSS.
 *
 * @param zoom - Current zoom level (optional). If provided and different from
 *               last recorded zoom, updates pin size CSS before repositioning.
 */
export function repositionPins(zoom?: number): void {
  if (zoom !== undefined && zoom !== _lastZoom) {
    _updatePinSizeCss(zoom);
  }
  sdk.reposition();
}

/**
 * Rebuild idMap when host:load-scene provides new elements.
 * Called by webview.ts window message listener.
 */
export function handleLoadScene(elements: unknown[]): void {
  rebuildIdMap(
    elements as Array<{ id: string; customData?: { mermaidId?: string; kind?: string } }>,
  );
}
