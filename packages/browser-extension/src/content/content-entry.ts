/**
 * Content script entry point — wires comment-ui and message-handlers.
 * This file is the esbuild entry for dist/content-script.js.
 *
 * IMPORTANT: This file is built as an IIFE (format: "iife"), NOT an ES module.
 * Chrome injects content scripts as classic scripts. Any top-level `export`
 * statement causes a SyntaxError. Do NOT add `export` statements here.
 */

import { dbg, showFloatingBar, hideFloatingBar, isCommentsModeActive } from "./comment-ui.js";
import { runBootstrap } from "./message-handlers.js";
import { ensureShadowTrackingInstalled } from "./shadow-root-tracker.js";

dbg(`Content script injected on ${window.location.href}`);
ensureShadowTrackingInstalled();

// ── Keyboard shortcuts ───────────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    dbg("Escape: dismissing form/popover");
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────────

runBootstrap();
