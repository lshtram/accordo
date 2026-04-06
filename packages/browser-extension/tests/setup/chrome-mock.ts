/**
 * Chrome Extension API mock for Vitest.
 *
 * Provides in-memory implementations of all Chrome APIs used by the extension.
 * Mounted on the global `chrome` object before each test file runs.
 *
 * Storage uses an in-memory Map to simulate chrome.storage.local.
 * All other APIs use vi.fn() stubs.
 */

import { vi } from "vitest";

// ── WebSocket mock ────────────────────────────────────────────────────────────
// Prevent RelayBridgeClient.start() from connecting to the real relay server
// (ws://127.0.0.1:40111) when service-worker.ts is imported in tests.
// Without this, every CREATE_THREAD test that doesn't explicitly mock
// RelayBridgeClient.prototype.send would forward real create_comment calls
// through to the running VSCode extension, polluting .accordo/comments.json.

class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState: number = MockWebSocket.CLOSED;
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(url: string) {
    super();
    this.url = url;
    // Never connect — stay CLOSED
  }

  send(_data: string | ArrayBuffer | Blob | ArrayBufferView): void {
    // No-op — not connected
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
}

(globalThis as unknown as Record<string, unknown>)["WebSocket"] = MockWebSocket;

// ── In-memory storage ────────────────────────────────────────────────────────

const storageMap = new Map<string, unknown>();

/** Creates a fresh storage mock with new vi.fn() implementations. */
function createStorageMock() {
  return {
    session: {
      get: vi.fn(
        (
          keys: string | string[] | Record<string, unknown> | null,
          callback?: (items: Record<string, unknown>) => void
        ): Promise<Record<string, unknown>> => {
          const result: Record<string, unknown> = {};

          if (keys === null || keys === undefined) {
            storageMap.forEach((value, key) => {
              result[key] = value;
            });
          } else if (typeof keys === "string") {
            if (storageMap.has(keys)) {
              result[keys] = storageMap.get(keys);
            }
          } else if (Array.isArray(keys)) {
            keys.forEach((key) => {
              if (storageMap.has(key)) {
                result[key] = storageMap.get(key);
              }
            });
          } else {
            Object.entries(keys).forEach(([key, defaultValue]) => {
              result[key] = storageMap.has(key) ? storageMap.get(key) : defaultValue;
            });
          }

          if (callback) callback(result);
          return Promise.resolve(result);
        }
      ),

      set: vi.fn(
        (
          items: Record<string, unknown>,
          callback?: () => void
        ): Promise<void> => {
          Object.entries(items).forEach(([key, value]) => {
            storageMap.set(key, value);
          });
          if (callback) callback();
          return Promise.resolve();
        }
      ),

      remove: vi.fn(
        (
          keys: string | string[],
          callback?: () => void
        ): Promise<void> => {
          const keyArray = Array.isArray(keys) ? keys : [keys];
          keyArray.forEach((key) => storageMap.delete(key));
          if (callback) callback();
          return Promise.resolve();
        }
      ),

      clear: vi.fn((callback?: () => void): Promise<void> => {
        storageMap.clear();
        if (callback) callback();
        return Promise.resolve();
      }),
    },

    local: {
      get: vi.fn(
        (
          keys: string | string[] | Record<string, unknown> | null,
          callback?: (items: Record<string, unknown>) => void
        ): Promise<Record<string, unknown>> => {
          const result: Record<string, unknown> = {};

          if (keys === null || keys === undefined) {
            storageMap.forEach((value, key) => {
              result[key] = value;
            });
          } else if (typeof keys === "string") {
            if (storageMap.has(keys)) {
              result[keys] = storageMap.get(keys);
            }
          } else if (Array.isArray(keys)) {
            keys.forEach((key) => {
              if (storageMap.has(key)) {
                result[key] = storageMap.get(key);
              }
            });
          } else {
            Object.entries(keys).forEach(([key, defaultValue]) => {
              result[key] = storageMap.has(key) ? storageMap.get(key) : defaultValue;
            });
          }

          if (callback) callback(result);
          return Promise.resolve(result);
        }
      ),

      set: vi.fn(
        (
          items: Record<string, unknown>,
          callback?: () => void
        ): Promise<void> => {
          Object.entries(items).forEach(([key, value]) => {
            storageMap.set(key, value);
          });
          if (callback) callback();
          return Promise.resolve();
        }
      ),

      remove: vi.fn(
        (
          keys: string | string[],
          callback?: () => void
        ): Promise<void> => {
          const keyArray = Array.isArray(keys) ? keys : [keys];
          keyArray.forEach((key) => storageMap.delete(key));
          if (callback) callback();
          return Promise.resolve();
        }
      ),

      clear: vi.fn((callback?: () => void): Promise<void> => {
        storageMap.clear();
        if (callback) callback();
        return Promise.resolve();
      }),

      getBytesInUse: vi.fn(
        (_keys: string | string[] | null, callback?: (bytesInUse: number) => void): Promise<number> => {
          const bytes = 0;
          if (callback) callback(bytes);
          return Promise.resolve(bytes);
        }
      ),
    },

    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
    },
  };
}

