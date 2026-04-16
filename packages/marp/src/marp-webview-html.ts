/**
 * marp-webview-html.ts — Marp Webview HTML Builder
 *
 * Source: requirements-marp.md §4 M50-PVD
 */

import type { MarpRenderResult } from "./types.js";

export interface MarpWebviewHtmlOptions {
  renderResult: MarpRenderResult;
  nonce: string;
  cspSource: string;
  /** When provided, Comment SDK is initialized in the webview */
  sdkJsUri?: string;
  /** When provided, Comment SDK CSS is loaded in the webview */
  sdkCssUri?: string;
}

/**
 * Builds the Marp webview HTML document.
 */
export function buildMarpWebviewHtml(opts: MarpWebviewHtmlOptions): string {
  const { renderResult, nonce, cspSource, sdkJsUri, sdkCssUri } = opts;
  const { html: marpHtml, css: marpCss, slideCount } = renderResult;
  const hasSdk = Boolean(sdkJsUri || sdkCssUri);

  // ── SDK head assets ─────────────────────────────────────────────────────────
  const sdkHeadAssets = hasSdk
    ? `
    <script src="${sdkJsUri}" nonce="${nonce}"></script>
    <link href="${sdkCssUri}" rel="stylesheet" nonce="${nonce}" data-sdk-css />`
    : "";

  // ── SDK init script ──────────────────────────────────────────────────────────
  const sdkInitScript = hasSdk
    ? `
    window.AccordoSDK = window.AccordoSDK || {};
    window.AccordoSDK.AccordoCommentSDK = window.AccordoSDK.AccordoCommentSDK || {};
    var sdk = new window.AccordoSDK.AccordoCommentSDK();
    var allThreads = [];

    // Re-filter threads for the current slide and tell the SDK to re-render.
    // sdk.loadThreads() clears existing pins first (thread-manager.ts loadThreads
    // removes all pin DOM nodes before rendering), so this correctly replaces
    // stale pins from the previous slide with pins for the new slide.
    var refreshPins = function() {
      var filtered = allThreads.filter(function(t) {
        if (!t.blockId) return false;
        var parts = t.blockId.split(':');
        return parts.length >= 2 && parts[0] === 'slide' && parseInt(parts[1], 10) === current;
      });
      if (sdk.loadThreads) sdk.loadThreads(filtered);
    };

    var coordinateToScreen = function(blockId) {
      var match = /^slide:(\\d+):([\\d.]+):([\\d.]+)$/.exec(blockId);
      if (!match) return null;
      var targetIndex = parseInt(match[1], 10);
      var relX = parseFloat(match[2]);
      var relY = parseFloat(match[3]);
      var activeSvg = document.querySelector('svg[data-marpit-svg].active');
      if (!activeSvg) return null;
      if (targetIndex !== current) {
        return null;
      }
      var rect = activeSvg.getBoundingClientRect();
      return {
        x: rect.left + relX * rect.width,
        y: rect.top + relY * rect.height
      };
    };

    var callbacks = {
      onCreate: function(blockId, body) {
        vscode.postMessage({ type: 'comment:create', blockId: blockId, body: body });
      },
      onReply: function(threadId, body) {
        vscode.postMessage({ type: 'comment:reply', threadId: threadId, body: body });
      },
      onResolve: function(threadId) {
        vscode.postMessage({ type: 'comment:resolve', threadId: threadId });
      },
      onReopen: function(threadId) {
        vscode.postMessage({ type: 'comment:reopen', threadId: threadId });
      },
      onDelete: function(threadId, commentId) {
        vscode.postMessage({ type: 'comment:delete', threadId: threadId, commentId: commentId });
      }
    };

    sdk.init({ container: document.body, coordinateToScreen: coordinateToScreen, callbacks: callbacks });`
    : "";

  // ── SDK message handlers ─────────────────────────────────────────────────────
  const sdkMessageHandlers = hasSdk
    ? `
    // blockId format: slide:0:x:y
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'comments:load':
          allThreads = msg.threads || [];
          refreshPins();
          break;
        case 'comments:add':
          if (msg.thread) {
            allThreads = allThreads.concat(msg.thread);
            refreshPins();
          }
          break;
        case 'comments:update':
          if (msg.thread && msg.thread.id) {
            allThreads = allThreads.map(function(t) {
              return t.id === msg.thread.id ? msg.thread : t;
            });
          }
          break;
        case 'comments:remove':
          if (msg.threadId) {
            allThreads = allThreads.filter(function(t) { return t.id !== msg.threadId; });
          }
          break;
        case 'comments:focus':
          try {
            var threadId = msg.threadId;
            var blockId = msg.blockId || '';
            var parts = blockId.split(':');
            var targetSlide = current;
            if (parts.length >= 2 && parts[0] === 'slide') {
              targetSlide = parseInt(parts[1], 10);
            }
            if (targetSlide !== current) {
              goTo(targetSlide);
            }
            if (sdk.openPopover) sdk.openPopover(threadId);
          } catch (e) {}
          break;
      }
    });`
    : "";

  // ── Alt+click handler (SDK-native: free-form slide surface → data-block-id bridge) ─
  const altClickHandler = hasSdk
    ? `
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
      // Set blockId on the active SVG (an actual ancestor of e.target).
      activeSvg.setAttribute('data-block-id', blockId);
      // The SDK's click handler fires synchronously in the same event loop.
      // Remove the attribute shortly after so the DOM retains no stale blockIds.
      setTimeout(function() { activeSvg.removeAttribute('data-block-id'); }, 0);
    });`
    : "";

  // ── Full HTML document ───────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${cspSource}; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data: https: blob:; font-src ${cspSource} data:; connect-src ${cspSource};">${sdkHeadAssets}
  <style nonce="${nonce}">${marpCss}</style>
  <style nonce="${nonce}">
    html, body { margin: 0; padding: 0; background: #1e1e1e; overflow-x: hidden; }
    div.marpit { width: 100%; }
    svg[data-marpit-svg] { display: none; width: 100%; height: auto; }
    svg[data-marpit-svg].active { display: block; }
    #slide-container { padding: 20px 20px 80px; }
    #nav {
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 12px;
      background: rgba(0,0,0,0.75); color: #fff;
      padding: 8px 18px; border-radius: 24px; z-index: 9999;
      font-family: var(--vscode-font-family, sans-serif); font-size: 13px;
      user-select: none;
    }
    #nav button {
      background: transparent; border: 1px solid rgba(255,255,255,0.4);
      color: #fff; padding: 3px 14px; border-radius: 12px;
      cursor: pointer; font-size: 13px;
    }
    #nav button:disabled { opacity: 0.3; cursor: default; }
    #nav button:hover:not(:disabled) { background: rgba(255,255,255,0.15); }
  </style>
