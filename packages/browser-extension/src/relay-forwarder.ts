/**
 * relay-forwarder.ts — Cross-context messaging utilities for the relay layer.
 *
 * Handles active tab URL resolution, content-script-to-service-worker
 * envelope requests, and tab ID resolution for page-understanding tools.
 *
 * Split from relay-actions.ts (B5a modularity).
 *
 * @module
 */

import { normalizeUrl } from "./store.js";
import type { SnapshotEnvelope } from "./snapshot-versioning.js";
import { isSnapshotEnvelope, hasErrorField, hasDataField, readOptionalString, readOptionalNumber } from "./relay-type-guards.js";

// ── Tab URL Resolution ───────────────────────────────────────────────────────

/**
 * Get the normalized URL of the currently active tab.
 * Returns null if no active tab or the URL is not http/https.
 */
export async function getActiveTabUrl(): Promise<string | null> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const url = tabs[0]?.url;
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) return null;
  return normalizeUrl(url);
}

/**
 * Resolve the target URL from an explicit payload URL, explicit tabId, or active tab.
 * Prefers the explicit URL if provided and non-empty.
 * B2-CTX-001: When tabId is provided, uses chrome.tabs.get to avoid tabs.query overhead.
 */
export async function resolveRequestedUrl(payload: Record<string, unknown>): Promise<string | null> {
  const explicitUrl = readOptionalString(payload, "url");
  if (explicitUrl && explicitUrl.trim().length > 0) {
    return normalizeUrl(explicitUrl);
  }
  const tabId = readOptionalNumber(payload, "tabId");
  if (tabId !== undefined) {
    // Use chrome.tabs.get directly — avoids unnecessary tabs.query call (B2-CTX-001)
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.url) {
      const url = tab.url;
      if (url.startsWith("http://") || url.startsWith("https://")) {
        return normalizeUrl(url);
      }
    }
    return null;
  }
  return await getActiveTabUrl();
}

// ── Content Script Envelope Request ──────────────────────────────────────────

/**
 * Request a SnapshotEnvelope from the content script.
 *
 * B2-SV-002: The content script is the single authoritative owner of
 * snapshot sequencing. The service worker MUST NOT mint envelopes directly —
 * it delegates to the content script to maintain a single monotonic counter.
 *
 * B2-CTX-005: When tabId is provided, the message is sent to that tab directly
 * instead of querying for the active tab.
 *
 * If no content script is available, this function throws. The service worker
 * must not mint page identity or snapshot versions locally.
 */
export async function requestContentScriptEnvelope(
  source: "dom" | "visual",
  tabId?: number,
): Promise<SnapshotEnvelope> {
  const targetTabId = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (targetTabId === undefined) {
    throw new Error("no-active-tab");
  }

  const response = await chrome.tabs.sendMessage(targetTabId, {
    type: "CAPTURE_SNAPSHOT_ENVELOPE",
    source,
  });
  if (isSnapshotEnvelope(response)) {
    return response;
  }
  throw new Error("content-script-envelope-unavailable");
}

// ── Tab ID Resolution ────────────────────────────────────────────────────────

/**
 * Resolve the target tab ID from an explicit tabId in the payload or from
 * the active tab. Used by page-understanding and wait_for handlers.
 *
 * B2-CTX-001: If tabId is provided in payload, use it directly (skip active tab query).
 *
 * Returns undefined if no tab can be resolved.
 */
export async function resolveTargetTabId(payload: Record<string, unknown>): Promise<number | undefined> {
  const explicitTabId = readOptionalNumber(payload, "tabId");
  if (explicitTabId !== undefined) {
    return explicitTabId;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

/**
 * Sentinel returned when the content script is not reachable.
 * Callers must check `isNoContentScript(result)` before treating result as data.
 */
export const NO_CONTENT_SCRIPT = Symbol("no-content-script");

function isNoReceiverError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? String(err);
  return (
    msg.includes("Receiving end does not exist") ||
    msg.includes("Could not establish connection") ||
    msg.includes("No tab with id")
  );
}

/**
 * Forward a page-understanding action to a content script via chrome.tabs.sendMessage.
 *
 * Returns the response data on success, NO_CONTENT_SCRIPT if the content script is
 * unreachable (not injected / tab not ready), or null if the content script returned
 * an error response.
 */
export async function forwardToContentScript(
  tabId: number,
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown | null | typeof NO_CONTENT_SCRIPT> {
  let response: unknown;
  try {
    response = await chrome.tabs.sendMessage(tabId, {
      type: "PAGE_UNDERSTANDING_ACTION",
      action,
      payload,
    });
  } catch (err) {
    if (isNoReceiverError(err)) {
      return NO_CONTENT_SCRIPT;
    }
    return null;
  }
  if (!response || hasErrorField(response)) {
    return null;
  }
  return hasDataField(response) ? response.data : response;
}

/**
 * Forward a page-understanding action to a specific frame via chrome.tabs.sendMessage.
 *
 * Uses the `frameId` option to target a specific child frame's content script.
 * This is the Chrome API primitive for frame-level message routing.
 *
 * B2-VD-007: Frame IDs for same-origin iframe entries line up with targeted
 * child frame identity for routing — the numeric frameId from chrome's frame
 * navigation API is used for SW-level forwarding.
 *
 * Returns the response data on success, NO_CONTENT_SCRIPT if the frame's content
 * script is unreachable, or null if it returned an error response.
 */
export async function forwardToFrame(
  tabId: number,
  frameId: number,
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown | null | typeof NO_CONTENT_SCRIPT> {
  let response: unknown;
  try {
    response = await chrome.tabs.sendMessage(
      tabId,
      { type: "PAGE_UNDERSTANDING_ACTION", action, payload },
      { frameId },
    );
  } catch (err) {
    if (isNoReceiverError(err)) {
      return NO_CONTENT_SCRIPT;
    }
    return null;
  }
  if (!response || hasErrorField(response)) {
    return null;
  }
  return hasDataField(response) ? response.data : response;
}