// ── Tabs mock ────────────────────────────────────────────────────────────────

/** Tab registry for mock: maps tabId → url. Tests can populate via setMockTabUrl(). */
export const mockTabUrls = new Map<number, string>();

/**
 * Register a URL for a mock tab so captureScreenshot can look it up.
 * Call this in tests before calling captureScreenshot(tabId).
 */
export function setMockTabUrl(tabId: number, url: string): void {
  mockTabUrls.set(tabId, url);
}

/** Creates a fresh tabs mock with new vi.fn() implementations. */
function createTabsMock() {
  return {
    query: vi.fn(
      (
        queryInfo: chrome.tabs.QueryInfo,
        callback?: (result: chrome.tabs.Tab[]) => void
      ): Promise<chrome.tabs.Tab[]> => {
        // If querying for active tab, return the tab registered via setMockTabUrl
        const result: chrome.tabs.Tab[] = [];
        if ((queryInfo as Record<string, unknown>).active) {
          // Return first registered tab as active
          for (const [id, url] of mockTabUrls.entries()) {
            result.push({ id, url, active: true, index: 0, windowId: 1, highlighted: false, pinned: false, incognito: false } as chrome.tabs.Tab);
            break;
          }
          // If no tabs registered, return a default active tab
          if (result.length === 0) {
            result.push({ id: 1, url: "https://example.com", active: true, index: 0, windowId: 1, highlighted: false, pinned: false, incognito: false } as chrome.tabs.Tab);
          }
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      }
    ),

    get: vi.fn(
      (
        tabId: number,
        callback?: (tab: chrome.tabs.Tab) => void
      ): Promise<chrome.tabs.Tab> => {
        const url = mockTabUrls.get(tabId) ?? "https://example.com/page";
        const tab = { id: tabId, url, active: true, index: 0, windowId: 1, highlighted: false, pinned: false, incognito: false } as chrome.tabs.Tab;
        if (callback) callback(tab);
        return Promise.resolve(tab);
      }
    ),

    update: vi.fn(
      (
        tabId: number,
        _updateProperties: { active?: boolean; url?: string; pinned?: boolean },
        callback?: (tab: chrome.tabs.Tab) => void
      ): Promise<chrome.tabs.Tab> => {
        const url = mockTabUrls.get(tabId) ?? "https://example.com/page";
        const tab = { id: tabId, url, active: true, index: 0, windowId: 1, highlighted: false, pinned: false, incognito: false } as chrome.tabs.Tab;
        if (callback) callback(tab);
        return Promise.resolve(tab);
      }
    ),

    captureVisibleTab: vi.fn(
      (
        _windowId?: number,
        _options?: chrome.tabs.CaptureVisibleTabOptions,
        callback?: (dataUrl: string) => void
      ): Promise<string> => {
        const dataUrl = "data:image/jpeg;base64,mockScreenshotData";
        if (callback) callback(dataUrl);
        return Promise.resolve(dataUrl);
      }
    ),

    sendMessage: vi.fn(
      (
        _tabId: number,
        message: unknown,
        callback?: (response: unknown) => void
      ): Promise<unknown> => {
        // Return sensible defaults based on message type so handlers can succeed
        let response: unknown = undefined;
        const msg = message as Record<string, unknown> | undefined;
        if (msg?.type === "RESOLVE_ANCHOR_BOUNDS") {
          response = { bounds: { x: 10, y: 10, width: 100, height: 50 } };
        } else if (msg?.type === "CAPTURE_SNAPSHOT_ENVELOPE") {
          response = {
            snapshotId: "mock-page:1",
            pageId: "mock-page",
            frameId: "main",
            capturedAt: new Date().toISOString(),
            source: msg.source ?? "dom",
            viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          };
        }
        if (callback) callback(response);
        return Promise.resolve(response);
      }
    ),
  };
}

// ── Context menus mock ───────────────────────────────────────────────────────

/** Creates a fresh context menus mock with new vi.fn() implementations. */
function createContextMenusMock() {
  return {
    create: vi.fn(
      (
        _createProperties: chrome.contextMenus.CreateProperties,
        callback?: () => void
      ): string | number => {
        if (callback) callback();
        return "menu-item-id";
      }
    ),

    removeAll: vi.fn((callback?: () => void): Promise<void> => {
      if (callback) callback();
      return Promise.resolve();
    }),

    remove: vi.fn(
      (
        _menuItemId: string | number,
        callback?: () => void
      ): Promise<void> => {
        if (callback) callback();
        return Promise.resolve();
      }
    ),

    onClicked: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
    },
  };
}

