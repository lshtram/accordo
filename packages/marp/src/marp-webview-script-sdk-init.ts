/**
 * marp-webview-script-sdk-init.ts — Comment SDK initialisation builders
 *
 * Namespace setup, refreshPins, coordinateToScreen, callbacks, sdk.init(),
 * and head asset tag assembly.
 *
 * Source: requirements-marp.md §4 M50-PVD
 */

const SDK_VAR = "sdk";
const THREADS_VAR = "allThreads";
const COORD_FN = "coordinateToScreen";
const REFRESH_FN = "refreshPins";

/** Build the SDK namespace/constructor + threads array. */
function buildSdkNamespace(): string {
  return `
    window.AccordoSDK = window.AccordoSDK || {};
    window.AccordoSDK.AccordoCommentSDK = window.AccordoSDK.AccordoCommentSDK || {};
    var ${SDK_VAR} = new window.AccordoSDK.AccordoCommentSDK();
    var ${THREADS_VAR} = [];`;
}

/** Build the refreshPins closure. */
function buildRefreshPins(): string {
  return `
    ${REFRESH_FN} = function() {
      var filtered = ${THREADS_VAR}.filter(function(t) {
        if (!t.blockId) return false;
        var parts = t.blockId.split(':');
        return parts.length >= 2 && parts[0] === 'slide' && parseInt(parts[1], 10) === current;
      });
      if (${SDK_VAR}.loadThreads) ${SDK_VAR}.loadThreads(filtered);
    };`;
}

/** Build the coordinateToScreen helper. */
function buildCoordinateToScreen(): string {
  return `
    var ${COORD_FN} = function(blockId) {
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
    };`;
}

/** Build the SDK callbacks object. */
function buildCallbacks(): string {
  return `
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
    };`;
}

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
 * Build the full SDK init snippet.
 * Returns empty string when hasSdk is false.
 */
export function buildSdkInitScript(hasSdk: boolean): string {
  if (!hasSdk) return "";
  return [
    buildSdkNamespace(),
    buildRefreshPins(),
    buildCoordinateToScreen(),
    buildCallbacks(),
    `\n    ${SDK_VAR}.init({ container: document.body, coordinateToScreen: ${COORD_FN}, callbacks: callbacks });`,
  ].join("\n");
}
