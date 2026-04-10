/**
 * extension-store-subscription.test.ts
 *
 * Tests that activate() registers a CommentUINotifier with accordo-comments via
 * registerBrowserNotifier when the extension is available, and calls relay.push()
 * on actual comment mutations — ensuring agent-created comments trigger a Chrome
 * popup refresh without subscribing to every document-change event.
 *
 * Requirements:
 *   SUB-01: When registerBrowserNotifier notifier.addThread fires with an https:// URI,
 *           relay.push("notify_comments_updated", { url }) is called
 *   SUB-01c: When notifier.addThread fires with a file:// URI, relay.push is NOT called
 *   SUB-01d: When notifier.removeThread fires, relay.push("notify_comments_updated", { threadId }) is called
 *   SUB-02: When accordo-comments is not installed, activation still completes without error
 *   SUB-03: When accordo-comments exports no registerBrowserNotifier, activation still completes without error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate } from "../extension.js";

// Mock vscode to force per-window relay path (sharedRelay=false).
// Without this, extension.ts takes the shared relay path (sharedRelay=true default),
// which does not call registerBrowserNotifier — breaking SUB-01 tests.
vi.mock("vscode", () => {
  const state = new Map<string, unknown>();
  return {
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn(<T>(_key: string, defaultValue: T): T => {
          if (_key === "sharedRelay") return false as unknown as T;
          return defaultValue;
        }),
      })),
    },
    extensions: {
      getExtension: vi.fn(() => ({ exports: null })),
    },
    window: {
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        dispose: vi.fn(),
      })),
    },
    Disposable: class Disposable {
      constructor(private readonly fn: () => void) {}
      dispose(): void { this.fn(); }
    },
    createExtensionContextMock: () => ({
      subscriptions: [] as Array<{ dispose(): void }>,
      globalState: {
        get: vi.fn((k: string) => state.get(k)),
        update: vi.fn(async (k: string, v: unknown) => { state.set(k, v); }),
      },
    }),
  };
});

const vscode = await import("vscode");
const extensions = (vscode as Record<string, unknown>).extensions as {
  getExtension: ReturnType<typeof vi.fn>;
};
const createExtensionContextMock = (vscode as Record<string, unknown>).createExtensionContextMock as () => {
  subscriptions: Array<{ dispose(): void }>;
  globalState: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

// ── Relay mock ───────────────────────────────────────────────────────────────

const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
const isConnectedMock = vi.fn(() => false);
const pushMock = vi.fn();

vi.mock("../relay-server.js", () => ({
  BrowserRelayServer: vi.fn().mockImplementation(() => ({
    start: startMock,
    stop: stopMock,
    isConnected: isConnectedMock,
    request: vi.fn(),
    push: pushMock,
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBridge() {
  return {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    publishState: vi.fn(),
    invokeTool: vi.fn().mockResolvedValue({}),
  };
}

type BrowserNotifier = {
  addThread(thread: { anchor: { uri: string } }): void;
  updateThread(thread: { anchor: { uri: string } }): void;
  removeThread(threadId: string): void;
};

beforeEach(() => {
  vi.clearAllMocks();
  startMock.mockResolvedValue(undefined);
  stopMock.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("extension.ts — accordo-comments browser notifier registration", () => {

  /**
   * SUB-01: When registerBrowserNotifier is called and notifier.addThread fires with
   *         an https:// URI, relay.push("notify_comments_updated", { url }) is called.
   */
  it("SUB-01: calls relay.push with notify_comments_updated when addThread fires with https:// URI", async () => {
    const bridge = makeBridge();

    // Track the notifier passed to registerBrowserNotifier so we can fire it manually
    let capturedNotifier: BrowserNotifier | null = null;
    const disposeMock = vi.fn();

    const commentsExports = {
      registerBrowserNotifier: vi.fn().mockImplementation((notifier: BrowserNotifier) => {
        capturedNotifier = notifier;
        return { dispose: disposeMock };
      }),
    };

    (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
      (id: string) => {
        if (id === "accordo.accordo-bridge") return { exports: bridge };
        if (id === "accordo.accordo-comments") return { exports: commentsExports };
        return undefined;
      },
    );

    const context = createExtensionContextMock();
    await activate(context as never);

    // registerBrowserNotifier must have been called during activation
    expect(commentsExports.registerBrowserNotifier).toHaveBeenCalledTimes(1);
    expect(capturedNotifier).not.toBeNull();

    // Fire addThread with an https:// URI
    capturedNotifier!.addThread({ anchor: { uri: "https://example.com/page" } });

    // relay.push must have been called with the correct arguments
    expect(pushMock).toHaveBeenCalledWith("notify_comments_updated", {
      url: "https://example.com/page",
    });
  });

  /**
   * SUB-01b: The disposable returned by registerBrowserNotifier is added to context.subscriptions.
   */
  it("SUB-01b: disposable from registerBrowserNotifier is pushed into context.subscriptions", async () => {
    const bridge = makeBridge();
    const disposeMock = vi.fn();

    const commentsExports = {
      registerBrowserNotifier: vi.fn().mockReturnValue({ dispose: disposeMock }),
    };

    (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
      (id: string) => {
        if (id === "accordo.accordo-bridge") return { exports: bridge };
        if (id === "accordo.accordo-comments") return { exports: commentsExports };
        return undefined;
      },
    );

    const context = createExtensionContextMock();
    await activate(context as never);

    // At least one of the subscriptions must be the one returned by registerBrowserNotifier
    const hasStoreSub = context.subscriptions.some(
      (s) => s.dispose === disposeMock,
    );
    expect(hasStoreSub).toBe(true);
  });

  /**
   * SUB-01c: When notifier.addThread fires with a file:// URI, relay.push is NOT called.
   */
  it("SUB-01c: relay.push is not called when addThread fires with a file:// URI", async () => {
    const bridge = makeBridge();

    let capturedNotifier: BrowserNotifier | null = null;

    const commentsExports = {
      registerBrowserNotifier: vi.fn().mockImplementation((notifier: BrowserNotifier) => {
        capturedNotifier = notifier;
        return { dispose: vi.fn() };
      }),
    };

    (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
      (id: string) => {
        if (id === "accordo.accordo-bridge") return { exports: bridge };
        if (id === "accordo.accordo-comments") return { exports: commentsExports };
        return undefined;
      },
    );

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedNotifier).not.toBeNull();

    // Fire addThread with a file:// URI — should NOT push
    capturedNotifier!.addThread({ anchor: { uri: "file:///workspace/foo.ts" } });

    expect(pushMock).not.toHaveBeenCalled();
  });

  /**
   * SUB-01d: When notifier.removeThread fires, relay.push("notify_comments_updated", { threadId }) is called.
   */
  it("SUB-01d: relay.push includes threadId when removeThread fires", async () => {
    const bridge = makeBridge();

    let capturedNotifier: BrowserNotifier | null = null;

    const commentsExports = {
      registerBrowserNotifier: vi.fn().mockImplementation((notifier: BrowserNotifier) => {
        capturedNotifier = notifier;
        return { dispose: vi.fn() };
      }),
    };

    (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
      (id: string) => {
        if (id === "accordo.accordo-bridge") return { exports: bridge };
        if (id === "accordo.accordo-comments") return { exports: commentsExports };
        return undefined;
      },
    );

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(capturedNotifier).not.toBeNull();

    // Fire removeThread — should push with threadId payload
    capturedNotifier!.removeThread("thread-abc");

    expect(pushMock).toHaveBeenCalledWith("notify_comments_updated", { threadId: "thread-abc" });
  });

  /**
   * SUB-02: When accordo-comments extension is not installed,
   *         activation still completes without throwing.
   */
  it("SUB-02: activation completes without error when accordo-comments is not installed", async () => {
    const bridge = makeBridge();

    (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
      (id: string) => {
        if (id === "accordo.accordo-bridge") return { exports: bridge };
        // accordo-comments not installed
        return undefined;
      },
    );

    const context = createExtensionContextMock();
    await expect(activate(context as never)).resolves.not.toThrow();
  });

  /**
   * SUB-02b: relay.push is NOT called when accordo-comments is not installed
   *          (no subscription means no push).
   */
  it("SUB-02b: relay.push is not called when accordo-comments is not installed", async () => {
    const bridge = makeBridge();

    (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
      (id: string) => {
        if (id === "accordo.accordo-bridge") return { exports: bridge };
        return undefined;
      },
    );

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(pushMock).not.toHaveBeenCalled();
  });

  /**
   * SUB-03: When accordo-comments is installed but exports no registerBrowserNotifier,
   *         activation still completes without throwing.
   */
  it("SUB-03: activation completes without error when registerBrowserNotifier is absent from exports", async () => {
    const bridge = makeBridge();

    // commentsExt exists but exports is empty / missing registerBrowserNotifier
    const commentsExports = {};

    (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
      (id: string) => {
        if (id === "accordo.accordo-bridge") return { exports: bridge };
        if (id === "accordo.accordo-comments") return { exports: commentsExports };
        return undefined;
      },
    );

    const context = createExtensionContextMock();
    await expect(activate(context as never)).resolves.not.toThrow();
  });

  /**
   * SUB-03b: relay.push is NOT called when registerBrowserNotifier is absent from exports.
   */
  it("SUB-03b: relay.push is not called when registerBrowserNotifier is absent from exports", async () => {
    const bridge = makeBridge();

    (extensions as Record<string, unknown>).getExtension = vi.fn().mockImplementation(
      (id: string) => {
        if (id === "accordo.accordo-bridge") return { exports: bridge };
        if (id === "accordo.accordo-comments") return { exports: {} };
        return undefined;
      },
    );

    const context = createExtensionContextMock();
    await activate(context as never);

    expect(pushMock).not.toHaveBeenCalled();
  });
});
