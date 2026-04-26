/**
 * marp-webview-script-runtime.ts — Core runtime script builders for Marp webview
 *
 * Base navigation, activation, and message routing — no SDK dependency.
 *
 * Source: requirements-marp.md §4 M50-PVD
 */

/** Base variable declarations (vscode API, slides collection, current index). */
export function buildBaseVariables(): string {
  return `
    var vscode = window.acquireVsCodeApi ? window.acquireVsCodeApi() : null;
    var slides = Array.from(document.querySelectorAll('svg[data-marpit-svg]'));
    var current = 0;
    var lastReceivedRevision = -1;
    var refreshPins = function() {};
    var renderMermaidDiagrams = function() {};`;
}

/** Mark the first slide active and initialise nav button disabled states. */
export function buildSlideActivation(): string {
  return `
    slides.forEach(function(s, i) { if (i === 0) s.classList.add('active'); });
    document.getElementById('btn-prev').disabled = true;
    document.getElementById('btn-next').disabled = slides.length <= 1;`;
}

/** The goTo(index) function — navigates to a slide by index. */
export function buildGoTo(): string {
  return `
    function goTo(index) {
      if (!Number.isFinite(index)) return;
      index = Math.trunc(index);
      if (slides.length === 0) return;
      if (index < 0 || index >= slides.length) return;
      if (slides[current]) { slides[current].classList.remove('active'); }
      current = index;
      if (slides[current]) { slides[current].classList.add('active'); }
      document.getElementById('slide-counter').textContent = (current + 1) + ' / ' + slides.length;
      document.getElementById('btn-prev').disabled = current === 0;
      document.getElementById('btn-next').disabled = current === slides.length - 1;
      window.scrollTo(0, 0);
      if (vscode) vscode.postMessage({ type: 'presentation:slideChanged', index: current });
      refreshPins();
    }`;
}

/** Wire up Prev/Next button click listeners. */
export function buildNavigationListeners(): string {
  return `
    document.getElementById('btn-prev').addEventListener('click', function() { goTo(current - 1); });
    document.getElementById('btn-next').addEventListener('click', function() { goTo(current + 1); });`;
}

/** Arrow / PageUp / PageDown keyboard navigation. */
export function buildKeyboardNavigation(): string {
  return `
    window.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') goTo(current + 1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') goTo(current - 1);
    });`;
}

/** Signal to the host that the webview DOM is ready. */
export function buildWebviewReady(): string {
  return `
    if (vscode) { vscode.postMessage({ type: 'webview:ready' }); }`;
}

/** Lightweight Mermaid fallback: convert Mermaid code blocks into .mermaid divs and run mermaid.js. */
export function buildMermaidSupport(): string {
  return `
    if (window.mermaid) {
      try {
        window.mermaid.initialize({ startOnLoad: false, theme: 'dark' });
      } catch (e) {
        console.warn('[accordo-marp] mermaid.initialize failed', e);
      }

      renderMermaidDiagrams = function() {
        try {
          Array.from(document.querySelectorAll('pre code.language-mermaid')).forEach(function(code) {
            var pre = code.closest('pre');
            if (!pre) return;
            var host = document.createElement('div');
            host.className = 'mermaid';
            host.textContent = code.textContent || '';
            pre.replaceWith(host);
          });
          return window.mermaid.run().catch(function(e) {
            console.warn('[accordo-marp] mermaid.run() error', e);
          });
        } catch (e) {
          console.warn('[accordo-marp] renderMermaidDiagrams failed', e);
          return Promise.resolve();
        }
      };

      renderMermaidDiagrams();
    }`;
}
