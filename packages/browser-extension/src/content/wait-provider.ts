/**
 * M109-WAIT — Wait Provider facade
 *
 * @module
 */

import { waitForSelector, waitForStableLayout, waitForText } from "./wait-provider-conditions.js";
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, type WaitOptions, type WaitProvider, type WaitResult } from "./wait-provider-types.js";

export {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  POLL_INTERVAL_MS,
} from "./wait-provider-types.js";
export type { WaitOptions, WaitProvider, WaitResult } from "./wait-provider-types.js";
export { waitForSelector, waitForStableLayout, waitForText } from "./wait-provider-conditions.js";

export async function handleWaitForAction(
  payload: Record<string, unknown>,
): Promise<WaitResult | { error: string }> {
  const texts = Array.isArray(payload.texts) ? (payload.texts as string[]) : undefined;
  const selector = typeof payload.selector === "string" ? payload.selector : undefined;
  const stableLayoutMs = typeof payload.stableLayoutMs === "number" ? payload.stableLayoutMs : undefined;
  const rawTimeout = typeof payload.timeout === "number" ? payload.timeout : DEFAULT_TIMEOUT_MS;

  const hasCondition =
    (texts !== undefined && texts.length > 0) ||
    selector !== undefined ||
    stableLayoutMs !== undefined;

  if (!hasCondition) {
    return { error: "invalid-request" };
  }

  const timeoutMs = Math.min(Math.max(0, rawTimeout), MAX_TIMEOUT_MS);
  const controller = new AbortController();
  const options: WaitOptions = { timeoutMs, signal: controller.signal };
  const pending: Promise<WaitResult>[] = [];

  if (texts !== undefined && texts.length > 0) pending.push(waitForText(texts, options));
  if (selector !== undefined) pending.push(waitForSelector(selector, options));
  if (stableLayoutMs !== undefined) pending.push(waitForStableLayout(stableLayoutMs, options));

  const winner = await Promise.race(pending);
  controller.abort();
  return winner;
}
