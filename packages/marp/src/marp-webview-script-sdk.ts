/**
 * marp-webview-script-sdk.ts — SDK-specific message handler builders
 *
 * Handles comments:load / comments:add / comments:update / comments:remove /
 * comments:focus (navigate + sdk.openPopover) and Alt+click block-id injection.
 * Also re-exports buildSdkHeadAssets from sdk-init.ts.
 *
 * Source: requirements-marp.md §4 M50-PVD
 */

// Re-export for backwards compatibility — marp-webview-html.ts imports buildSdkHeadAssets from here.
export { buildSdkHeadAssets } from "./marp-webview-script-sdk-init.js";

// Re-export for backwards compatibility — marp-webview-html.ts imports buildSdkInitScript from here.
export { buildSdkInitScript } from "./marp-webview-script-sdk-init.js";

/** SDK variable names — must match sdk-init.ts for correct cross-segment assembly. */
const SDK_VAR = "sdk";
const THREADS_VAR = "allThreads";
const REFRESH_FN = "refreshPins";

// ── Individual comment message handlers ──────────────────────────────────────

/** Build the comments:load handler. */
function handleCommentsLoad(): string {
  return `
        case 'comments:load':
          ${THREADS_VAR} = msg.threads || [];
          ${REFRESH_FN}();
          break;`;
}

/** Build the comments:add handler. */
function handleCommentsAdd(): string {
  return `
        case 'comments:add':
          if (msg.thread) { ${THREADS_VAR} = ${THREADS_VAR}.concat(msg.thread); ${REFRESH_FN}(); }
          break;`;
}

/** Build the comments:update handler. */
function handleCommentsUpdate(): string {
  return `
        case 'comments:update':
          if (msg.thread && msg.thread.id) {
            ${THREADS_VAR} = ${THREADS_VAR}.map(function(t) { return t.id === msg.thread.id ? msg.thread : t; });
            ${REFRESH_FN}();
          }
          break;`;
}

/** Build the comments:remove handler. */
function handleCommentsRemove(): string {
  return `
        case 'comments:remove':
          if (msg.threadId) { ${THREADS_VAR} = ${THREADS_VAR}.filter(function(t) { return t.id !== msg.threadId; }); ${REFRESH_FN}(); }
          break;`;
}

/**
 * Build the comments:focus handler.
 * Navigates to the slide in blockId then calls sdk.openPopover(threadId).
 */
function handleCommentsFocus(): string {
  return `
        case 'comments:focus':
          try {
            var threadId = msg.threadId;
            var blockId = msg.blockId || '';
            var parts = blockId.split(':');
            var targetSlide = current;
            if (parts.length >= 2 && parts[0] === 'slide') { targetSlide = parseInt(parts[1], 10); }
            if (!Number.isFinite(targetSlide) || targetSlide < 0 || targetSlide >= slides.length) { break; }
            if (targetSlide !== current) { goTo(targetSlide); }
            if (${SDK_VAR}.openPopover) ${SDK_VAR}.openPopover(threadId);
          } catch (e) {}
          break;`;
}

/**
 * Build the window 'message' event listener fragment that handles
 * comments:load / comments:add / comments:update / comments:remove / comments:focus.
 */
export function buildSdkMessageHandlers(hasSdk: boolean): string {
  if (!hasSdk) return "";
  return `
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        ${handleCommentsLoad()}
        ${handleCommentsAdd()}
        ${handleCommentsUpdate()}
        ${handleCommentsRemove()}
        ${handleCommentsFocus()}
      }
    });`;
}

// ── Alt+click handler ─────────────────────────────────────────────────────────

/**
 * Build the Alt+click handler on the slide container.
 * Sets data-block-id on the active SVG so the SDK's own Alt+click handler
 * can discover it via closest("[data-block-id]").
 */
export function buildAltClickHandler(hasSdk: boolean): string {
  if (!hasSdk) return "";
  return `
    // Alt+click on the slide container: compute spatial blockId and temporarily
    // expose it via data-block-id on the active SVG so the SDK's own
    // Alt+click handler (M41-SDK-07) can find it via closest("[data-block-id]").
    //
    // Why the active SVG and not a transient sibling?
    //   e.target.closest("[data-block-id]") traverses ANCESTORS only.
    //   A span appended to document.body is a sibling of the click target's
    //   ancestors, never an ancestor itself — so closest(...) never finds it.
    //   The active SVG is a true DOM ancestor of any element inside the slide,
    //   so setting data-block-id on it makes closest(...) succeed.
    document.getElementById('slide-container').addEventListener('click', function(e) {
      if (!e.altKey) return;
      var activeSvg = document.querySelector('svg[data-marpit-svg].active');
      if (!activeSvg) return;
      var rect = activeSvg.getBoundingClientRect();
      var relX = (e.clientX - rect.left) / rect.width;
      var relY = (e.clientY - rect.top) / rect.height;
      var blockId = 'slide:' + current + ':' + relX.toFixed(4) + ':' + relY.toFixed(4);
      activeSvg.setAttribute('data-block-id', blockId);
      setTimeout(function() { activeSvg.removeAttribute('data-block-id'); }, 0);
    });`;
}
