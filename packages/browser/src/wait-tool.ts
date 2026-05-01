import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import { RELAY_TIMEOUT_MS, WAIT_DEFAULT_TIMEOUT_MS, WAIT_MAX_TIMEOUT_MS, type WaitForArgs, type WaitForResult, type WaitToolError } from "./wait-tool-contracts.js";
import { IMPLICIT_TARGET_TAB_DESCRIPTION } from "./tab-target-contract.js";
import { clampTimeout, enrichWaitResult, normalizeWaitArgs, relayErrorToResult, relayThrownToError, validateWaitArgs } from "./wait-tool-runtime.js";

export { RELAY_TIMEOUT_MS, WAIT_DEFAULT_TIMEOUT_MS, WAIT_MAX_TIMEOUT_MS, type WaitForArgs, type WaitForResult, type WaitToolError } from "./wait-tool-contracts.js";

export function buildWaitForTool(relay: BrowserRelayLike): ExtensionToolDefinition {
  return {
    name: "accordo_browser_wait_for",
    description:
      "Wait for a condition on the current page — text appearance, CSS selector match, " +
      "or layout stability. Returns when the condition is met or timeout is reached.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: IMPLICIT_TARGET_TAB_DESCRIPTION },
        texts: { type: "array", items: { type: "string" }, description: "Wait for any of these text strings to appear on the page." },
        selector: { type: "string", description: "Wait for a CSS selector to match at least one element." },
        stableLayoutMs: { type: "number", description: "Wait until no layout changes occur for this many milliseconds." },
        timeout: { type: "number", description: `Maximum wait time in ms (default: ${WAIT_DEFAULT_TIMEOUT_MS}, max: ${WAIT_MAX_TIMEOUT_MS}).` },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleWaitFor(relay, args as WaitForArgs),
  };
}

export async function handleWaitFor(relay: BrowserRelayLike, args: WaitForArgs): Promise<WaitForResult | WaitToolError> {
  const validation = validateWaitArgs(args);
  if (!validation.ok) return validation.error;
  const normalizedArgs = normalizeWaitArgs(args);
  const payload: Record<string, unknown> = { ...normalizedArgs, timeout: clampTimeout(normalizedArgs.timeout) };
  const startMs = Date.now();
  try {
    const response = await relay.request("wait_for", payload, RELAY_TIMEOUT_MS);
    if (response.success && response.data !== undefined) return enrichWaitResult(response.data as WaitForResult, payload.timeout as number);
    return relayErrorToResult(response, startMs, payload.timeout as number);
  } catch (err: unknown) {
    return relayThrownToError(err);
  }
}