</head>
<body>
  <div id="slide-container">${marpHtml}</div>
  <div id="nav">
    <button id="btn-prev">&#9664; Prev</button>
    <span id="slide-counter">1 / ${slideCount}</span>
    <button id="btn-next">Next &#9654;</button>
  </div>
  <script nonce="${nonce}">
    var vscode = window.acquireVsCodeApi ? window.acquireVsCodeApi() : null;
    var slides = Array.from(document.querySelectorAll('svg[data-marpit-svg]'));
    var current = 0;

    slides.forEach(function(s, i) { if (i === 0) s.classList.add('active'); });
    document.getElementById('btn-prev').disabled = true;
    document.getElementById('btn-next').disabled = slides.length <= 1;

    function goTo(index) {
      if (index < 0 || index >= slides.length) return;
      slides[current].classList.remove('active');
      current = index;
      slides[current].classList.add('active');
      document.getElementById('slide-counter').textContent = (current + 1) + ' / ' + slides.length;
      document.getElementById('btn-prev').disabled = current === 0;
      document.getElementById('btn-next').disabled = current === slides.length - 1;
      window.scrollTo(0, 0);
      if (vscode) vscode.postMessage({ type: 'presentation:slideChanged', index: current });
      refreshPins();
    }

    document.getElementById('btn-prev').addEventListener('click', function() { goTo(current - 1); });
    document.getElementById('btn-next').addEventListener('click', function() { goTo(current + 1); });

    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'slide-index') goTo(msg.index);
      if (msg.type === 'host:request-capture') {
        var active = slides[current];
        if (!active) {
          if (vscode) vscode.postMessage({ type: 'presentation:capture-ready', data: null, error: 'No active slide' });
          return;
        }
        try {
          var svgString = new XMLSerializer().serializeToString(active);
          var b64 = btoa(unescape(encodeURIComponent(svgString)));
          if (vscode) vscode.postMessage({ type: 'presentation:capture-ready', data: b64 });
        } catch (e) {
          if (vscode) vscode.postMessage({ type: 'presentation:capture-ready', data: null, error: String(e) });
        }
      }
    });

    window.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') goTo(current + 1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') goTo(current - 1);
    });${altClickHandler}${sdkInitScript}${sdkMessageHandlers}
  </script>
</body>
</html>`;
}
