import type { BrowserRelayLike } from "./types.js";
import type { ListPagesArgs, ListPagesResponse, PageToolError, SelectPageArgs, SelectPageResponse, WaitForArgs } from "./page-tool-types.js";
import { classifyRelayError, TAB_MGMT_TIMEOUT_MS, WAIT_FOR_RELAY_TIMEOUT_MS } from "./page-tool-types.js";
import { getRelayRecoveryHint, getRelayRetryAfterMs } from "./relay-error-policy.js";

export async function handleWaitForInline(
  relay: BrowserRelayLike,
  args: WaitForArgs,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return {
      success: false,
      error: "browser-not-connected",
      retryable: true,
      retryAfterMs: getRelayRetryAfterMs("browser-not-connected"),
      recoveryHints: getRelayRecoveryHint("browser-not-connected"),
    };
  }
  try {
    const startMs = Date.now();
    const response = await relay.request("wait_for", args as Record<string, unknown>, WAIT_FOR_RELAY_TIMEOUT_MS);
    if (response.success && response.data !== undefined) {
      return response.data;
    }
    const errCode = response.error ?? "timeout";
    const elapsedMs = Date.now() - startMs;
    if (errCode === "navigation-interrupted" || errCode === "page-closed") {
      return { met: false, error: errCode, elapsedMs };
    }
    return response.data ?? {
      met: false,
      error: "timeout",
      elapsedMs,
      retryable: true,
      retryAfterMs: getRelayRetryAfterMs("timeout"),
    };
  } catch (err: unknown) {
    const code = classifyRelayError(err);
    if (code === "browser-not-connected") {
      return {
        success: false,
        error: code,
        retryable: true,
        retryAfterMs: getRelayRetryAfterMs(code),
        recoveryHints: getRelayRecoveryHint(code),
      };
    }
    return {
      success: false,
      error: code,
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
    return { success: false, error: "browser-not-connected", pageUrl: null };
  }
  try {
    const response = await relay.request("list_pages", args as Record<string, unknown>, TAB_MGMT_TIMEOUT_MS);
    if (response.success && response.data && typeof response.data === "object" && "pages" in response.data) {
      return response.data as ListPagesResponse;
    }
    return { success: false, error: "action-failed", pageUrl: null };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), pageUrl: null };
  }
}

export async function handleSelectPage(
  relay: BrowserRelayLike,
  args: SelectPageArgs,
): Promise<SelectPageResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", pageUrl: null };
  }
  try {
    const response = await relay.request("select_page", args as unknown as Record<string, unknown>, TAB_MGMT_TIMEOUT_MS);
    if (response.success && response.data && typeof response.data === "object" && "success" in response.data) {
      return response.data as SelectPageResponse;
    }
    return { success: false, error: response.error ?? "action-failed", pageUrl: null };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), pageUrl: null };
  }
}
