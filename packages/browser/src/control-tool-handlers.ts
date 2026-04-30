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
import { isMalformedFrameScopedUid, isMalformedSelector } from "./target-validation.js";
import { buildPermissionGuidance, withControlGuidance } from "./control-tool-guidance.js";

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
    return buildPermissionGuidance({ success: false, error: mapNavigateError(response.error) });
  } catch (err: unknown) {
    return buildPermissionGuidance({ success: false, error: mapNavigateError(classifyRelayError(err)) });
  }
}

export async function handleClick(
  relay: BrowserRelayLike,
  args: ClickArgs,
): Promise<ClickResponse> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  if (isMalformedFrameScopedUid(args.uid)) {
    return { success: false, error: "invalid-request", message: 'framed uid must use the format "{frameId}:{nodeId}".' };
  }
  if (!hasTargetString(args.uid) && args.coordinates === undefined && isMalformedSelector(args.selector)) {
    return { success: false, error: "invalid-request", message: "selector must be a valid CSS selector." };
  }
  try {
    const response = await relay.request("click", buildClickPayload(args), CONTROL_ACTION_TIMEOUT_MS);
    if (response.success) {
      return { success: true, target: clickTargetLabel(args) };
    }
    return withControlGuidance({ success: false, error: mapClickError(response.error) });
  } catch (err: unknown) {
    return withControlGuidance({ success: false, error: mapClickError(classifyRelayError(err)) });
  }
}

export async function handleType(
  relay: BrowserRelayLike,
  args: TypeArgs,
): Promise<TypeResponse> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  if (isMalformedFrameScopedUid(args.uid)) {
    return { success: false, error: "invalid-request", message: 'framed uid must use the format "{frameId}:{nodeId}".' };
  }
  if (!hasTargetString(args.uid) && isMalformedSelector(args.selector)) {
    return { success: false, error: "invalid-request", message: "selector must be a valid CSS selector." };
  }
  try {
    const response = await relay.request("type", buildTypePayload(args), CONTROL_ACTION_TIMEOUT_MS);
    if (response.success) {
      return { success: true };
    }
    return withControlGuidance({ success: false, error: mapTypeError(response.error) });
  } catch (err: unknown) {
    return withControlGuidance({ success: false, error: mapTypeError(classifyRelayError(err)) });
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
    return buildPermissionGuidance({ success: false, error: mapPressKeyError(response.error) });
  } catch (err: unknown) {
    return buildPermissionGuidance({ success: false, error: mapPressKeyError(classifyRelayError(err)) });
  }
}

function buildClickPayload(args: ClickArgs): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (args.tabId !== undefined) payload["tabId"] = args.tabId;
  if (hasTargetString(args.uid)) payload["uid"] = args.uid;
  else if (args.coordinates !== undefined) payload["coordinates"] = args.coordinates;
  else if (hasTargetString(args.selector) && !isMalformedSelector(args.selector)) payload["selector"] = args.selector;
  if (args.dblClick !== undefined) payload["dblClick"] = args.dblClick;
  return payload;
}

function clickTargetLabel(args: ClickArgs): string | undefined {
  if (hasTargetString(args.uid)) return args.uid;
  if (args.coordinates !== undefined) return `${args.coordinates.x},${args.coordinates.y}`;
  if (hasTargetString(args.selector) && !isMalformedSelector(args.selector)) return args.selector;
  return undefined;
}

function buildTypePayload(args: TypeArgs): Record<string, unknown> {
  const payload: Record<string, unknown> = { text: args.text };
  if (args.tabId !== undefined) payload["tabId"] = args.tabId;
  if (hasTargetString(args.uid)) payload["uid"] = args.uid;
  else if (hasTargetString(args.selector)) payload["selector"] = args.selector;
  if (args.clearFirst !== undefined) payload["clearFirst"] = args.clearFirst;
  if (args.submitKey !== undefined) payload["submitKey"] = args.submitKey;
  return payload;
}

function hasTargetString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
