import type { BrowserRelayLike } from "./types.js";
import type { ListPagesArgs, ListPagesResponse, PageToolError, SelectPageArgs, SelectPageResponse, WaitForArgs } from "./page-tool-types.js";
import { buildStructuredError, classifyRelayError, TAB_MGMT_TIMEOUT_MS, WAIT_FOR_RELAY_TIMEOUT_MS } from "./page-tool-types.js";
import { getRelayRecoveryHint, getRelayRetryAfterMs } from "./relay-error-policy.js";
import { clampTimeout, enrichWaitResult, relayErrorToResult } from "./wait-tool-runtime.js";
import type { WaitForResult } from "./wait-tool-contracts.js";

export async function handleWaitForInline(
  relay: BrowserRelayLike,
  args: WaitForArgs,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected");
  }
  try {
    const startMs = Date.now();
    const effectiveTimeout = clampTimeout(args.timeout);
    const response = await relay.request("wait_for", { ...args, timeout: effectiveTimeout } as Record<string, unknown>, WAIT_FOR_RELAY_TIMEOUT_MS);
    if (response.success && response.data !== undefined) {
      return enrichWaitResult(response.data as WaitForResult, effectiveTimeout);
    }
    return relayErrorToResult(response, startMs, effectiveTimeout);
  } catch (err: unknown) {
    const code = classifyRelayError(err);
    if (code === "browser-not-connected") {
      return {
        success: false,
        error: code,
        errorCode: code,
        retryable: true,
        retryAfterMs: getRelayRetryAfterMs(code),
        recoveryHints: getRelayRecoveryHint(code),
      };
    }
    return {
      success: false,
      error: code,
      errorCode: code,
      retryable: true,
      retryAfterMs: getRelayRetryAfterMs(code),
      recoveryHints: getRelayRecoveryHint(code),
    };
  }
}

export async function handleListPages(
  relay: BrowserRelayLike,
  args: ListPagesArgs,
): Promise<ListPagesResponse | PageToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected");
  }
  try {
    const response = await relay.request("list_pages", args as Record<string, unknown>, TAB_MGMT_TIMEOUT_MS);
    if (response.success && response.data && typeof response.data === "object" && "pages" in response.data) {
      return response.data as ListPagesResponse;
    }
    return buildStructuredError(response.error ?? "action-failed");
  } catch (err: unknown) {
    return buildStructuredError(classifyRelayError(err));
  }
}

export async function handleSelectPage(
  relay: BrowserRelayLike,
  args: SelectPageArgs,
): Promise<SelectPageResponse | PageToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected");
  }
  try {
    const response = await relay.request("select_page", args as unknown as Record<string, unknown>, TAB_MGMT_TIMEOUT_MS);
    if (response.success && response.data && typeof response.data === "object" && "success" in response.data) {
      return response.data as SelectPageResponse;
    }
    return buildStructuredError(response.error ?? "action-failed");
  } catch (err: unknown) {
    return buildStructuredError(classifyRelayError(err));
  }
}
