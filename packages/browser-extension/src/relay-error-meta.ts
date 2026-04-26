import type { RelayActionResponse } from "./relay-definition-types.js";

/**
 * MCP-ER-002: Retry metadata for structured error responses.
 * Maps error codes to retryable flag and optional retryAfterMs.
 * Codes not listed default to retryable: true with no retryAfterMs.
 */
const ERROR_META: Record<string, { retryable: boolean; retryAfterMs?: number }> = {
  "browser-not-connected": { retryable: true, retryAfterMs: 2000 },
  timeout: { retryable: true, retryAfterMs: 1000 },
  "element-not-found": { retryable: false },
  "element-off-screen": { retryable: false },
  "no-target": { retryable: false },
  "invalid-request": { retryable: false },
  "iframe-cross-origin": { retryable: false },
  "no-content-script": { retryable: true, retryAfterMs: 1000 },
  "tab-not-found": { retryable: false },
  "image-too-large": { retryable: false },
  "capture-failed": { retryable: false },
  "origin-blocked": { retryable: false },
  "snapshot-not-found": { retryable: false },
  "snapshot-stale": { retryable: false },
  "redaction-failed": { retryable: false },
};

export function getErrorMeta(code: string): { retryable: boolean; retryAfterMs?: number } {
  return ERROR_META[code] ?? { retryable: true };
}

export function actionFailed(
  request: { requestId: string },
  code: RelayActionResponse["error"] = "action-failed",
): RelayActionResponse {
  const meta = getErrorMeta(code);
  return {
    requestId: request.requestId,
    success: false,
    error: code,
    retryable: meta.retryable,
    ...(meta.retryAfterMs !== undefined ? { retryAfterMs: meta.retryAfterMs } : {}),
  };
}