// ── Action mock ──────────────────────────────────────────────────────────────

/** Creates a fresh action mock with new vi.fn() implementations. */
function createActionMock() {
  return {
    setBadgeText: vi.fn(
      (
        _details: { text: string; tabId?: number },
        callback?: () => void
      ): Promise<void> => {
        if (callback) callback();
        return Promise.resolve();
      }
    ),

    setBadgeBackgroundColor: vi.fn(
      (
        _details: { color: string | [number, number, number, number]; tabId?: number },
        callback?: () => void
      ): Promise<void> => {
        if (callback) callback();
        return Promise.resolve();
      }
    ),

    setTitle: vi.fn(
      (
        _details: { title: string; tabId?: number },
        callback?: () => void
      ): Promise<void> => {
        if (callback) callback();
        return Promise.resolve();
      }
    ),

    onClicked: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
    },
  };
}

// ── Runtime mock ─────────────────────────────────────────────────────────────

/** Listener registry shared across runtime mock instances. */
const runtimeListeners: Array<
  (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void
> = [];

/** Creates a fresh runtime mock with new vi.fn() implementations. */
function createRuntimeMock() {
  return {
    onMessage: {
      addListener: vi.fn(
        (
          listener: (
            message: unknown,
            sender: unknown,
            sendResponse: (response: unknown) => void
          ) => void
        ) => {
          runtimeListeners.push(listener);
        }
      ),
      removeListener: vi.fn((listener: unknown) => {
        const idx = runtimeListeners.indexOf(
          listener as (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void
        );
        if (idx !== -1) runtimeListeners.splice(idx, 1);
      }),
      hasListener: vi.fn(() => false),
    },

    sendMessage: vi.fn(
      (
        _message: unknown,
        callback?: (response: unknown) => void
      ): Promise<unknown> => {
        if (callback) callback(undefined);
        return Promise.resolve(undefined);
      }
    ),

    onInstalled: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
    },

    lastError: undefined as chrome.runtime.LastError | undefined,
  };
}

// ── Scripting mock ───────────────────────────────────────────────────────────

/** Creates a fresh scripting mock with new vi.fn() implementations. */
function createScriptingMock() {
  return {
    executeScript: vi.fn(
      (_injection: chrome.scripting.ScriptInjection<unknown[], unknown>): Promise<chrome.scripting.InjectionResult<unknown>[]> => {
        return Promise.resolve([]);
      }
    ),
  };
}

// ── Commands mock ────────────────────────────────────────────────────────────

/** Creates a fresh commands mock with new vi.fn() implementations. */
function createCommandsMock() {
  return {
    onCommand: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
    },
  };
}

