import { getRelayRecoveryHint, getRelayRetryAfterMs, classifyThrownRelayError } from "./relay-error-policy.js";
import { WAIT_DEFAULT_TIMEOUT_MS, WAIT_MAX_TIMEOUT_MS, type WaitForArgs, type WaitForResult, type WaitToolError } from "./wait-tool-contracts.js";

export function validateWaitArgs(args: WaitForArgs): { ok: true } | { ok: false; error: WaitToolError } {
  const hasCondition = (args.texts !== undefined && args.texts.length > 0) || args.selector !== undefined || args.stableLayoutMs !== undefined;
  if (!hasCondition) return invalidRequest("Provide at least one of: texts, selector, or stableLayoutMs.");
  if (args.timeout !== undefined && args.timeout < 0) return invalidRequest("timeout must be a non-negative number.");
  return { ok: true };
}

export function clampTimeout(rawTimeout: number | undefined): number {
  return Math.min(rawTimeout ?? WAIT_DEFAULT_TIMEOUT_MS, WAIT_MAX_TIMEOUT_MS);
}

export function enrichWaitResult(result: WaitForResult): WaitForResult | WaitToolError {
  if (result.met === false && result.error === "timeout") return timeoutResult(result);
  if (result.met === false && result.error === "navigation-interrupted") return navigationInterruptedResult(result);
  if (result.met === false && result.error === "page-closed") return pageClosedResult(result);
  return result;
}

export function relayErrorToResult(response: { error?: string; data?: unknown }, startMs: number): WaitForResult {
  const errCode = response.error ?? "timeout";
  if (errCode === "navigation-interrupted" || errCode === "page-closed") return { met: false, error: errCode, elapsedMs: 0 };
  return (response.data as WaitForResult) ?? {
    met: false,
    error: "timeout",
    elapsedMs: Date.now() - startMs,
    retryable: true,
    retryAfterMs: getRelayRetryAfterMs("timeout"),
  };
}

export function relayThrownToError(err: unknown): WaitToolError {
  const code = classifyThrownRelayError(err);
  return {
    success: false,
    error: code,
    retryable: true,
    retryAfterMs: getRelayRetryAfterMs(code),
    recoveryHints: getRelayRecoveryHint(code),
  };
}

function invalidRequest(recoveryHints: string): { ok: false; error: WaitToolError } {
  return { ok: false, error: { success: false, error: "invalid-request", retryable: false, recoveryHints } };
}

function timeoutResult(result: WaitForResult): WaitForResult | WaitToolError {
  return {
    ...result,
    retryable: true,
    retryAfterMs: getRelayRetryAfterMs("timeout"),
    recoveryHints: "The condition was not met within the timeout. Increase timeout or retry after the page has had more time to load.",
  };
}

function navigationInterruptedResult(result: WaitForResult): WaitForResult | WaitToolError {
  return {
    ...result,
    retryable: true,
    retryAfterMs: 500,
    recoveryHints: "The page navigated during the wait. Wait for the new page to load, then retry wait_for on the new page.",
  };
}

function pageClosedResult(result: WaitForResult): WaitForResult | WaitToolError {
  return { ...result, retryable: false, recoveryHints: "The tab was closed during the wait. Open a new tab and retry." };
}
