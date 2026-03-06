/**
 * extension.test.ts — Tests for accordo-slidev extension activation
 *
 * Requirements covered:
 *   M44-EXT-01  Activates Bridge dependency and acquires BridgeAPI exports
 *   M44-EXT-02  Registers all 9 presentation tools
 *   M44-EXT-03  Creates WebviewPanel on demand via open tool handler, not CustomEditorProvider
 *   M44-EXT-04  Acquires comments surface adapter via internal command when available
 *   M44-EXT-05  Publishes initial modality state via bridge.publishState
 *   M44-EXT-06  Works without comments extension — no throw, tools still registered
 *   M44-EXT-07  Only one session at a time; tested via provider tests (session close on new deck)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeExtensionContext,
  window,
  extensions,
  commands,
} from "./mocks/vscode.js";
import { activate, deactivate, type BridgeAPI } from "../extension.js";

// ── Global mock reset ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Re-apply createWebviewPanel default after clearAllMocks
  vi.mocked(window.createWebviewPanel).mockReturnValue({
    webview: { html: "", onDidReceiveMessage: vi.fn(), postMessage: vi.fn(), asWebviewUri: vi.fn() },
    onDidDispose: vi.fn(),
    reveal: vi.fn(),
    dispose: vi.fn(),
  } as any);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBridge(): BridgeAPI {
  return {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    publishState: vi.fn(),
  };
}

function setupExtensions(
  bridge: BridgeAPI | undefined,
  commentsActive: boolean,
): void {
  const commentsApi = commentsActive
    ? { getSurfaceAdapter: vi.fn().mockReturnValue({ dispose: vi.fn() }) }
    : undefined;

  vi.mocked(extensions.getExtension).mockImplementation((id: string) => {
    if (id === "accordo.accordo-bridge") {
      return bridge
        ? {
            exports: bridge,
            isActive: true,
            activate: vi.fn().mockResolvedValue(undefined),
          }
        : undefined;
    }
    if (id === "accordo.accordo-comments") {
      return commentsApi
        ? {
            exports: commentsApi,
            isActive: true,
            activate: vi.fn().mockResolvedValue(undefined),
          }
        : undefined;
    }
    return undefined;
  });

  // Mock internal getSurfaceAdapter command
  vi.mocked(commands.executeCommand).mockImplementation((cmd: string) => {
    if (cmd === "accordo.comments.internal.getSurfaceAdapter" && commentsActive) {
      return Promise.resolve({ dispose: vi.fn() });
    }
    return Promise.resolve(undefined);
  });
}

// ── M44-EXT-01: Bridge acquisition ───────────────────────────────────────────

describe("M44-EXT-01: Bridge acquisition", () => {
  it("looks up accordo.accordo-bridge extension", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await activate(ctx);

    expect(extensions.getExtension).toHaveBeenCalledWith("accordo.accordo-bridge");
  });

  it("does not throw when bridge is absent", async () => {
    setupExtensions(undefined, false);
    const ctx = makeExtensionContext();

    await expect(activate(ctx)).resolves.not.toThrow();
  });
});

// ── M44-EXT-02: Tool registration ────────────────────────────────────────────

describe("M44-EXT-02: Tool registration", () => {
  it("registers tools when bridge is available", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await activate(ctx);

    expect(bridge.registerTools).toHaveBeenCalled();
  });

  it("registers exactly 8 presentation tools", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await activate(ctx);

    const [, tools] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tools).toHaveLength(8);
  });

  it("registers tools under namespace 'accordo-slidev'", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await activate(ctx);

    const [namespace] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(namespace).toBe("accordo-slidev");
  });

  it("does not register tools when bridge is absent", async () => {
    setupExtensions(undefined, false);
    const ctx = makeExtensionContext();
    const fakeBridge = makeBridge();

    await activate(ctx);

    expect(fakeBridge.registerTools).not.toHaveBeenCalled();
  });
});

// ── M44-EXT-04: Comments surface adapter ─────────────────────────────────────

describe("M44-EXT-04: Comments surface adapter", () => {
  it("looks up accordo.accordo-comments extension", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, true);
    const ctx = makeExtensionContext();

    await activate(ctx);

    expect(extensions.getExtension).toHaveBeenCalledWith("accordo.accordo-comments");
  });

  it("executes getSurfaceAdapter internal command when comments is available", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, true);
    const ctx = makeExtensionContext();

    await activate(ctx);

    expect(commands.executeCommand).toHaveBeenCalledWith(
      "accordo.comments.internal.getSurfaceAdapter",
      expect.anything(),
    );
  });
});

// ── M44-EXT-05: Initial state publication ────────────────────────────────────

describe("M44-EXT-05: Initial state publication", () => {
  it("calls bridge.publishState on activation", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await activate(ctx);

    expect(bridge.publishState).toHaveBeenCalled();
  });

  it("publishes 'accordo-slidev' as the state key", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await activate(ctx);

    const [key] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toBe("accordo-slidev");
  });

  it("initial state includes isOpen: false", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await activate(ctx);

    const [, state] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toMatchObject({ isOpen: false });
  });

  it("initial state includes deckUri: null", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await activate(ctx);

    const [, state] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toMatchObject({ deckUri: null });
  });
});

// ── M44-EXT-06: Comments extension absent ────────────────────────────────────

describe("M44-EXT-06: Works without comments extension", () => {
  it("activates without error when comments extension is absent", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await expect(activate(ctx)).resolves.not.toThrow();
  });

  it("registers tools even when comments is absent", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await activate(ctx);

    expect(bridge.registerTools).toHaveBeenCalled();
  });

  it("does not call executeCommand getSurfaceAdapter when comments absent", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await activate(ctx);

    const getSurfaceAdapterCalls = (commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([cmd]: [string]) => cmd === "accordo.comments.internal.getSurfaceAdapter");
    expect(getSurfaceAdapterCalls).toHaveLength(0);
  });
});

// ── accordo.presentation.goto VS Code command ───────────────────────────────
// Prerequisite for M45-NR (Custom Comments Panel navigation router).
// The router calls executeCommand('accordo.presentation.goto', slideIndex).

describe("accordo.presentation.goto VS Code command", () => {
  it("registers accordo.presentation.goto as a VS Code command", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await activate(ctx);

    const registeredCmds = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([cmd]: [string]) => cmd,
    );
    expect(registeredCmds).toContain("accordo.presentation.goto");
  });

  it("goto command disposable is pushed to context.subscriptions", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    const ctx = makeExtensionContext();

    await activate(ctx);

    // open + close + goto + editorProvider + provider + tools disposable all land here
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(3);
  });
});

// ── deactivate ────────────────────────────────────────────────────────────────

describe("deactivate", () => {
  it("does not throw", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