// ── WebNavigation mock ──────────────────────────────────────────────────────

/** Creates a fresh webNavigation mock with new vi.fn() implementations. */
function createWebNavigationMock() {
  return {
    getAllFrames: vi.fn(async () => []),
    onCommitted: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
    },
  };
}

// ── Debugger mock ─────────────────────────────────────────────────────────────

/** Set of tab IDs currently attached via chrome.debugger. */
export const debuggerAttachedTabs = new Set<number>();

/** Detach listener registry. */
const debuggerDetachListeners: Array<(source: chrome.debugger.Debuggee, reason: string) => void> = [];
/** Debugger event listener registry. */
const debuggerEventListeners: Array<(source: chrome.debugger.Debuggee, method: string, params?: Record<string, unknown>) => void> = [];

/** Creates a fresh debugger mock with new vi.fn() implementations. */
function createDebuggerMock() {
  return {
    attach: vi.fn(
      (target: chrome.debugger.Debuggee, _requiredVersion: string, callback?: () => void): Promise<void> => {
        if (target.tabId !== undefined) {
          debuggerAttachedTabs.add(target.tabId);
        }
        if (callback) callback();
        return Promise.resolve();
      }
    ),

    detach: vi.fn(
      (target: chrome.debugger.Debuggee, callback?: () => void): Promise<void> => {
        if (target.tabId !== undefined) {
          debuggerAttachedTabs.delete(target.tabId);
          // Notify detach listeners
          debuggerDetachListeners.forEach((listener) => listener(target, "target_closed"));
        }
        if (callback) callback();
        return Promise.resolve();
      }
    ),

    sendCommand: vi.fn(
      (
        target: chrome.debugger.Debuggee,
        method: string,
        _params?: Record<string, unknown>,
        callback?: (result: unknown) => void
      ): Promise<unknown> => {
        // Note: We do NOT check debuggerAttachedTabs here because the real
        // debugger-manager.ts does its own check via its module-level attachedTabs Set.
        // Since we cannot reset that Set (debugger-manager.ts is not modifiable),
        // we trust the module-level check and just return a mock CDP response.
        if (method === "Page.navigate" || method === "Page.reload" || method === "Page.goBackInHistory" || method === "Page.goForwardInHistory") {
          for (const listener of debuggerEventListeners) {
            listener(target, "Page.lifecycleEvent", { name: "DOMContentLoaded" });
            listener(target, "Page.lifecycleEvent", { name: "load" });
            listener(target, "Page.lifecycleEvent", { name: "networkIdle" });
          }
        }
        if (callback) callback({});
        return Promise.resolve({});
      }
    ),

    onEvent: {
      addListener: vi.fn((listener: (source: chrome.debugger.Debuggee, method: string, params?: Record<string, unknown>) => void) => {
        debuggerEventListeners.push(listener);
      }),
      removeListener: vi.fn((listener: (source: chrome.debugger.Debuggee, method: string, params?: Record<string, unknown>) => void) => {
        const idx = debuggerEventListeners.indexOf(listener);
        if (idx !== -1) debuggerEventListeners.splice(idx, 1);
      }),
      hasListener: vi.fn(() => false),
    },

    onDetach: {
      addListener: vi.fn((listener: (source: chrome.debugger.Debuggee, reason: string) => void) => {
        debuggerDetachListeners.push(listener);
      }),
      removeListener: vi.fn((listener: (source: chrome.debugger.Debuggee, reason: string) => void) => {
        const idx = debuggerDetachListeners.indexOf(listener);
        if (idx !== -1) debuggerDetachListeners.splice(idx, 1);
      }),
      hasListener: vi.fn(() => false),
    },
  };
}

