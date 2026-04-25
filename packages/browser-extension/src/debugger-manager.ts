/**
 * M110-TC — Debugger Manager
 *
 * Manages chrome.debugger attachment lifecycle.
 * Handles MV3 service worker restart recovery.
 *
 * REQ-TC-003: Fails when user has not granted permission (PERMISSION_REQUIRED).
 *
 * @module
 */

import {
  attachedTabs,
  canUseDebuggerSession,
  detachingTabs,
  getDebuggerProtocolVersion,
  registerDetachListener,
  removeDetachListeners,
} from "./debugger-manager-state.js";

/**
 * Ensure the debugger is attached to the given tab. No-op if already attached.
 *
 * MV3 recovery: If the service worker restarted and Chrome still has a debugger
 * session from the previous instance, catch "Another debugger is already attached"
 * and treat it as a successful attach.
 *
 * @throws Error with message "unsupported-page" if the tab cannot be attached
 *   to (chrome://, devtools://, etc.)
 */
export async function ensureAttached(tabId: number): Promise<void> {
  // Fast path: already attached
  if (attachedTabs.has(tabId)) {
    if (await canUseDebuggerSession(tabId)) {
      return;
    }

    attachedTabs.delete(tabId);
    removeDetachListeners(tabId);
  }

  try {
    await chrome.debugger.attach({ tabId }, getDebuggerProtocolVersion());
    attachedTabs.add(tabId);
    registerDetachListener(tabId);
  } catch (e) {
    const error = e as Error;
    if (error.message.includes("Another debugger is already attached")) {
      // MV3 recovery: SW restarted but Chrome kept the session alive.
      // Verify the session is actually usable before trusting it.
      if (!(await canUseDebuggerSession(tabId))) {
        throw e;
      }

      attachedTabs.add(tabId);
      registerDetachListener(tabId);
    } else if (error.message.includes("Cannot attach to this target")) {
      throw new Error("unsupported-page");
    } else {
      throw e;
    }
  }
}

/**
 * Detach the debugger from a tab. No-op if not attached.
 */
export async function detach(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) return;

  // Prevent re-entrant calls (e.g., from onDetach listener during chrome.debugger.detach)
  if (detachingTabs.has(tabId)) return;
  detachingTabs.add(tabId);

  try {
    // Clean up listeners first
    removeDetachListeners(tabId);
    attachedTabs.delete(tabId);
    await chrome.debugger.detach({ tabId });
  } finally {
    detachingTabs.delete(tabId);
  }
}

/**
 * Detach all active debugger sessions. Called on extension unload.
 */
export async function detachAll(): Promise<void> {
  const tabIds = Array.from(attachedTabs);
  for (const tabId of tabIds) {
    await detach(tabId);
  }
}

/**
 * Check if the debugger is currently attached to a tab (in-memory tracking).
 */
export function isAttached(tabId: number): boolean {
  return attachedTabs.has(tabId);
}

/**
 * Send a CDP command to a tab's debugger session.
 * Throws if the debugger is not attached.
 */
export async function sendCommand<T>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  if (!attachedTabs.has(tabId)) {
    throw new Error("Debugger not attached");
  }

  return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
}
