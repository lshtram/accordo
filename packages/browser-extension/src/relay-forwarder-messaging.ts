import type { SnapshotEnvelope } from "./snapshot-versioning.js";
import { hasDataField, hasErrorField, isSnapshotEnvelope } from "./relay-type-guards.js";

export const NO_CONTENT_SCRIPT = Symbol("no-content-script");

const CONTENT_SCRIPT_RETRY_DELAYS_MS = [0, 50, 150] as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNoReceiverError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? String(err);
  return msg.includes("Receiving end does not exist") || msg.includes("Could not establish connection") || msg.includes("No tab with id");
}

export async function requestContentScriptEnvelope(
  source: "dom" | "visual",
  tabId?: number,
): Promise<SnapshotEnvelope> {
  const targetTabId = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (targetTabId === undefined) {
    throw new Error("no-active-tab");
  }

  const response = await chrome.tabs.sendMessage(
    targetTabId,
    { type: "CAPTURE_SNAPSHOT_ENVELOPE", source },
    { frameId: 0 },
  );
  if (isSnapshotEnvelope(response)) {
    return response;
  }
  throw new Error("content-script-envelope-unavailable");
}

export async function forwardToContentScript(
  tabId: number,
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown | null | typeof NO_CONTENT_SCRIPT> {
  let response: unknown;
  try {
    response = await chrome.tabs.sendMessage(tabId, { type: "PAGE_UNDERSTANDING_ACTION", action, payload });
  } catch (err) {
    if (isNoReceiverError(err)) return NO_CONTENT_SCRIPT;
    return null;
  }
  if (!response || hasErrorField(response)) return null;
  return hasDataField(response) ? response.data : response;
}

export async function forwardToFrame(
  tabId: number,
  frameId: number,
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown | null | typeof NO_CONTENT_SCRIPT> {
  let response: unknown;
  try {
    response = await chrome.tabs.sendMessage(tabId, { type: "PAGE_UNDERSTANDING_ACTION", action, payload }, { frameId });
  } catch (err) {
    if (isNoReceiverError(err)) return NO_CONTENT_SCRIPT;
    return null;
  }
  if (!response || hasErrorField(response)) return null;
  return hasDataField(response) ? response.data : response;
}

export async function forwardToMainFrame(
  tabId: number,
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown | null | typeof NO_CONTENT_SCRIPT> {
  return forwardToFrame(tabId, 0, action, payload);
}

export async function ensureContentScriptInjected(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content-script.js"] });
  try {
    await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: ["content-styles.css"] });
  } catch {
    // CSS is secondary
  }
}

export async function reinjectAndForwardToFrame(
  tabId: number,
  frameId: number,
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown | null | typeof NO_CONTENT_SCRIPT> {
  await ensureContentScriptInjected(tabId);
  for (const waitMs of CONTENT_SCRIPT_RETRY_DELAYS_MS) {
    if (waitMs > 0) await delay(waitMs);
    const result = await forwardToFrame(tabId, frameId, action, payload);
    if (result !== NO_CONTENT_SCRIPT) {
      return result;
    }
  }
  return NO_CONTENT_SCRIPT;
}