// ── Factory: create fresh chrome mock ────────────────────────────────────────

/**
 * Creates a fresh chrome mock object with brand-new vi.fn() implementations
 * for every function. Used on first setup and on every resetChromeMocks() call.
 */
function createChromeMocks() {
  return {
    storage: createStorageMock(),
    tabs: createTabsMock(),
    contextMenus: createContextMenusMock(),
    action: createActionMock(),
    runtime: createRuntimeMock(),
    scripting: createScriptingMock(),
    commands: createCommandsMock(),
    webNavigation: createWebNavigationMock(),
    debugger: createDebuggerMock(),
  };
}

// ── Mount initial chrome mock on global ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as unknown as Record<string, unknown>)["chrome"] = createChromeMocks();

/**
 * Helper to reset all mocks AND the storage map between tests.
 *
 * Creates FRESH vi.fn() implementations so that mockResolvedValue / mockReturnValue
 * set by one test does NOT leak into the next test.
 *
 * Call in beforeEach in any test that uses chrome APIs.
 */
export function resetChromeMocks(): void {
  // Clear all in-memory state
  storageMap.clear();
  runtimeListeners.length = 0;
  mockTabUrls.clear();
  debuggerAttachedTabs.clear();
  debuggerDetachListeners.length = 0;

  // Default: tab 1 points to example.com/page (covers most test scenarios)
  mockTabUrls.set(1, "https://example.com/page");

  // Replace globalThis.chrome with fresh mocks (fresh vi.fn() for every function)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as unknown as Record<string, any>)["chrome"] = createChromeMocks();
}

/**
 * Helper to seed storage with test data.
 */
export function seedStorage(data: Record<string, unknown>): void {
  Object.entries(data).forEach(([key, value]) => {
    storageMap.set(key, value);
  });
}

/**
 * Helper to read raw storage map (for assertions).
 */
export function getStorageMap(): Map<string, unknown> {
  return storageMap;
}

/**
 * Helper to simulate a runtime message being dispatched.
 * Returns a Promise that resolves with the value passed to sendResponse,
 * enabling async/await testing of message handlers.
 * Times out after 100ms if sendResponse is never called (e.g., handler throws).
 */
export function dispatchRuntimeMessage(
  message: unknown,
  sender: unknown = {},
  sendResponse: (response: unknown) => void = () => undefined
): Promise<unknown> {
  let resolvePromise: (value: unknown) => void;
  const promise = new Promise<unknown>((resolve) => {
    resolvePromise = resolve;
  });
  const wrappedSendResponse = (response: unknown): void => {
    sendResponse(response);
    resolvePromise(response);
  };
  runtimeListeners.forEach((listener) => listener(message, sender, wrappedSendResponse));
  // Safety timeout: if handler throws without calling sendResponse, resolve anyway
  setTimeout(() => resolvePromise(undefined), 100);
  return promise;
}

/**
 * Helper to set a custom byte usage for getBytesInUse mock.
 * Used to test storage quota behavior (BR-F-84).
 */
export function setMockBytesInUse(bytes: number): void {
  (chrome.storage.local.getBytesInUse as ReturnType<typeof vi.fn>).mockResolvedValue(bytes);
}

/**
 * Helper to fire Page.lifecycleEvent debugger events for a tab.
 * Used to unblock handleNavigate's lifecycle waiter in tests that override
 * debugger.sendCommand but still need the lifecycle promise to resolve.
 */
export function fireLifecycleEvents(tabId: number): void {
  for (const listener of debuggerEventListeners) {
    listener({ tabId }, "Page.lifecycleEvent", { name: "DOMContentLoaded" });
    listener({ tabId }, "Page.lifecycleEvent", { name: "load" });
    listener({ tabId }, "Page.lifecycleEvent", { name: "networkIdle" });
  }
}
