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

// ── Constants ────────────────────────────────────────────────────────────────

/** Default timeout for wait operations (ms). B2-WA-004. */
export const WAIT_DEFAULT_TIMEOUT_MS = 10_000;

/** Maximum allowed timeout for wait operations (ms). B2-WA-004. */
export const WAIT_MAX_TIMEOUT_MS = 30_000;

/**
 * Relay-level timeout for the wait_for action.
 *
 * This MUST be larger than WAIT_MAX_TIMEOUT_MS to ensure the relay
 * does not time out before the content script's polling loop completes.
 * The extra headroom accounts for relay serialization and transport latency.
 */
export const RELAY_TIMEOUT_MS = WAIT_MAX_TIMEOUT_MS + 5_000;

// ── Tool Input Type ──────────────────────────────────────────────────────────

/**
 * Input for `browser_wait_for`.
 *
 * At least one condition parameter (`texts`, `selector`, or `stableLayoutMs`)
 * MUST be provided. If multiple are provided, the first one met wins.
 *
 * B2-WA-001: `texts` — wait for any text string to appear.
 * B2-WA-002: `selector` — wait for CSS selector to match.
 * B2-WA-003: `stableLayoutMs` — wait for layout stability.
 * B2-WA-004: `timeout` — configurable, default 10000, max 30000.
 */
export interface WaitForArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** B2-WA-001: Wait for any of these text strings to appear on the page. */
  texts?: string[];
  /** B2-WA-002: Wait for a CSS selector to match at least one element. */
  selector?: string;
  /** B2-WA-003: Wait until no layout changes occur for this many ms. */
  stableLayoutMs?: number;
  /** B2-WA-004: Maximum wait time in ms (default: 10000, max: 30000). */
  timeout?: number;
}

// ── Tool Result Types ────────────────────────────────────────────────────────

/**
 * Error codes for wait operations.
 *
 * B2-WA-005: `"timeout"` — condition not met within timeout.
 * B2-WA-006: `"navigation-interrupted"` — page navigated during wait.
 * B2-WA-007: `"page-closed"` — tab closed during wait.
 */
export type WaitError = "timeout" | "navigation-interrupted" | "page-closed";

/**
 * Successful or timed-out result from `browser_wait_for`.
 *
 * Token budget: 30–50 tokens (minimal response).
 */
export interface WaitForResult {
  /** Whether the condition was met before timeout. */
  met: boolean;
  /** Which condition was met (for texts: the matched text; for selector: the selector; for stableLayout: "stable-layout"). */
  matchedCondition?: string;
  /** How long the wait took in ms. B2-WA-005: equals timeout value on timeout. */
  elapsedMs: number;
  /** Error code if condition was not met. */
  error?: WaitError;
}

/**
 * Error response from the wait tool (relay-level failures).
 */
export interface WaitToolError {
  success: false;
  error: "browser-not-connected" | "timeout" | "action-failed" | "invalid-request";
}

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
          description: "B2-CTX-001: Optional tab ID to target; omit for active tab",
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
          description: "Maximum wait time in ms (default: 10000, max: 30000).",
        },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleWaitFor(relay, args as WaitForArgs),
  };
}

// ── Helper ───────────────────────────────────────────────────────────────────

/** Classify relay error messages into structured error codes. */
function classifyRelayError(err: unknown): "timeout" | "browser-not-connected" {
  if (err instanceof Error) {
    if (err.message.includes("not-connected") || err.message.includes("disconnected")) {
      return "browser-not-connected";
    }
    return "timeout";
  }
  return "timeout";
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
    return { success: false, error: "invalid-request" };
  }

  // B2-WA-004: Reject negative timeouts immediately
  if (args.timeout !== undefined && args.timeout < 0) {
    return { success: false, error: "invalid-request" };
  }

  // B2-WA-004: Clamp timeout to [0, WAIT_MAX_TIMEOUT_MS], default to WAIT_DEFAULT_TIMEOUT_MS
  const rawTimeout = args.timeout ?? WAIT_DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(rawTimeout, WAIT_MAX_TIMEOUT_MS);

  try {
    const response = await relay.request("wait_for", args as Record<string, unknown>, RELAY_TIMEOUT_MS);

    if (response.success && response.data !== undefined) {
      // B2-WA-001/002/003: Condition met — relay returns WaitForResult in data
      return response.data as WaitForResult;
    }

    // B2-WA-005/006/007: Relay returned a structured failure
    const errCode = response.error ?? "timeout";
    if (errCode === "navigation-interrupted" || errCode === "page-closed") {
      return { met: false, error: errCode, elapsedMs: 0 };
    }

    // Timeout or other relay-level failure — pass through as WaitForResult
    return response.data as WaitForResult ?? { met: false, error: "timeout", elapsedMs: timeoutMs };
  } catch (err: unknown) {
    // Relay threw (e.g. browser not connected)
    return { success: false, error: classifyRelayError(err) };
  }
}
