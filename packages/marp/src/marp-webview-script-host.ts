/**
 * marp-webview-script-host.ts — Host message handler builder
 *
 * Handles: slide-index and marp:update (with revision guard).
 *
 * Source: requirements-marp.md §4 M50-PVD
 */

/** Build goTo(index) routing from a slide-index message. */
function buildSlideIndexRoute(): string {
  return `
    if (msg.type === 'slide-index') { goTo(msg.index); return; }`;
}

/** Build the marp:update handler with stale-revision guard. */
function buildMarpUpdateHandler(): string {
  return `
    if (msg.type === 'marp:update') {
      if (typeof msg.revision === 'number' && msg.revision <= lastReceivedRevision) { return; }

      if (typeof msg.html === 'string') {
        var slideContainer = document.getElementById('slide-container');
        if (slideContainer) { slideContainer.innerHTML = msg.html; }
      }
      if (typeof msg.css === 'string') {
        var cssTag = document.getElementById('marp-core-css');
        if (cssTag) { cssTag.textContent = msg.css; }
      }

      slides = Array.from(document.querySelectorAll('svg[data-marpit-svg]'));
      if (slides.length === 0) {
        current = 0;
        document.getElementById('slide-counter').textContent = '0 / 0';
        document.getElementById('btn-prev').disabled = true;
        document.getElementById('btn-next').disabled = true;
        if (typeof msg.revision === 'number') { lastReceivedRevision = msg.revision; }
        refreshPins();
        return;
      }

      var requested = typeof msg.currentSlide === 'number' ? Math.trunc(msg.currentSlide) : current;
      var clamped = Math.max(0, Math.min(requested, slides.length - 1));
      current = Math.min(current, slides.length - 1);
      var mermaidResult = renderMermaidDiagrams();
      var finishUpdate = function() {
        slides = Array.from(document.querySelectorAll('svg[data-marpit-svg]'));
        goTo(Math.max(0, Math.min(clamped, slides.length - 1)));
        if (typeof msg.revision === 'number') { lastReceivedRevision = msg.revision; }
        refreshPins();
      };
      if (mermaidResult && typeof mermaidResult.then === 'function') {
        mermaidResult.finally(finishUpdate);
      } else {
        finishUpdate();
      }
      return;
    }`;
}

/** Build the window 'message' listener for host-originated messages. */
export function buildHostMessageHandler(): string {
  return `
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      ${buildSlideIndexRoute()}
      ${buildMarpUpdateHandler()}
    });`;
}
