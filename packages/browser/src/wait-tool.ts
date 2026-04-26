/**
 * M109-WAIT — Wait For Condition MCP Tool
 *
 * Defines the `browser_wait_for` MCP tool that lets agents wait for
 * conditions on a live browser page — text appearance, CSS selector match,
 * or layout stability — with configurable timeout and clear error semantics.
 *
 * The tool handler forwards the request through the browser relay to the
 * Chrome extension's content script, which polls at 100ms intervals.
 * Navigation and tab-close events interrupt the wait with structured errors.
 *
 * Implements requirements B2-WA-001 through B2-WA-007.
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import {
  RELAY_TIMEOUT_MS,
  WAIT_DEFAULT_TIMEOUT_MS,
  WAIT_MAX_TIMEOUT_MS,
  type WaitForArgs,
  type WaitForResult,
  type WaitToolError,
} from "./wait-tool-contracts.js";
import { classifyThrownRelayError, getRelayRecoveryHint, getRelayRetryAfterMs } from "./relay-error-policy.js";
import { IMPLICIT_TARGET_TAB_DESCRIPTION } from "./tab-target-contract.js";

export {
  RELAY_TIMEOUT_MS,
  WAIT_DEFAULT_TIMEOUT_MS,
  WAIT_MAX_TIMEOUT_MS,
  type WaitForArgs,
  type WaitForResult,
  type WaitToolError,
} from "./wait-tool-contracts.js";

// ── Tool Definition ──────────────────────────────────────────────────────────

/**
 * Build the `browser_wait_for` tool definition.
 *
 * B2-WA-001..007: Registers a single tool that accepts text, selector,
 * and/or stableLayoutMs conditions with a configurable timeout.
 *
 * @param relay — The relay connection to the Chrome extension
 * @returns A single tool definition for `browser_wait_for`
 */
export function buildWaitForTool(
  relay: BrowserRelayLike,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_wait_for",
    description:
      "Wait for a condition on the current page — text appearance, CSS selector match, " +
      "or layout stability. Returns when the condition is met or timeout is reached.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: IMPLICIT_TARGET_TAB_DESCRIPTION,
        },
        texts: {
          type: "array",
          items: { type: "string" },
          description: "Wait for any of these text strings to appear on the page.",
        },
        selector: {
          type: "string",
          description: "Wait for a CSS selector to match at least one element.",
        },
        stableLayoutMs: {
          type: "number",
          description: "Wait until no layout changes occur for this many milliseconds.",
        },
        timeout: {
          type: "number",
          description: `Maximum wait time in ms (default: ${WAIT_DEFAULT_TIMEOUT_MS}, max: ${WAIT_MAX_TIMEOUT_MS}).`,
        },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleWaitFor(relay, args as WaitForArgs),
  };
}

// ── Tool Handler ─────────────────────────────────────────────────────────────

/**
 * Handler for `browser_wait_for`.
 *
 * Validates input, clamps timeout to [0, 30000], and forwards to the Chrome
 * relay's `wait_for` action. The content script runs a 100ms polling loop
 * and returns the result when a condition is met or timeout expires.
 *
 * B2-WA-001: Waits for text appearance.
 * B2-WA-002: Waits for selector match.
 * B2-WA-003: Waits for stable layout.
 * B2-WA-004: Configurable timeout (default 10000, max 30000).
 * B2-WA-005: Timeout error includes `elapsedMs` equal to timeout value.
 * B2-WA-006: Navigation interrupts return `navigation-interrupted`.
 * B2-WA-007: Page close interrupts return `page-closed`.
 *
 * @param relay — The relay connection to the Chrome extension
 * @param args — Tool input arguments
 * @returns Wait result or error
 */
export async function handleWaitFor(
  relay: BrowserRelayLike,
  args: WaitForArgs,
): Promise<WaitForResult | WaitToolError> {
  // B2-WA-004: Validate at least one condition is present
  const hasCondition =
    (args.texts !== undefined && args.texts.length > 0) ||
    args.selector !== undefined ||
    args.stableLayoutMs !== undefined;

  if (!hasCondition) {
    return {
      success: false,
      error: "invalid-request",
      retryable: false,
      recoveryHints: "Provide at least one of: texts, selector, or stableLayoutMs.",
    };
  }

  // B2-WA-004: Reject negative timeouts immediately
  if (args.timeout !== undefined && args.timeout < 0) {
    return {
      success: false,
      error: "invalid-request",
      retryable: false,
      recoveryHints: "timeout must be a non-negative number.",
    };
  }

  // B2-WA-004: Clamp timeout to [0, WAIT_MAX_TIMEOUT_MS], default to WAIT_DEFAULT_TIMEOUT_MS
  const rawTimeout = args.timeout ?? WAIT_DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(rawTimeout, WAIT_MAX_TIMEOUT_MS);
  const payload: Record<string, unknown> = { ...args, timeout: timeoutMs };

  const startMs = Date.now();
  try {
    const response = await relay.request("wait_for", payload, RELAY_TIMEOUT_MS);

    if (response.success && response.data !== undefined) {
      // B2-WA-001/002/003: Condition met — relay returns WaitForResult in data.
      // MCP-ER-002: Enrich timeout results with retryable and recoveryHints so
      // callers can act on structured recovery metadata without drilling into raw data.
      const result = response.data as WaitForResult;
      if (result.met === false && result.error === "timeout") {
        return {
          ...result,
          retryable: true,
          retryAfterMs: getRelayRetryAfterMs("timeout"),
          recoveryHints:
            "The condition was not met within the timeout. Increase the timeout value or " +
            "retry after the page has had more time to load. Use wait_for with a larger " +
            "`timeout` value, or check whether the expected text/selector will ever appear.",
        };
      }
      if (result.met === false && result.error === "navigation-interrupted") {
        return {
          ...result,
          retryable: true,
          retryAfterMs: 500,
          recoveryHints:
            "The page navigated during the wait. Wait for the new page to load, " +
            "then retry the wait_for on the new page.",
        };
      }
      if (result.met === false && result.error === "page-closed") {
        return {
          ...result,
          retryable: false,
          recoveryHints: "The tab was closed during the wait. Open a new tab and retry.",
        };
      }
      return result;
    }

    // B2-WA-005/006/007: Relay returned a structured failure
    const errCode = response.error ?? "timeout";
    if (errCode === "navigation-interrupted" || errCode === "page-closed") {
      return { met: false, error: errCode, elapsedMs: 0 };
    }

    // Timeout or other relay-level failure — pass through as WaitForResult
    return response.data as WaitForResult ?? {
      met: false,
      error: "timeout",
      elapsedMs: Date.now() - startMs,
      retryable: true,
      retryAfterMs: getRelayRetryAfterMs("timeout"),
    };
  } catch (err: unknown) {
    // Relay threw (e.g. browser not connected)
    const code = classifyThrownRelayError(err);
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
