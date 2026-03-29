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

const storageMock = {
  local: {
    get: vi.fn(
      (
        keys: string | string[] | Record<string, unknown> | null,
        callback?: (items: Record<string, unknown>) => void
      ): Promise<Record<string, unknown>> => {
        const result: Record<string, unknown> = {};

        if (keys === null || keys === undefined) {
          // Return all items
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
          // Record with defaults
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

// ── Tabs mock ────────────────────────────────────────────────────────────────

/** Tab registry for mock: maps tabId → url. Tests can populate via setMockTabUrl(). */
const mockTabUrls = new Map<number, string>();

/**
 * Register a URL for a mock tab so captureScreenshot can look it up.
 * Call this in tests before calling captureScreenshot(tabId).
 */
export function setMockTabUrl(tabId: number, url: string): void {
  mockTabUrls.set(tabId, url);
}

const tabsMock = {
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
      _message: unknown,
      callback?: (response: unknown) => void
    ): Promise<unknown> => {
      if (callback) callback(undefined);
      return Promise.resolve(undefined);
    }
  ),
};

// ── Context menus mock ───────────────────────────────────────────────────────

const contextMenusMock = {
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

// ── Action mock ──────────────────────────────────────────────────────────────

const actionMock = {
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

// ── Runtime mock ─────────────────────────────────────────────────────────────

const runtimeListeners: Array<
  (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void
> = [];

const runtimeMock = {
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

// ── Scripting mock ───────────────────────────────────────────────────────────

const scriptingMock = {
  executeScript: vi.fn(
    (_injection: chrome.scripting.ScriptInjection<unknown[], unknown>): Promise<chrome.scripting.InjectionResult<unknown>[]> => {
      return Promise.resolve([]);
    }
  ),
};

// ── Commands mock ────────────────────────────────────────────────────────────

const commandsMock = {
  onCommand: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(() => false),
  },
};

// ── WebNavigation mock ──────────────────────────────────────────────────────

const webNavigationMock = {
  onCommitted: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(() => false),
  },
};

// ── Assemble global chrome object ────────────────────────────────────────────

const chromeMock = {
  storage: storageMock,
  tabs: tabsMock,
  contextMenus: contextMenusMock,
  action: actionMock,
  runtime: runtimeMock,
  scripting: scriptingMock,
  commands: commandsMock,
  webNavigation: webNavigationMock,
};

// Mount on global for all tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as unknown as Record<string, unknown>)["chrome"] = chromeMock;

/**
 * Helper to reset all mocks AND the storage map between tests.
 * Call in beforeEach in any test that uses chrome.storage.
 */
export function resetChromeMocks(): void {
  storageMap.clear();
  runtimeListeners.length = 0;
  mockTabUrls.clear();
  // Default: tab 1 points to example.com/page (covers most test scenarios)
  mockTabUrls.set(1, "https://example.com/page");

  // Reset all vi.fn() call history
  vi.clearAllMocks();

  // Reset getBytesInUse to return 0 by default
  (chrome.storage.local.getBytesInUse as ReturnType<typeof vi.fn>).mockResolvedValue(0);
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
 */
export function dispatchRuntimeMessage(
  message: unknown,
  sender: unknown = {},
  sendResponse: (response: unknown) => void = () => undefined
): void {
  runtimeListeners.forEach((listener) => listener(message, sender, sendResponse));
}

/**
 * Helper to set a custom byte usage for getBytesInUse mock.
 * Used to test storage quota behavior (BR-F-84).
 */
export function setMockBytesInUse(bytes: number): void {
  (chrome.storage.local.getBytesInUse as ReturnType<typeof vi.fn>).mockResolvedValue(bytes);
}
