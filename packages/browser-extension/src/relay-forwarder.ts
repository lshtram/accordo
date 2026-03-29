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
import { captureSnapshotEnvelope } from "./snapshot-versioning.js";
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
 * Resolve the target URL from an explicit payload URL or the active tab.
 * Prefers the explicit URL if provided and non-empty.
 */
export async function resolveRequestedUrl(payload: Record<string, unknown>): Promise<string | null> {
  const explicitUrl = readOptionalString(payload, "url");
  if (explicitUrl && explicitUrl.trim().length > 0) {
    return normalizeUrl(explicitUrl);
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
 * Falls back to a service-worker-local envelope only when no content script
 * is available (e.g., chrome:// pages, test environments).
 */
export async function requestContentScriptEnvelope(source: "dom" | "visual"): Promise<SnapshotEnvelope> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "CAPTURE_SNAPSHOT_ENVELOPE",
        source,
      });
      if (isSnapshotEnvelope(response)) {
        return response;
      }
    }
  } catch {
    // Content script not available — fall through to local fallback
  }
  // Fallback: service-worker-local envelope (degraded — counter may diverge)
  return captureSnapshotEnvelope(source);
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/**
 * Forward a page-understanding action to a content script via chrome.tabs.sendMessage.
 *
 * Returns the response data on success, or null if the content script is
 * unreachable or returns an error.
 */
export async function forwardToContentScript(
  tabId: number,
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown | null> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "PAGE_UNDERSTANDING_ACTION",
    action,
    payload,
  });
  if (!response || hasErrorField(response)) {
    return null;
  }
  return hasDataField(response) ? response.data : response;
}
