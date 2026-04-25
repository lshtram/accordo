const CDP_PROTOCOL_VERSION = "1.3";

/**
 * Internal set of attached tab IDs.
 */
export const attachedTabs = new Set<number>();

/**
 * Registry of onDetach listeners per tabId.
 */
const detachListeners = new Map<number, Array<(source: chrome.debugger.Debuggee, reason: string) => void>>();

/**
 * Tracks tabs currently being detached to prevent re-entrant calls.
 */
export const detachingTabs = new Set<number>();

export function getDebuggerProtocolVersion(): string {
  return CDP_PROTOCOL_VERSION;
}

export function removeDetachListeners(tabId: number): void {
  const listeners = detachListeners.get(tabId);
  if (!listeners) return;

  listeners.forEach((listener) => {
    try {
      chrome.debugger.onDetach.removeListener(listener);
    } catch {
      // Ignore removal errors
    }
  });

  detachListeners.delete(tabId);
}

export async function canUseDebuggerSession(tabId: number): Promise<boolean> {
  try {
    await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", { expression: "1", returnByValue: true });
    return true;
  } catch {
    return false;
  }
}

export function registerDetachListener(tabId: number): void {
  removeDetachListeners(tabId);

  const listener = (source: chrome.debugger.Debuggee, _reason: string): void => {
    if (source.tabId === tabId) {
      attachedTabs.delete(tabId);
      removeDetachListeners(tabId);
    }
  };

  chrome.debugger.onDetach.addListener(listener);
  detachListeners.set(tabId, [listener]);
}
