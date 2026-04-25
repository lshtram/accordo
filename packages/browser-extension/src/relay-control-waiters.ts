export type WaitUntil = "load" | "domcontentloaded" | "networkidle";

const NAVIGATE_DEFAULT_TIMEOUT_MS = 15_000;
const NAVIGATE_MAX_TIMEOUT_MS = 30_000;

export function getNavigateTimeoutMs(payload: Record<string, unknown>): number {
  const requested = payload.timeout;
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return NAVIGATE_DEFAULT_TIMEOUT_MS;
  }

  return Math.min(Math.max(0, requested), NAVIGATE_MAX_TIMEOUT_MS);
}

export function toLifecycleEventName(waitUntil: WaitUntil): string {
  switch (waitUntil) {
    case "load":
      return "load";
    case "networkidle":
      return "networkIdle";
    case "domcontentloaded":
    default:
      return "DOMContentLoaded";
  }
}

export function createFrameNavigatedWaiter(tabId: number, timeoutMs: number): { promise: Promise<void>; cancel: () => void } {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  type DebuggerEventListener = (source: chrome.debugger.Debuggee, method: string, params?: Object) => void;

  const listener: DebuggerEventListener = (source, method, params) => {
    const p = params as Record<string, unknown> | undefined;
    const frame = p?.frame as Record<string, unknown> | undefined;
    const isMainFrame = frame !== undefined && frame.parentId === undefined;

    if (!settled && method === "Page.frameNavigated" && (source as { tabId?: number }).tabId === tabId && isMainFrame) {
      settled = true;
      if (timer) clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(listener);
      resolveRef?.();
    }
  };

  let resolveRef: (() => void) | undefined;

  const promise = new Promise<void>((resolve, reject) => {
    resolveRef = resolve;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.debugger.onEvent.removeListener(listener);
      reject(new Error("Page.frameNavigated timed out"));
    }, timeoutMs);

    chrome.debugger.onEvent.addListener(listener);
  });

  return {
    promise,
    cancel: (): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(listener);
    },
  };
}

export function createLifecycleWaiter(tabId: number, eventName: string, mainFrameId: string, timeoutMs: number): { promise: Promise<void>; cancel: () => void } {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  type DebuggerEventListener = (source: chrome.debugger.Debuggee, method: string, params?: Object) => void;

  const listener: DebuggerEventListener = (source, method, params) => {
    const p = params as Record<string, unknown> | undefined;
    const frameIdMatches = (params as Record<string, unknown>)?.frameId === mainFrameId;
    if (!settled && method === "Page.lifecycleEvent" && (source as { tabId?: number }).tabId === tabId && p?.name === eventName && frameIdMatches) {
      settled = true;
      if (timer) clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(listener);
      resolveRef?.();
    }
  };

  let resolveRef: (() => void) | undefined;

  const promise = new Promise<void>((resolve, reject) => {
    resolveRef = resolve;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.debugger.onEvent.removeListener(listener);
      reject(new Error(`waitUntil ${eventName} timed out`));
    }, timeoutMs);

    chrome.debugger.onEvent.addListener(listener);
  });

  return {
    promise,
    cancel: (): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(listener);
    },
  };
}
