export const RELAY_RETRY_AFTER_MS = {
  "browser-not-connected": 2000,
  timeout: 1000,
  "action-failed": 1000,
  "detached-node": 1000,
  "capture-failed": 2000,
  "element-off-screen": 1000,
  "snapshot-not-found": undefined,
  "snapshot-stale": undefined,
} as const;

export const RELAY_RECOVERY_HINTS = {
  "browser-not-connected": "Check that the browser relay is running and the Chrome extension is connected.",
  timeout: "The operation timed out. Retry with a longer timeout or verify the page has loaded.",
  "action-failed": "The browser action failed. The element may have changed — take a fresh snapshot and retry.",
  "detached-node": "The target element was removed from the DOM. Take a new snapshot to find the updated element.",
  "capture-failed": "Screenshot capture failed. The tab may still be loading — wait briefly and retry.",
  "element-off-screen": "The element is outside the visible viewport. Scroll it into view before retrying.",
  "origin-blocked": "This origin is blocked by the security policy. Check allowedOrigins/deniedOrigins.",
  "invalid-request": "The request parameters are invalid. Check required fields and value constraints. If using uid/ref/nodeId from get_page_map, you must also pass creationSnapshotId from the same response.",
  "element-not-found": "The element could not be resolved. The snapshot handle may have become stale — re-run get_page_map and retry with the new snapshotId.",
  "snapshot-not-found": "Call get_page_map to get a current snapshotId, then retry the page-understanding action with that snapshotId.",
  "snapshot-stale": "The snapshotId is from a prior page-map capture. Call get_page_map again to get a fresh snapshotId, then retry the page-understanding action.",
} as const;

export function classifyThrownRelayError(err: unknown): "timeout" | "browser-not-connected" {
  if (err instanceof Error) {
    if (err.message.includes("not-connected") || err.message.includes("disconnected")) {
      return "browser-not-connected";
    }
    return "timeout";
  }
  return "timeout";
}

export function getRelayRetryAfterMs(error: string): number | undefined {
  return RELAY_RETRY_AFTER_MS[error as keyof typeof RELAY_RETRY_AFTER_MS];
}

export function getRelayRecoveryHint(error: string): string | undefined {
  return RELAY_RECOVERY_HINTS[error as keyof typeof RELAY_RECOVERY_HINTS];
}
