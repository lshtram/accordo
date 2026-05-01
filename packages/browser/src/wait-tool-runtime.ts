import { getRelayRecoveryHint, getRelayRetryAfterMs, classifyThrownRelayError } from "./relay-error-policy.js";
import { WAIT_DEFAULT_TIMEOUT_MS, WAIT_MAX_TIMEOUT_MS, type WaitForArgs, type WaitForResult, type WaitToolError } from "./wait-tool-contracts.js";

export function validateWaitArgs(args: WaitForArgs): { ok: true } | { ok: false; error: WaitToolError } {
  const normalized = normalizeWaitArgs(args);
  const hasCondition = (normalized.texts !== undefined && normalized.texts.length > 0) || normalized.selector !== undefined || normalized.stableLayoutMs !== undefined;
  if (!hasCondition) return invalidRequest("Provide at least one of: texts, selector, or stableLayoutMs.");
  if (args.timeout !== undefined && args.timeout < 0) return invalidRequest("timeout must be a non-negative number.");
  return { ok: true };
}

export function normalizeWaitArgs(args: WaitForArgs): WaitForArgs {
  const normalized: WaitForArgs = {};
  if (args.tabId !== undefined) normalized.tabId = args.tabId;
  const texts = args.texts?.filter((text) => text.length > 0);
  if (texts !== undefined && texts.length > 0) normalized.texts = texts;
  if (args.selector !== undefined && args.selector.trim().length > 0) normalized.selector = args.selector;
  if (args.stableLayoutMs !== undefined && args.stableLayoutMs > 0) normalized.stableLayoutMs = args.stableLayoutMs;
  if (args.timeout !== undefined) normalized.timeout = args.timeout;
  return normalized;
}

export function clampTimeout(rawTimeout: number | undefined): number {
  return Math.min(rawTimeout ?? WAIT_DEFAULT_TIMEOUT_MS, WAIT_MAX_TIMEOUT_MS);
}

export function enrichWaitResult(result: WaitForResult, timeoutMs: number = WAIT_DEFAULT_TIMEOUT_MS): WaitForResult | WaitToolError {
  if (result.met === false && result.error === "timeout") return timeoutResult(result, timeoutMs);
  if (result.met === false && result.error === "navigation-interrupted") return navigationInterruptedResult(result);
  if (result.met === false && result.error === "page-closed") return pageClosedResult(result);
  return result;
}

type DisconnectedWaitError = WaitToolError & { met: false; elapsedMs: number };
type RelayFailureWaitError = WaitToolError & { met: false; elapsedMs: number };

export function relayErrorToResult(response: { error?: string; data?: unknown }, startMs: number, timeoutMs: number = WAIT_DEFAULT_TIMEOUT_MS): WaitForResult | WaitToolError {
  const errCode = response.error ?? "timeout";
  if (errCode === "browser-not-connected") {
    return relayErrorResult("browser-not-connected", startMs);
  }
  if (response.data !== undefined) {
    return enrichWaitResult(response.data as WaitForResult, timeoutMs);
  }
  if (errCode === "navigation-interrupted" || errCode === "page-closed") {
    return enrichWaitResult({ met: false, error: errCode, elapsedMs: Date.now() - startMs }, timeoutMs);
  }
  if (errCode === "action-failed" || errCode === "no-content-script") {
    return relayFailureResult(errCode, startMs);
  }
  return enrichWaitResult({ met: false, error: "timeout", elapsedMs: Date.now() - startMs }, timeoutMs);
}

function relayErrorResult(code: "browser-not-connected", startMs: number): DisconnectedWaitError {
  return {
    success: false,
    met: false,
    error: code,
    errorCode: code,
    elapsedMs: Date.now() - startMs,
    retryable: true,
    retryAfterMs: getRelayRetryAfterMs(code),
    recoveryHints: getRelayRecoveryHint(code),
  };
}

function relayFailureResult(code: "action-failed" | "no-content-script", startMs: number): RelayFailureWaitError {
  return {
    success: false,
    met: false,
    error: code,
    errorCode: code,
    elapsedMs: Date.now() - startMs,
    retryable: true,
    retryAfterMs: getRelayRetryAfterMs(code),
    recoveryHints: getRelayRecoveryHint(code),
  };
}

export function relayThrownToError(err: unknown): WaitToolError {
  const code = classifyThrownRelayError(err);
  return {
    success: false,
    error: code,
    errorCode: code,
    retryable: true,
    retryAfterMs: getRelayRetryAfterMs(code),
    recoveryHints: getRelayRecoveryHint(code),
  };
}

function invalidRequest(recoveryHints: string): { ok: false; error: WaitToolError } {
  return { ok: false, error: { success: false, error: "invalid-request", errorCode: "invalid-request", retryable: false, recoveryHints } };
}

function timeoutResult(result: WaitForResult, timeoutMs: number): WaitForResult | WaitToolError {
  return {
    ...result,
    success: false,
    errorCode: "timeout",
    timeoutMs,
    retryable: true,
    retryAfterMs: getRelayRetryAfterMs("timeout"),
    recoveryHints: "The condition was not met within the timeout. Increase timeout or retry after the page has had more time to load.",
  };
}

function navigationInterruptedResult(result: WaitForResult): WaitForResult | WaitToolError {
  return {
    ...result,
    success: false,
    errorCode: "navigation-interrupted",
    retryable: true,
    retryAfterMs: 500,
    recoveryHints: "The page navigated during the wait. Wait for the new page to load, then retry wait_for on the new page.",
  };
}

function pageClosedResult(result: WaitForResult): WaitForResult | WaitToolError {
  return { ...result, success: false, errorCode: "page-closed", retryable: false, recoveryHints: "The tab was closed during the wait. Open a new tab and retry." };
}
