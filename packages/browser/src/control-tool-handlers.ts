import type { BrowserRelayLike } from "./types.js";
import { classifyRelayError } from "./page-tool-types.js";
import {
  CONTROL_ACTION_TIMEOUT_MS,
  NAVIGATE_RELAY_TIMEOUT_MS,
  type ClickArgs,
  type ClickResponse,
  type NavigateArgs,
  type NavigateResponse,
  type PressKeyArgs,
  type PressKeyResponse,
  type TypeArgs,
  type TypeResponse,
} from "./control-tool-contracts.js";
import { mapClickError, mapNavigateError, mapPressKeyError, mapTypeError } from "./control-tool-error-mapping.js";

export async function handleNavigate(
  relay: BrowserRelayLike,
  args: NavigateArgs,
): Promise<NavigateResponse> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const payload: Record<string, unknown> = {};
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;
    if (args.type !== undefined) payload["type"] = args.type;
    if (args.url !== undefined) payload["url"] = args.url;
    if (args.timeout !== undefined) payload["timeout"] = args.timeout;
    if (args.waitUntil !== undefined) payload["waitUntil"] = args.waitUntil;

    const response = await relay.request("navigate", payload, NAVIGATE_RELAY_TIMEOUT_MS);
    if (response.success && response.data && typeof response.data === "object") {
      const d = response.data as Record<string, unknown>;
      return {
        success: true,
        url: d.url as string | undefined,
        title: d.title as string | undefined,
        readyState: d.readyState as NavigateResponse["readyState"],
      };
    }
    return { success: false, error: mapNavigateError(response.error) };
  } catch (err: unknown) {
    return { success: false, error: mapNavigateError(classifyRelayError(err)) };
  }
}

export async function handleClick(
  relay: BrowserRelayLike,
  args: ClickArgs,
): Promise<ClickResponse> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const payload: Record<string, unknown> = {};
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;
    if (args.uid !== undefined) payload["uid"] = args.uid;
    if (args.selector !== undefined) payload["selector"] = args.selector;
    if (args.coordinates !== undefined && args.uid === undefined && args.selector === undefined) {
      payload["coordinates"] = args.coordinates;
    }
    if (args.dblClick !== undefined) payload["dblClick"] = args.dblClick;

    const response = await relay.request("click", payload, CONTROL_ACTION_TIMEOUT_MS);
    if (response.success) {
      return { success: true, target: args.uid ?? args.selector ?? (args.coordinates ? `${args.coordinates.x},${args.coordinates.y}` : undefined) };
    }
    return { success: false, error: mapClickError(response.error) };
  } catch (err: unknown) {
    return { success: false, error: mapClickError(classifyRelayError(err)) };
  }
}

export async function handleType(
  relay: BrowserRelayLike,
  args: TypeArgs,
): Promise<TypeResponse> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const payload: Record<string, unknown> = { text: args.text };
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;
    if (args.uid !== undefined) payload["uid"] = args.uid;
    if (args.selector !== undefined) payload["selector"] = args.selector;
    if (args.clearFirst !== undefined) payload["clearFirst"] = args.clearFirst;
    if (args.submitKey !== undefined) payload["submitKey"] = args.submitKey;

    const response = await relay.request("type", payload, CONTROL_ACTION_TIMEOUT_MS);
    if (response.success) {
      return { success: true };
    }
    return { success: false, error: mapTypeError(response.error) };
  } catch (err: unknown) {
    return { success: false, error: mapTypeError(classifyRelayError(err)) };
  }
}

export async function handlePressKey(
  relay: BrowserRelayLike,
  args: PressKeyArgs,
): Promise<PressKeyResponse> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const payload: Record<string, unknown> = { key: args.key };
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;

    const response = await relay.request("press_key", payload, CONTROL_ACTION_TIMEOUT_MS);
    if (response.success) {
      return { success: true, key: args.key };
    }
    return { success: false, error: mapPressKeyError(response.error) };
  } catch (err: unknown) {
    return { success: false, error: mapPressKeyError(classifyRelayError(err)) };
  }
}
