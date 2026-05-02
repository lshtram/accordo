/**
 * browser-comment-sync-runner.ts
 *
 * Phase C implementation for browser-extension full-state sync runner.
 *
 * Implements the full-state sync protocol:
 *  1. Send sync_comment_state to Accordo via relay.request
 *  2. Persist the merged response to canonical Chrome storage
 *  3. Broadcast via relay.push to refresh UI
 *  4. Log events for test observation
 *
 * The runner is the sole producer of the event log — tests use getRunnerEventLog()
 * to assert ordering and call sequence.
 */

import {
  CANONICAL_BROWSER_COMMENT_SYNC_KEY,
  persistMergedBrowserCommentSyncState,
  type BrowserCommentSyncPage,
} from "./browser-comment-sync-store.js";

export { CANONICAL_BROWSER_COMMENT_SYNC_KEY };

// These types mirror the expected relay interface for test inspection
export interface MockRelayRequest {
  request: (action: string, payload?: unknown) => Promise<{
    success: boolean;
    requestId: string;
    data: unknown;
  }>;
  push: (action: string, payload?: unknown) => void;
  isConnected: () => boolean;
}

export type EventLogEntry =
  | { type: "request"; action: string; payload: unknown }
  | { type: "persist"; state: unknown }
  | { type: "broadcast"; action: string; payload: unknown };

let _eventLog: EventLogEntry[] = [];

function _resetRunnerState(): void {
  _eventLog = [];
}

export function getRunnerEventLog(): EventLogEntry[] {
  return [..._eventLog];
}

/**
 * Run a full-state browser comment sync cycle:
 *
 *  1. Send sync_comment_state relay action with outbound state
 *  2. Persist the merged response from Accordo
 *  3. Broadcast refresh to UI
 *
 * The event log records each step so tests can verify ordering.
 */
export async function runBrowserCommentFullStateSync(relay: MockRelayRequest): Promise<void> {
  _resetRunnerState();

  // Step 1: Send sync_comment_state
  _eventLog.push({ type: "request", action: "sync_comment_state", payload: {} });
  const response = await relay.request("sync_comment_state", {});

  if (!response.success) {
    return;
  }

  const mergedState = response.data as {
    schemaVersion: string;
    browserRevision: number;
    accordoRevision: number;
    emittedBy: string;
    generatedAt: string;
    pages: BrowserCommentSyncPage[];
  };

  // Step 2: Persist BEFORE broadcast
  _eventLog.push({ type: "persist", state: mergedState });
  await persistMergedBrowserCommentSyncState(mergedState);

  // Step 3: Broadcast refresh
  _eventLog.push({ type: "broadcast", action: "refresh", payload: mergedState });
  relay.push("browser-comments-changed", mergedState);
}
