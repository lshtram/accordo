/**
 * A16 — Webview entry point: Excalidraw canvas + host messaging.
 *
 * Runs entirely in the VS Code webview browser context. Bundled by esbuild into
 * dist/webview/webview.bundle.js (see package.json build:webview script).
 *
 * Responsibilities:
 *   1. Mount the Excalidraw React component into #excalidraw-root.
 *   2. Wire onChange → detectNodeMutations → vscode.postMessage for layout
 *      mutations (canvas:node-moved / canvas:node-resized).
 *   3. Wire window.addEventListener("message") → applyHostMessage to handle
 *      host:load-scene / host:request-export / host:toast / host:error-overlay.
 *   4. Provide ExcalidrawExportFns by wrapping the standalone Excalidraw export
 *      utilities (exportToSvg, exportToBlob) around the imperative API state.
 *   5. A18 — Comment SDK integration: sdk.init(), IdMap, Alt+click + overlay,
 *      comments:load handler, pin re-render on scroll/zoom.
 *
 * No Node.js imports. No VSCode extension-host APIs. Browser globals only.
 *
 * Source: diag_arch_v4.2.md §9.4 §25 / diag_workplan.md §4.16 (A18-W)
 */

import React, { useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Excalidraw,
  exportToSvg,
  exportToBlob,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, AppState } from "@excalidraw/excalidraw/types/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";

import { AccordoCommentSDK } from "@accordo/comment-sdk";
import type { SdkThread } from "@accordo/comment-sdk";

import { applyHostMessage, detectNodeMutations } from "./message-handler.js";
import type {
  ExcalidrawHandle,
  WebviewUI,
  ExcalidrawExportFns,
  NodeMutation,
} from "./message-handler.js";
import type { HostToWebviewMessage, WebviewToHostMessage } from "./protocol.js";
import type { ExcalidrawAPIElement } from "./scene-adapter.js";

// ── VS Code webview acquireVsCodeApi ─────────────────────────────────────────

// The VS Code runtime injects acquireVsCodeApi into the webview global scope.
// Declared here so TypeScript doesn't complain; the function exists at runtime.
// acquireVsCodeApi() may only be called ONCE per webview context (VS Code throws
// on second call). The inline diagnostic script in html.ts does NOT call it —
// this is the sole call site.
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
};

const vscode = acquireVsCodeApi();

// Flush any JS errors that were buffered by the inline diagnostic script
// (html.ts) before the bundle executed. This makes pre-bundle startup errors
// visible in the Accordo Diagram output channel without opening DevTools.
{
  const win = window as Window & { __accordoErrors?: string[] };
  if (Array.isArray(win.__accordoErrors)) {
    for (const msg of win.__accordoErrors) {
      vscode.postMessage({ type: "canvas:js-error", message: msg });
    }
    win.__accordoErrors = [];
  }
}

// ── A18 — Comment SDK module-level state ────────────────────────────────────
//
// idMap: mermaidId (without prefix) → Excalidraw element ID.
// Rebuilt from customData on every host:load-scene so coordinateToScreen
// always resolves against the latest Excalidraw element set.
//
// currentSdkThreads: last set of threads posted via comments:load.
// Stored so we can call sdk.loadThreads() again on scroll/zoom to reposition pins.
//
// prevScrollState: tracks last known viewport state to debounce pin re-renders.

const sdk = new AccordoCommentSDK();

// Profiling: record script-evaluation time so we can report bundle load + React
// mount latency via canvas:timing messages (visible in "Accordo Diagram" output).
const _webviewT0 = performance.now();

/** mermaidId (no prefix) → excalidraw element ID */
let idMap = new Map<string, string>();

/** Full blockId (with "node:"/"edge:"/"cluster:" prefix) → excalidraw element ID */
let reverseMap = new Map<string, string>();

/** Current threads rendered by the SDK. */
let currentSdkThreads: SdkThread[] = [];

/** Last known scroll/zoom state for change detection. */
let prevScrollX = 0;
let prevScrollY = 0;
let prevZoom = 1;

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

function _updatePinSizeCss(zoom: number): void {
  if (!_pinSizeStyle) {
    _pinSizeStyle = document.createElement("style");
    _pinSizeStyle.id = "accordo-pin-zoom";
    document.head.appendChild(_pinSizeStyle);
  }
  const sz = Math.round(22 * zoom);
  const fs = Math.round(11 * zoom);
  _pinSizeStyle.textContent = `.accordo-pin{width:${sz}px;height:${sz}px;font-size:${fs}px;}`;
}

