export const WAIT_DEFAULT_TIMEOUT_MS = 10_000;
export const WAIT_MAX_TIMEOUT_MS = 30_000;
export const RELAY_TIMEOUT_MS = WAIT_MAX_TIMEOUT_MS + 5_000;

export interface WaitForArgs {
  tabId?: number;
  texts?: string[];
  selector?: string;
  stableLayoutMs?: number;
  timeout?: number;
}

export type WaitError = "timeout" | "navigation-interrupted" | "page-closed";

export interface WaitForResult {
  success?: false;
  met: boolean;
  matchedCondition?: string;
  elapsedMs: number;
  error?: WaitError;
  errorCode?: WaitError;
  timeoutMs?: number;
  retryable?: boolean;
  retryAfterMs?: number;
  recoveryHints?: string;
}

export interface WaitToolError {
  success: false;
  error: "browser-not-connected" | "timeout" | "action-failed" | "invalid-request" | "no-content-script";
  errorCode?: "browser-not-connected" | "timeout" | "action-failed" | "invalid-request" | "no-content-script";
  retryable: boolean;
  retryAfterMs?: number;
  recoveryHints?: string;
}
