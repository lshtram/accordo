/**
 * marp-webview-script-segments.ts — Runtime script builders for Marp webview
 *
 * Each builder produces a fragment of the inline JS injected into the webview.
 * All functions are pure string builders — no side effects, no DOM access.
 *
 * Source: requirements-marp.md §4 M50-PVD
 */

/**
 * Build the <script> and <link> tags for SDK head assets.
 */
export function buildSdkHeadAssets(
  hasSdk: boolean,
  sdkJsUri: string | undefined,
  sdkCssUri: string | undefined,
  nonce: string,
): string {
  if (!hasSdk) return "";
  return `
    <script src="${sdkJsUri}" nonce="${nonce}"></script>
    <link href="${sdkCssUri}" rel="stylesheet" nonce="${nonce}" data-sdk-css />`;
}

/**
 * Build the SDK init snippet: namespace setup, refreshPins closure,
 * coordinateToScreen helper, and sdk.init() call.
 */
export function buildSdkInitScript(hasSdk: boolean): string {
  if (!hasSdk) return "";
  return `
    window.AccordoSDK = window.AccordoSDK || {};
    window.AccordoSDK.AccordoCommentSDK = window.AccordoSDK.AccordoCommentSDK || {};
    var sdk = new window.AccordoSDK.AccordoCommentSDK();
    var allThreads = [];

    refreshPins = function() {
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
      if (targetIndex !== current) { return null; }
      var rect = activeSvg.getBoundingClientRect();
      return { x: rect.left + relX * rect.width, y: rect.top + relY * rect.height };
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

    sdk.init({ container: document.body, coordinateToScreen: coordinateToScreen, callbacks: callbacks });`;
}

/**
 * Build the window 'message' event listener fragment that handles
 * comments:load / comments:add / comments:update / comments:remove / comments:focus.
 * The SDK conditional is inlined via the hasSdk parameter.
 */
export function buildSdkMessageHandlers(hasSdk: boolean): string {
  if (!hasSdk) return "";
  return `
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
          if (msg.thread) { allThreads = allThreads.concat(msg.thread); refreshPins(); }
          break;
        case 'comments:update':
          if (msg.thread && msg.thread.id) {
            allThreads = allThreads.map(function(t) { return t.id === msg.thread.id ? msg.thread : t; });
            refreshPins();
          }
          break;
        case 'comments:remove':
          if (msg.threadId) { allThreads = allThreads.filter(function(t) { return t.id !== msg.threadId; }); refreshPins(); }
          break;
        case 'comments:focus':
          try {
            var threadId = msg.threadId;
            var blockId = msg.blockId || '';
            var parts = blockId.split(':');
            var targetSlide = current;
            if (parts.length >= 2 && parts[0] === 'slide') { targetSlide = parseInt(parts[1], 10); }
            if (!Number.isFinite(targetSlide) || targetSlide < 0 || targetSlide >= slides.length) { break; }
            if (targetSlide !== current) { goTo(targetSlide); }
            if (sdk.openPopover) sdk.openPopover(threadId);
          } catch (e) {}
          break;
      }
    });`;
}

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

// ── Individual runtime script builders ─────────────────────────────────────────

/** Base variable declarations (vscode API, slides collection, current index). */
function buildBaseVariables(): string {
  return `
    var vscode = window.acquireVsCodeApi ? window.acquireVsCodeApi() : null;
    var slides = Array.from(document.querySelectorAll('svg[data-marpit-svg]'));
    var current = 0;
    var lastReceivedRevision = -1;
    var refreshPins = function() {};`;
}

/** Mark the first slide active and initialise nav button disabled states. */
function buildSlideActivation(): string {
  return `
    slides.forEach(function(s, i) { if (i === 0) s.classList.add('active'); });
    document.getElementById('btn-prev').disabled = true;
    document.getElementById('btn-next').disabled = slides.length <= 1;`;
}

/** The goTo(index) function — navigates to a slide by index. */
function buildGoTo(): string {
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
function buildNavigationListeners(): string {
  return `
    document.getElementById('btn-prev').addEventListener('click', function() { goTo(current - 1); });
    document.getElementById('btn-next').addEventListener('click', function() { goTo(current + 1); });`;
}

/**
 * Build the window 'message' listener.
 * Handles: slide-index, marp:update, host:request-capture.
 * The SDK-specific messages (comments:focus) are NOT inlined here — they
 * live in the separate sdkMessageHandlers switch listener.
 */
function buildMessageHandler(_hasSdk: boolean): string {
  return `
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'slide-index') { goTo(msg.index); return; }
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
        goTo(clamped);

        if (typeof msg.revision === 'number') { lastReceivedRevision = msg.revision; }
        refreshPins();
        return;
      }
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
    });`;
}

/** Arrow / PageUp / PageDown keyboard navigation. */
function buildKeyboardNavigation(): string {
  return `
    window.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') goTo(current + 1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') goTo(current - 1);
    });`;
}

/** Signal to the host that the webview DOM is ready. */
function buildWebviewReady(): string {
  return `
    if (vscode) { vscode.postMessage({ type: 'webview:ready' }); }`;
}

/**
 * Assemble the complete runtime script from its fragment builders.
 * Each fragment is concatenated in document order.
 * Note: buildMessageHandler(inline) and sdkMessageHandlers(switch) are
 * both included — the inline branch handles comments:focus when hasSdk,
 * and the switch handler handles comments:load/add/update/remove.
 */
export function buildRuntimeScript(
  altClickHandler: string,
  sdkInitScript: string,
  sdkMessageHandlers: string,
): string {
  return (
    buildBaseVariables() +
    buildSlideActivation() +
    buildGoTo() +
    buildNavigationListeners() +
    buildMessageHandler(Boolean(sdkInitScript)) +
    buildKeyboardNavigation() +
    altClickHandler +
    sdkInitScript +
    sdkMessageHandlers +
    buildWebviewReady()
  );
}