// ── A18-W05 — Custom inline input overlay ───────────────────────────────────

function showCommentInputOverlay(clientX: number, clientY: number, blockId: string): void {
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
    showToast("Comment added");
  }

  cancelBtn.addEventListener("click", (e) => { e.stopPropagation(); dismiss(); });
  submitBtn.addEventListener("click", (e) => { e.stopPropagation(); submit(); });

  // ── Stop Excalidraw from stealing key/mouse events while the overlay is open.
  // Excalidraw registers global window-level keydown/mousedown listeners for
  // shortcuts (e.g. 'D', 'A', Delete). Without stopPropagation the user's
  // keystrokes go to Excalidraw, leaving the textarea empty → submit() returns
  // silently. Stopping all events ON the overlay prevents bubbling to window.
  // click is intentionally NOT in this list — the outsideClick document-capture
  // handler (registered below) relies on click events reaching the document
  // capture phase so it can inspect e.target. Stopping click here would break
  // outside-click detection. keydown/mousedown prevention is sufficient to
  // stop Excalidraw from stealing input.
  for (const evtType of ["keydown", "keyup", "keypress", "mousedown", "mouseup"] as const) {
    overlay.addEventListener(evtType, (e) => e.stopPropagation());
  }

  textarea.addEventListener("keydown", (e) => {
    // stopPropagation already handled by the overlay listener above, but
    // keep explicit handler here for Escape / Ctrl+Enter semantics.
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

// ── Toast overlay ─────────────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
  let el = document.getElementById("accordo-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "accordo-toast";
    Object.assign(el.style, {
      position: "fixed",
      bottom: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(0,0,0,0.75)",
      color: "#fff",
      padding: "8px 16px",
      borderRadius: "4px",
      fontSize: "13px",
      zIndex: "9999",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 0.2s",
    });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.opacity = "1";
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (el) el.style.opacity = "0";
  }, 3000);
}

// ── Error overlay ─────────────────────────────────────────────────────────────

function showErrorOverlay(message: string): void {
  let el = document.getElementById("accordo-error-overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "accordo-error-overlay";
    Object.assign(el.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      background: "rgba(200, 50, 50, 0.92)",
      color: "#fff",
      padding: "12px 16px",
      fontSize: "13px",
      zIndex: "9998",
      whiteSpace: "pre-wrap",
      fontFamily: "monospace",
    });
    document.body.appendChild(el);
  }
  el.textContent = `Parse error: ${message}`;
  el.style.display = "block";
}

function clearErrorOverlay(): void {
  const el = document.getElementById("accordo-error-overlay");
  if (el) el.style.display = "none";
}

// ── Virgil font injection ────────────────────────────────────────────────────

// Load the Virgil hand-drawn font via the FontFace API so we get a promise for
// when loading completes. We wait for this before applying host:load-scene so
// that restoreElements({refreshDimensions}) measures text with the correct font
// and Canvas 2D renders Virgil from the first frame.
//
// On fast reopens the old CSS-only @font-face approach lost the race: the scene
// was rendered before the font finished downloading, locking in system-font
// metrics and appearance.
let _fontReady: Promise<void> = Promise.resolve();
{
  const win = window as Window & { __virgilFontUri?: string };
  if (win.__virgilFontUri) {
    const uri = win.__virgilFontUri;
    try {
      const face = new FontFace("Virgil", `url("${uri}")`, { display: "block" });
      _fontReady = Promise.race([
        face.load().then(() => { document.fonts.add(face); }),
        // Safety timeout — don't block the canvas forever if font fails to load
        new Promise<void>(resolve => setTimeout(resolve, 3000)),
      ]).catch(() => { /* proceed with fallback font */ });
    } catch {
      // FontFace API unavailable — fall back to CSS injection
      const style = document.createElement("style");
      style.textContent = `@font-face{font-family:"Virgil";src:url("${uri}") format("woff2");font-display:block;}`;
      document.head.appendChild(style);
    }
  }
}

// ── ExcalidrawApp ─────────────────────────────────────────────────────────────

