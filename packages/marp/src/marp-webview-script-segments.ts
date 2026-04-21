/**
 * marp-webview-script-segments.ts — Re-export facade for runtime script builders
 *
 * This file re-exports all public builders from the focused sub-modules
 * and provides the top-level `buildRuntimeScript` assembler.
 * Sub-modules:
 *   marp-webview-script-runtime.ts    — base navigation / activation / keyboard / ready
 *   marp-webview-script-sdk-init.ts    — SDK namespace, refreshPins, coordinateToScreen, callbacks, init
 *   marp-webview-script-sdk.ts         — SDK message handlers, comments:focus, Alt+click
 *   marp-webview-script-host.ts        — host-originated message handling
 *
 * Source: requirements-marp.md §4 M50-PVD
 */

// Re-exports — do not add any other implementation here.

export { buildBaseVariables } from "./marp-webview-script-runtime.js";
export { buildSlideActivation } from "./marp-webview-script-runtime.js";
export { buildGoTo } from "./marp-webview-script-runtime.js";
export { buildNavigationListeners } from "./marp-webview-script-runtime.js";
export { buildKeyboardNavigation } from "./marp-webview-script-runtime.js";
export { buildWebviewReady } from "./marp-webview-script-runtime.js";

export { buildSdkInitScript } from "./marp-webview-script-sdk-init.js";
export { buildSdkMessageHandlers } from "./marp-webview-script-sdk.js";
export { buildSdkHeadAssets } from "./marp-webview-script-sdk-init.js";
export { buildAltClickHandler } from "./marp-webview-script-sdk.js";

export { buildHostMessageHandler } from "./marp-webview-script-host.js";

import {
  buildBaseVariables,
  buildSlideActivation,
  buildGoTo,
  buildNavigationListeners,
  buildKeyboardNavigation,
  buildWebviewReady,
} from "./marp-webview-script-runtime.js";
import { buildHostMessageHandler } from "./marp-webview-script-host.js";

/**
 * Assemble the complete runtime script from its fragment builders.
 * Fragments are concatenated in document order:
 *   base vars → slide activation → goTo → nav buttons → host message handler
 *   → keyboard nav → alt-click handler → SDK init → SDK message handlers → webview:ready
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
    buildHostMessageHandler() +
    buildKeyboardNavigation() +
    altClickHandler +
    sdkInitScript +
    sdkMessageHandlers +
    buildWebviewReady()
  );
}
