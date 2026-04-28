/**
 * relay-actions.ts — Thin barrel: dispatch switch + re-exports.
 *
 * This is the public API surface for the relay layer. All consumers
 * (service-worker.ts, relay-bridge.ts, tests) import from this file.
 * The actual logic lives in:
 *   - relay-definitions.ts  — types, defaultStore, isVersionedSnapshot
 *   - relay-dispatch-table.ts — action → handler dispatch map
 *   - relay-handlers.ts     — handler implementations per action
 *   - relay-forwarder.ts    — cross-context messaging utilities
 *
 * Split from 868-line monolith (B5a modularity).
 *
 * @module
 */

import { resetDefaultManager } from "./snapshot-versioning.js";
import { defaultStore } from "./relay-definitions.js";
import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { dispatchMap, unsupportedResponse, failedResponse } from "./relay-dispatch-table.js";

// ── Re-exports (preserve public API surface) ─────────────────────────────────

export { defaultStore };
export type { RelayAction, RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";

// ── Navigation Reset ─────────────────────────────────────────────────────────

/**
 * Navigation reset lifecycle contract (B2-SV-005).
 *
 * **Ownership:** The service worker (relay layer) is responsible for observing
 * navigation events via `chrome.webNavigation.onCommitted` or `chrome.tabs.onUpdated`.
 * When a top-level navigation is detected for a tab, the service worker MUST:
 *
 * 1. Call `resetDefaultManager()` to reset the snapshot version counter.
 * 2. The content script's `SnapshotStore` is inherently reset because the
 *    content script is destroyed and re-injected on navigation.
 *
 * The relay layer does NOT own snapshot ID minting for data-producing tools.
 * It forwards the SnapshotEnvelope produced by the content script's
 * `captureSnapshotEnvelope()` function without modification.
 *
 * For capture_region (which runs in the service worker context), the relay
 * uses `captureSnapshotEnvelope("visual")` from snapshot-versioning.ts.
 */
export function handleNavigationReset(): void {
  resetDefaultManager();
  defaultStore.resetOnNavigation();
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Main dispatch switch — routes each RelayAction to its handler.
 *
 * Delegates to the dispatch map in relay-dispatch-table.ts.
 * capture_full_page_screenshot is the only action with payload transformation.
 */
export async function handleRelayAction(request: RelayActionRequest): Promise<RelayActionResponse> {
  try {
    // capture_full_page_screenshot is a virtual action — route through capture_region
    if (request.action === "capture_full_page_screenshot") {
      const handler = dispatchMap["capture_region"];
      if (handler) return await handler({ ...request, action: "capture_region", payload: { ...request.payload, mode: "fullPage" } });
      return unsupportedResponse(request);
    }

    const handler = dispatchMap[request.action];
    if (handler) return await handler(request);
    return unsupportedResponse(request);
  } catch {
    return failedResponse(request);
  }
}
