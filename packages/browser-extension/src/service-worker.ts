/**
 * M80-SW — Background Service Worker (entry point)
 *
 * Bootstrap: imports the three focused modules and wires them together.
 * This file is the esbuild entry point — it has no exports of its own
 * beyond re-exports for testability.
 *
 * Modules:
 *  sw-comment-sync.ts  — Hub ↔ Browser adapter, mergeLocalAndHubThread
 *  sw-router.ts        — createHandleMessage factory (message dispatcher)
 *  sw-lifecycle.ts     — listeners, onInstalled, periodic sync, relay bridge
 */

import { MESSAGE_TYPES } from "./constants.js";
import type { MessageType } from "./constants.js";
import { createHandleMessage } from "./sw-router.js";
import {
  relayBridge,
  forwardToAccordoBrowser,
  broadcastCommentsUpdated,
  handleRelayActionWithBroadcast,
  registerListeners as _registerListeners,
  registerRelayTokenReconnect,
  registerStartupReconnect,
  onInstalled,
  checkAndSync,
  startPeriodicSync,
  stopPeriodicSync,
} from "./sw-lifecycle.js";
import { DEV_BROWSER_PAIRING_BYPASS } from "./relay-bridge-constants.js";
import { mergeLocalAndHubThread } from "./sw-comment-sync.js";
import type { SwMessage, SwResponse } from "./sw-router.js";

export { MESSAGE_TYPES };
export type { MessageType };
export { mergeLocalAndHubThread, onInstalled, checkAndSync, stopPeriodicSync };
export type { SwMessage, SwResponse };

// ── Wire up the message handler ──────────────────────────────────────────────
// Bind the router to the lifecycle singletons (relayBridge, forwardFn, etc.)
export const handleMessage = createHandleMessage(
  relayBridge,
  forwardToAccordoBrowser,
  broadcastCommentsUpdated,
  handleRelayActionWithBroadcast,
);

// ── Expose registerListeners with bound handleMessage ─────────────────────────
export function registerListeners(): void {
  _registerListeners(handleMessage);
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
registerListeners();
registerRelayTokenReconnect(() => relayBridge.start());
chrome.runtime.onInstalled.addListener((details) => { void onInstalled(details); });

// When pairing bypass is active, register startup + alarm reconnect so the
// extension reconnects reliably after a VS Code reload even without a stored token.
// TODO: Remove alongside DEV_BROWSER_PAIRING_BYPASS.
if (DEV_BROWSER_PAIRING_BYPASS) {
  registerStartupReconnect(() => relayBridge.start());
}

relayBridge.start();
startPeriodicSync();
