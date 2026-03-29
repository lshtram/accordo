/**
 * A16 — Webview entry point: wires Excalidraw canvas + comment overlay + messaging.
 *
 * Runs entirely in the VS Code webview browser context. Bundled by esbuild into
 * dist/webview/webview.bundle.js (see package.json build:webview script).
 *
 * Responsibilities:
 *   1. Bootstrap vscode API and error flushing.
 *   2. Initialise the Excalidraw canvas via excalidraw-canvas.ts.
 *   3. Initialise the comment SDK overlay via comment-overlay.ts.
 *   4. Wire window.addEventListener("message") → applyHostMessage for
 *      host:load-scene / host:request-export / host:toast / host:error-overlay,
 *      plus comment:load and host:focus-thread handlers.
 *
 * NO export statements — IIFE entry only.
 *
 * Source: diag_arch_v4.2.md §9.4 §25 / diag_workplan.md §4.16 (A18-W)
 */

import React from "react";
import { createRoot } from "react-dom/client";

import { setVscodeApi, setWebviewT0, ExcalidrawApp } from "./excalidraw-canvas.js";
import { initCommentSdk, handleCommentsLoad, handleFocusThread, handleLoadScene } from "./comment-overlay.js";
import { applyHostMessage } from "./message-handler.js";
import type { ExcalidrawHandle, WebviewUI, ExcalidrawExportFns } from "./message-handler.js";
import type { HostToWebviewMessage } from "./protocol.js";

// ── VS Code webview acquireVsCodeApi ─────────────────────────────────────────

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

// ── Bootstrap ─────────────────────────────────────────────────────────────────

// Timing reference for the canvas-ready message
setWebviewT0(performance.now());

// Pass vscode API into excalidraw-canvas so it can post messages
setVscodeApi(vscode);

// Start polling for canvas readiness (comment SDK needs the Excalidraw handle)
initCommentSdk();

// ── Message listener ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWindow = Window & Record<string, any>;
const win: AnyWindow = window;

win.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as HostToWebviewMessage;

  if (msg.type === "host:load-scene") {
    // A18-W01 — Rebuild idMap from incoming elements before applying scene
    handleLoadScene(msg.elements as unknown[]);

    // Apply the scene via the Excalidraw imperative handle
    const handle = (win.__accordoHandle as ExcalidrawHandle | undefined);
    const ui = (win.__accordoUI as WebviewUI | undefined);
    const exportFns = (win.__accordoExportFns as ExcalidrawExportFns | undefined);
    if (handle && ui && exportFns) {
      void applyHostMessage(msg, handle, ui, exportFns);
    }
  } else if (msg.type === "comments:load") {
    // A18-W03 — Convert CommentThread[] → SdkThread[] and update pins
    handleCommentsLoad(msg.threads as unknown[]);
  } else if (msg.type === "host:focus-thread") {
    // A18 — Comments panel navigated to a diagram thread: open SDK popover
    handleFocusThread(msg.threadId);
  } else {
    // host:request-export / host:toast / host:error-overlay
    const handle = (win.__accordoHandle as ExcalidrawHandle | undefined);
    const ui = (win.__accordoUI as WebviewUI | undefined);
    const exportFns = (win.__accordoExportFns as ExcalidrawExportFns | undefined);
    if (handle && ui && exportFns) {
      void applyHostMessage(msg, handle, ui, exportFns);
    }
  }
});

// ── Mount React app ────────────────────────────────────────────────────────────

const rootEl = document.getElementById("excalidraw-root");
if (!rootEl) {
  throw new Error("Accordo diagram webview: #excalidraw-root element not found");
}

const root = createRoot(rootEl);
root.render(React.createElement(ExcalidrawApp));