// Snapshots the previous element list for mutation detection on each onChange.
let prevElements: ReadonlyArray<ExcalidrawAPIElement> = [];

function ExcalidrawApp() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  const handleExcalidrawApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;

      // Build the ExcalidrawHandle required by applyHostMessage / detectNodeMutations
      const handle: ExcalidrawHandle = {
        updateScene(opts) {
          // restoreElements fills any missing required fields and, with
          // refreshDimensions:true, uses the DOM to measure text widths so that
          // bound label elements render immediately (without needing a
          // double-click) and arrows snap their tips to element boundaries.
          const restored = restoreElements(
            opts.elements as unknown as Parameters<typeof restoreElements>[0],
            null,
            { refreshDimensions: true },
          );
          api.updateScene({
            elements: restored,
            ...(opts.appState ? { appState: opts.appState } : {}),
          } as unknown as Parameters<typeof api.updateScene>[0]);
          // Snapshot with value copies: if Excalidraw mutates element objects in place
          // during drag, prevElements[i].x would otherwise equal next[i].x (same ref).
          prevElements = (restored as unknown as ExcalidrawAPIElement[]).map(el => ({ ...el })) as unknown as readonly ExcalidrawAPIElement[];
        },
        getSceneElements() {
          // Cast is safe: we only interact with elements we produced via
          // toExcalidrawPayload(), which guarantees the ExcalidrawAPIElement shape.
          return api.getSceneElements() as unknown as readonly ExcalidrawAPIElement[];
        },
        getAppState() {
          return api.getAppState() as unknown as Record<string, unknown>;
        },
      };

      // Build the ExcalidrawExportFns required by applyHostMessage
      const exportFns: ExcalidrawExportFns = {
        async exportToSvg(elements, appState) {
          const svgEl = await exportToSvg({
            elements: elements as unknown as readonly ExcalidrawElement[],
            appState: appState as Partial<AppState>,
            files: null,
          });
          return new XMLSerializer().serializeToString(svgEl);
        },
        async exportToBlob(elements, appState) {
          const blob = await exportToBlob({
            elements: elements as unknown as readonly ExcalidrawElement[],
            appState: appState as Partial<AppState>,
            files: null,
          });
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        },
      };

      // Build the WebviewUI required by applyHostMessage
      const ui: WebviewUI = {
        postMessage: (msg) => vscode.postMessage(msg),
        showToast,
        showErrorOverlay,
        clearErrorOverlay,
      };

      // ── A18-W01 — Initialize Comment SDK ────────────────────────────────────
      // The SDK renders comment pins over the Excalidraw canvas using an
      // absolutely-positioned overlay layer. coordinateToScreen converts scene
      // coordinates to viewport pixels using live Excalidraw state.
      const canvasRoot = document.getElementById("excalidraw-root");
      if (canvasRoot) {
        sdk.init({
          container: canvasRoot,
          coordinateToScreen: (blockId: string) => {
            // Strip "node:" / "edge:" / "cluster:" prefix → bare mermaid ID
            const colonIdx = blockId.indexOf(":");
            if (colonIdx < 0) return null;
            const mermaidId = blockId.slice(colonIdx + 1);
            const excalId = idMap.get(mermaidId);
            if (!excalId) return null;
            const elements = handle.getSceneElements();
            const el = elements.find((e) => e.id === excalId);
            if (!el) return null;
            const appState = handle.getAppState() as {
              scrollX: number;
              scrollY: number;
              zoom: { value: number };
            };
            const rect = canvasRoot.getBoundingClientRect();
            const z = appState.zoom.value;
            // Edge pins → visual centre of bounding box (edges have irregular bboxes;
            // top-right corner is often far from the visual arrow).
            // Node / cluster pins → top-right corner (conventional pin placement).
            const isEdge = blockId.startsWith("edge:");
            const pinSceneX = isEdge ? el.x + el.width / 2 : el.x + el.width;
            const pinSceneY = isEdge ? el.y + el.height / 2 : el.y;
            const x = (pinSceneX + appState.scrollX) * z + rect.left;
            const y = (pinSceneY + appState.scrollY) * z + rect.top;
            return { x, y };
          },
          callbacks: {
            // onCreate is intentionally a no-op — diagram webview uses the
            // custom Alt+click overlay (A18-R09b), not the SDK's built-in flow.
            onCreate() { /* handled by Alt+click overlay */ },
            onReply(threadId, body) {
              vscode.postMessage({ type: "comment:reply", threadId, body });
            },
            onResolve(threadId) {
              vscode.postMessage({ type: "comment:resolve", threadId });
            },
            onReopen(threadId) {
              vscode.postMessage({ type: "comment:reopen", threadId });
            },
            onDelete(threadId, commentId) {
              vscode.postMessage({ type: "comment:delete", threadId, commentId });
            },
          },
        });

        // ── A18-W02 / A18-W05 — Alt+click hit-test + custom input overlay ────
        canvasRoot.addEventListener("click", (rawEvent: Event) => {
          const e = rawEvent as MouseEvent;
          if (!e.altKey) return;
          const elements = handle.getSceneElements() as Array<
            ExcalidrawAPIElement & { customData: { mermaidId: string; kind?: string } }
          >;
          const appState = handle.getAppState() as {
            scrollX: number;
            scrollY: number;
            zoom: { value: number };
          };
          const rect = canvasRoot.getBoundingClientRect();
          // Convert click position to scene coordinates
          const sceneX = (e.clientX - rect.left) / appState.zoom.value - appState.scrollX;
          const sceneY = (e.clientY - rect.top) / appState.zoom.value - appState.scrollY;
          // Hit-test in reverse z-order (topmost element first)
          let hitBlockId: string | null = null;
          for (let i = elements.length - 1; i >= 0; i--) {
            const el = elements[i]!;
            const mermaidId = el.customData?.mermaidId;
            if (!mermaidId) continue;
            // Skip label/text overlay elements (not commentable)
            if (mermaidId.endsWith(":text") || mermaidId.endsWith(":label")) continue;
            if (
              sceneX >= el.x &&
              sceneX <= el.x + el.width &&
              sceneY >= el.y &&
              sceneY <= el.y + el.height
            ) {
              // Use reverseMap (built from kind field) for accurate prefix
              hitBlockId = reverseMap.get(el.id) ?? null;
              if (!hitBlockId) {
                // Fallback: infer prefix from mermaidId format
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
      }

      // Wire host → webview messages.
      // host:load-scene waits for Virgil font readiness so text renders with the
      // hand-drawn font from the first frame (avoids timing race on fast reopens).
      window.addEventListener("message", (event: MessageEvent) => {
        const msg = event.data as HostToWebviewMessage;
        if (msg.type === "host:load-scene") {
          // A18-W01 — Rebuild idMap from incoming elements before applying scene
          rebuildIdMap(
            msg.elements as Array<{
              id: string;
              customData?: { mermaidId?: string; kind?: string };
            }>,
          );
          const fontWaitStart = performance.now();
          void _fontReady.then(() => {
            const fontWaitMs = Math.round(performance.now() - fontWaitStart);
            if (fontWaitMs > 2) {
              vscode.postMessage({ type: "canvas:timing", label: "font-wait-before-scene", ms: fontWaitMs });
            }
            applyHostMessage(msg, handle, ui, exportFns);
          });
        } else if (msg.type === "comments:load") {
          // A18-W03 — Convert CommentThread[] → SdkThread[] and update pins
          currentSdkThreads = toSdkThreads(
            msg.threads as unknown as AnyCommentThread[],
          );
          sdk.loadThreads(currentSdkThreads);
        } else if (msg.type === "host:focus-thread") {
          // A18 — Comments panel navigated to a diagram thread: reveal panel
          // is handled by the host; we just open the SDK popover here.
          sdk.openPopover(msg.threadId);
        } else {
          void applyHostMessage(msg, handle, ui, exportFns);
        }
      });

      // Signal to the host that the webview is ready to receive scenes
      vscode.postMessage({ type: "canvas:timing", label: "script-to-excalidraw-ready", ms: Math.round(performance.now() - _webviewT0) });
      vscode.postMessage({ type: "canvas:ready" });
    },
    [],
  );

  const handleChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appStateRaw: Record<string, unknown>,
    ) => {
      // Cast is safe for the same reason as getSceneElements above.
      const next = elements as unknown as readonly ExcalidrawAPIElement[];
      const mutations: NodeMutation[] = detectNodeMutations(
        prevElements as ExcalidrawAPIElement[],
        next as ExcalidrawAPIElement[],
      );
      // Snapshot with value copies (same reason as in handle.updateScene above).
      prevElements = (next as ExcalidrawAPIElement[]).map(el => ({ ...el })) as unknown as readonly ExcalidrawAPIElement[];

      for (const mutation of mutations) {
        if (mutation.type === "moved") {
          // x and y are always set for "moved" mutations (detectNodeMutations contract)
          vscode.postMessage({
            type: "canvas:node-moved",
            nodeId: mutation.nodeId,
            x: mutation.x ?? 0,
            y: mutation.y ?? 0,
          } satisfies WebviewToHostMessage);
        } else if (mutation.type === "resized") {
          // w and h are always set for "resized" mutations (detectNodeMutations contract)
          vscode.postMessage({
            type: "canvas:node-resized",
            nodeId: mutation.nodeId,
            w: mutation.w ?? 0,
            h: mutation.h ?? 0,
          } satisfies WebviewToHostMessage);
        } else if (mutation.type === "styled") {
          vscode.postMessage({
            type: "canvas:node-styled",
            nodeId: mutation.nodeId,
            style: mutation.style ?? {},
          } satisfies WebviewToHostMessage);
        }
      }

      // A18-W04 — Re-render comment pins when scroll or zoom changes so pins
      // follow their anchored elements after canvas pan or zoom gestures.
      {
        const as = appStateRaw as { scrollX?: number; scrollY?: number; zoom?: { value?: number } };
        const sX = as.scrollX ?? 0;
        const sY = as.scrollY ?? 0;
        const z = as.zoom?.value ?? 1;
        if (sX !== prevScrollX || sY !== prevScrollY || z !== prevZoom) {
          prevScrollX = sX;
          prevScrollY = sY;
          prevZoom = z;
          // Scale pin size proportionally to zoom so pins appear the same
          // physical size relative to canvas elements at every zoom level.
          _updatePinSizeCss(z);
          if (currentSdkThreads.length > 0) {
            sdk.loadThreads(currentSdkThreads);
          }
        }
      }
    },
    [],
  );

  // Backup mutation detector: fires on every pointer event.
  // When the pointer button is released (button="up"), we diff the live scene
  // against prevElements. This catches all drag/resize mutations regardless of
  // whether Excalidraw's onChange prop fired during the interaction.
  const handlePointerUpdate = useCallback(
    (payload: { button: string; [key: string]: unknown }) => {
      if (payload.button !== "up" || !apiRef.current) return;
      const current = apiRef.current.getSceneElements() as unknown as ExcalidrawAPIElement[];
      const missed = detectNodeMutations(
        prevElements as ExcalidrawAPIElement[],
        current,
      );
      if (missed.length > 0) {
        prevElements = current.map(el => ({ ...el })) as unknown as readonly ExcalidrawAPIElement[];
        for (const mutation of missed) {
          if (mutation.type === "moved") {
            vscode.postMessage({ type: "canvas:node-moved", nodeId: mutation.nodeId, x: mutation.x ?? 0, y: mutation.y ?? 0 } satisfies WebviewToHostMessage);
          } else if (mutation.type === "resized") {
            vscode.postMessage({ type: "canvas:node-resized", nodeId: mutation.nodeId, w: mutation.w ?? 0, h: mutation.h ?? 0 } satisfies WebviewToHostMessage);
          } else if (mutation.type === "styled") {
            vscode.postMessage({ type: "canvas:node-styled", nodeId: mutation.nodeId, style: mutation.style ?? {} } satisfies WebviewToHostMessage);
          }
        }
      }
    },
    [],
  );

  return React.createElement(Excalidraw, {
    excalidrawAPI: handleExcalidrawApi,
    onChange: handleChange,
    onPointerUpdate: handlePointerUpdate as never,
    initialData: { elements: [], appState: {} },
    // UIOptions: hide the hamburger menu items that make no sense in this context
    UIOptions: {
      canvasActions: {
        export: false,
        loadScene: false,
        saveToActiveFile: false,
        saveAsImage: false,
      },
    },
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const rootEl = document.getElementById("excalidraw-root");
if (!rootEl) {
  throw new Error("Accordo diagram webview: #excalidraw-root element not found");
}

const root = createRoot(rootEl);
root.render(React.createElement(ExcalidrawApp));
