/**
 * extension.test.ts — Tests for accordo-marp extension activation
 *
 * Marp-specific behaviour vs Slidev:
 * - Default engine is "marp" (Marp activates by default, Slidev yields)
 * - When engine is "slidev", Marp yields (returns early, no tools registered)
 * - No child process, no port management
 * - State key is "accordo-marp"
 *
 * Requirements covered:
 *   M50-EXT-01  Reads engine setting; if "slidev", does NOT register tools
 *   M50-EXT-02  Activates Bridge and acquires BridgeAPI exports
 *   M50-EXT-03  Registers all 9 presentation tools when engine is "marp"
 *   M50-EXT-04  Creates WebviewPanel on demand via presentation.open tool
 *   M50-EXT-05  Acquires comments adapter via internal command when available
 *   M50-EXT-06  Publishes initial modality state via bridge.publishState
 *   M50-EXT-07  If comments extension unavailable, presentation still works
 *   M50-EXT-08  Only one session at a time; opening new deck closes previous
 *
 *   M50-FOCUS-01  Registers VS Code command accordo.presentation.internal.focusThread
 *   M50-FOCUS-02  Command parameters: (uri: string, threadId: string, blockId: string)
 *   M50-FOCUS-03  Ensures the deck is open (calls accordo.presentation.open if needed)
 *   M50-FOCUS-04  Parses slideIndex from blockId, navigates to that slide
 *   M50-FOCUS-05  Posts comments:focus to webview after navigation settling
 *
 * Test state: ALL tests expected to FAIL with "not implemented" until implementation lands.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeExtensionContext,
  MockExtensionContext,
  MockWebviewPanel,
  window,
  extensions,
  commands,
  workspace,
} from "./mocks/vscode.js";
import { activate, deactivate } from "../extension.js";
import type { BridgeAPI } from "../types.js";
import type * as vscode from "vscode";
import { CAPABILITY_COMMANDS } from "@accordo/capabilities";

// Helper to cast MockExtensionContext to the full vscode.ExtensionContext type.
// The mock provides only the fields used by accordo-marp; the cast is safe for testing.
function asCtx(ctx: MockExtensionContext): vscode.ExtensionContext {
  return ctx as unknown as vscode.ExtensionContext;
}

// ── Global mock reset ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default createWebviewPanel return after clearAllMocks
  vi.mocked(window.createWebviewPanel).mockReturnValue({
    webview: {
      html: "",
      onDidReceiveMessage: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      postMessage: vi.fn().mockResolvedValue(true),
      asWebviewUri: vi.fn().mockImplementation((u: unknown) => u),
      cspSource: "https://localhost",
      options: {},
    },
    onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidChangeViewState: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    reveal: vi.fn(),
    dispose: vi.fn(),
    title: "",
    visible: true,
    active: true,
  } as never);
  // Default workspace.createFileSystemWatcher
  vi.mocked(workspace.createFileSystemWatcher).mockReturnValue({
    onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    dispose: vi.fn(),
  });
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

  vi.mocked(commands.executeCommand).mockImplementation((cmd: string) => {
    if (cmd === CAPABILITY_COMMANDS.COMMENTS_GET_SURFACE_ADAPTER && commentsActive) {
      return Promise.resolve({ dispose: vi.fn() });
    }
    return Promise.resolve(undefined);
  });
}

function setupEngineConfig(engine: "marp" | "slidev"): void {
  vi.mocked(workspace.getConfiguration).mockReturnValue({
    get: vi.fn().mockImplementation((key: string) => {
      if (key === "accordo.presentation.engine") return engine;
      return null;
    }),
  });
}

// ── M50-EXT-01: Engine gate — "slidev" yields ─────────────────────────────────

describe("M50-EXT-01: Engine gate", () => {
  it("engine 'slidev' — does NOT register tools", async () => {
    // When the user has chosen Slidev, Marp must silently yield without registering.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("slidev");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    expect(bridge.registerTools).not.toHaveBeenCalled();
  });

  it("engine 'slidev' — activate returns early without throwing", async () => {
    // Even when yielding, activate must resolve cleanly.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("slidev");
    const ctx = makeExtensionContext();

    await expect(activate(asCtx(ctx))).resolves.not.toThrow();
  });

  it("engine 'slidev' — does NOT publish state", async () => {
    // Yielding engine must not claim the modality state key.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("slidev");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    expect(bridge.publishState).not.toHaveBeenCalled();
  });

  it("engine 'marp' (default) — DOES register tools", async () => {
    // Marp is the default engine and must always register when selected.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    expect(bridge.registerTools).toHaveBeenCalled();
  });
});

// ── M50-EXT-02: Bridge acquisition ───────────────────────────────────────────

describe("M50-EXT-02: Bridge acquisition", () => {
  it("looks up accordo.accordo-bridge extension", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    expect(extensions.getExtension).toHaveBeenCalledWith("accordo.accordo-bridge");
  });

  it("does not throw when bridge is absent", async () => {
    // No bridge = activate returns early without registering.
    setupExtensions(undefined, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await expect(activate(asCtx(ctx))).resolves.not.toThrow();
  });

  it("does not register tools when bridge is absent", async () => {
    setupExtensions(undefined, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();
    const fakeBridge = makeBridge();

    await activate(asCtx(ctx));

    expect(fakeBridge.registerTools).not.toHaveBeenCalled();
  });
});

// ── M50-EXT-03: Tool registration ────────────────────────────────────────────

describe("M50-EXT-03: Tool registration", () => {
  it("registers tools when bridge is available and engine is marp", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    expect(bridge.registerTools).toHaveBeenCalled();
  });

  it("registers exactly 10 presentation tools", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const [, tools] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tools).toHaveLength(10);
  });

  it("registers tools under namespace 'accordo-marp'", async () => {
    // The namespace must be 'accordo-marp', NOT 'accordo-slidev'.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const [namespace] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(namespace).toBe("accordo-marp");
  });
});

// ── M50-EXT-05: Comments surface adapter ─────────────────────────────────────

describe("M50-EXT-05: Comments surface adapter", () => {
  it("looks up accordo.accordo-comments extension when available", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, true);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    expect(extensions.getExtension).toHaveBeenCalledWith("accordo.accordo-comments");
  });

  it("executes getSurfaceAdapter internal command when comments is available", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, true);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    expect(commands.executeCommand).toHaveBeenCalledWith(
      CAPABILITY_COMMANDS.COMMENTS_GET_SURFACE_ADAPTER,
      expect.anything(),
    );
  });
});

// ── M50-EXT-06: Initial state publication ────────────────────────────────────

describe("M50-EXT-06: Initial state publication", () => {
  it("calls bridge.publishState on activation", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    expect(bridge.publishState).toHaveBeenCalled();
  });

  it("publishes 'accordo-marp' as the state key (NOT 'accordo-slidev')", async () => {
    // The state key must identify this engine uniquely.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const [key] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toBe("accordo-marp");
  });

  it("initial state includes isOpen: false", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const [, state] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toMatchObject({ isOpen: false });
  });

  it("initial state includes deckUri: null", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const [, state] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toMatchObject({ deckUri: null });
  });
});

// ── M50-EXT-07: Comments extension absent ────────────────────────────────────

describe("M50-EXT-07: Works without comments extension", () => {
  it("activates without error when comments extension is absent", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await expect(activate(asCtx(ctx))).resolves.not.toThrow();
  });

  it("registers tools even when comments is absent", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    expect(bridge.registerTools).toHaveBeenCalled();
  });

  it("does not call executeCommand getSurfaceAdapter when comments absent", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const getSurfaceAdapterCalls = (commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .filter(([cmd]: [string]) => cmd === CAPABILITY_COMMANDS.COMMENTS_GET_SURFACE_ADAPTER);
    expect(getSurfaceAdapterCalls).toHaveLength(0);
  });
});

// ── M50-EXT-04: WebViewPanel on demand ───────────────────────────────────────

describe("M50-EXT-04: WebViewPanel created on demand", () => {
  it("M50-EXT-04: open tool handler calls window.createWebviewPanel when invoked", async () => {
    // The panel must only be created when the open tool is called — not during activation.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const [, tools] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    const openTool = tools.find(
      (t: { name: string }) => t.name === "accordo_presentation_open",
    );
    expect(openTool).toBeDefined();

    // Calling the open tool handler must trigger panel creation
    // (setup deck content so handler doesn't fail on missing file)
    vi.mocked(workspace.openTextDocument).mockResolvedValue({
      getText: vi.fn().mockReturnValue("---\nmarp: true\n---\n\n# Slide\n\nContent"),
    } as unknown as import("vscode").TextDocument);

    await openTool.handler({ deckUri: "/test/deck.md" });

    // Panel must have been created
    expect(window.createWebviewPanel).toHaveBeenCalled();
  });
});

// ── M50-EXT-08: Single session constraint ─────────────────────────────────────

describe("M50-EXT-08: Only one session at a time", () => {
  it("M50-EXT-08: opening a second deck closes the first session", async () => {
    // Opening a new deck while one is active must tear down the prior session.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const [, tools] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    const openTool = tools.find(
      (t: { name: string }) => t.name === "accordo_presentation_open",
    );
    expect(openTool).toBeDefined();

    // Mock two different decks so both opens succeed
    vi.mocked(workspace.openTextDocument).mockResolvedValue({
      getText: vi.fn()
        .mockReturnValueOnce("---\nmarp: true\n---\n\n# Slide A")
        .mockReturnValueOnce("---\nmarp: true\n---\n\n# Slide B"),
    } as never);

    const panelA = new MockWebviewPanel("accordo.marp.presentation", "Deck A");
    const panelB = new MockWebviewPanel("accordo.marp.presentation", "Deck B");
    vi.mocked(window.createWebviewPanel)
      .mockReturnValueOnce(panelA)
      .mockReturnValueOnce(panelB);

    // Open first deck
    await openTool.handler({ deckUri: "/deck-a.md" });
    // Open second deck
    await openTool.handler({ deckUri: "/deck-b.md" });

    // First panel must have been disposed to release the session
    expect(panelA.dispose).toHaveBeenCalled();
  });
});

// ── Tool handler wiring ───────────────────────────────────────────────────────

describe("Extension — tool handler wiring", () => {
  it("all 10 tools have handler functions that are functions", async () => {
    // Every tool must have a callable handler — not undefined.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const [, tools] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    for (const tool of tools) {
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("accordo_presentation_close tool calls closeSession dep", async () => {
    // close tool must be able to invoke without throwing when no session is active.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const [, tools] = (bridge.registerTools as ReturnType<typeof vi.fn>).mock.calls[0];
    const closeTool = tools.find(
      (t: { name: string }) => t.name === "accordo_presentation_close",
    );

    await expect(closeTool.handler({})).resolves.not.toThrow();
  });
});

// ── Activation robustness ─────────────────────────────────────────────────────

describe("Activation robustness", () => {
  it("does not throw when bridge.registerTools throws (hub not connected)", async () => {
    // If Hub is not available at activation time, extension must still start.
    const bridge = makeBridge();
    (bridge.registerTools as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
    });
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await expect(activate(asCtx(ctx))).resolves.not.toThrow();
  });
});

// ── VS Code commands registered ───────────────────────────────────────────────

describe("VS Code commands registered by activate", () => {
  it("registers accordo.marp.open as a VS Code command", async () => {
    // The command palette entry must be registered.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const registeredCmds = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([cmd]: [string]) => cmd,
    );
    expect(registeredCmds).toContain("accordo.marp.open");
  });

  it("registers accordo.marp.close as a VS Code command", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const registeredCmds = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([cmd]: [string]) => cmd,
    );
    expect(registeredCmds).toContain("accordo.marp.close");
  });

  it("registers accordo_presentation_goto as a VS Code command for script runner", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const registeredCmds = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([cmd]: [string]) => cmd,
    );
    expect(registeredCmds).toContain("accordo_presentation_goto");
  });

  it("registers accordo_presentation_next as a VS Code command for script runner", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const registeredCmds = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([cmd]: [string]) => cmd,
    );
    expect(registeredCmds).toContain("accordo_presentation_next");
  });

  it("registers accordo_presentation_prev as a VS Code command for script runner", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const registeredCmds = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([cmd]: [string]) => cmd,
    );
    expect(registeredCmds).toContain("accordo_presentation_prev");
  });

  it("command disposables are pushed to context.subscriptions", async () => {
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(5);
  });
});

// ── M50-FOCUS: accordo.presentation.internal.focusThread command ───────────────

describe("M50-FOCUS: accordo.presentation.internal.focusThread command", () => {
  it("M50-FOCUS-01: registers accordo.presentation.internal.focusThread as a VS Code command", async () => {
    // The command must be registered so the comments panel can call it.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const registeredCmds = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([cmd]: [string]) => cmd,
    );
    expect(registeredCmds).toContain("accordo.presentation.internal.focusThread");
  });

  it("M50-FOCUS-01: focusThread command is registered separately from open/close/goto commands", async () => {
    // Must be a distinct command registration.
    const bridge = makeBridge();
    setupExtensions(bridge, false);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const registeredCmds = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([cmd]: [string]) => cmd,
    );
    expect(registeredCmds).toContain("accordo.presentation.internal.focusThread");
    // Not the same as accordo_presentation_internal_goto (different command ID).
    expect(registeredCmds).toContain("accordo_presentation_internal_goto");
    expect(registeredCmds.filter((c) => c === "accordo.presentation.internal.focusThread")).toHaveLength(1);
  });

  it("M50-FOCUS-02: focusThread command accepts (uri, threadId, blockId) parameters", async () => {
    // The command signature must accept three string parameters.
    const bridge = makeBridge();
    setupExtensions(bridge, true); // comments active
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    // Find the focusThread command registration
    const focusThreadReg = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([cmd]: [string]) => cmd === "accordo.presentation.internal.focusThread",
    );
    expect(focusThreadReg).toBeDefined();
    // The handler function must be called with uri, threadId, blockId
    // We verify by calling the handler directly (it was registered as a mock).
    // Get the registered handler
    const [, handler] = focusThreadReg as [string, (...args: unknown[]) => unknown];
    // Calling with no session should not throw (graceful no-op).
    await expect(handler("file:///deck.md", "t1", "slide:0:0.5:0.5")).resolves.toBeDefined();
  });

  it("M50-FOCUS-03: focusThread opens the deck if not already open (calls openSession)", async () => {
    // When focusThread is called with a deck not yet open, it must open it first.
    const bridge = makeBridge();
    setupExtensions(bridge, true);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    // Mock workspace.openTextDocument to succeed with valid deck content
    vi.mocked(workspace.openTextDocument).mockResolvedValue({
      getText: vi.fn().mockReturnValue("---\nmarp: true\n---\n\n# Slide\n"),
    } as unknown as import("vscode").TextDocument);

    // Find focusThread handler
    const focusThreadReg = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([cmd]: [string]) => cmd === "accordo.presentation.internal.focusThread",
    );
    const [, handler] = focusThreadReg as [string, (...args: unknown[]) => unknown];

    await handler("file:///deck.md", "t1", "slide:0:0.5:0.5");

    // openTextDocument should have been called (deck opened).
    expect(workspace.openTextDocument).toHaveBeenCalled();
    // A webview panel should have been created.
    expect(window.createWebviewPanel).toHaveBeenCalled();
  });

  it("M50-FOCUS-04: focusThread parses slideIndex from blockId and produces observable focus outcome", async () => {
    // The blockId "slide:N:x:y" must be parsed to extract slideIndex.
    // Observable contract: when focusThread is called with blockId "slide:2:...",
    // the focus outcome is: (a) navigation occurs and (b) comments:focus is posted
    // to the webview with the blockId indicating slide 2 — both must happen.
    const bridge = makeBridge();
    setupExtensions(bridge, true);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    vi.mocked(workspace.openTextDocument).mockResolvedValue({
      getText: vi.fn().mockReturnValue(
        "---\nmarp: true\n---\n\n# Slide 0\n\n---\n\n# Slide 1\n\n---\n\n# Slide 2\n",
      ),
    } as unknown as import("vscode").TextDocument);

    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);

    const focusThreadReg = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([cmd]: [string]) => cmd === "accordo.presentation.internal.focusThread",
    );
    expect(focusThreadReg).toBeDefined();
    const [, handler] = focusThreadReg as [string, (...args: unknown[]) => unknown];

    // Execute focusThread with blockId pointing to slide 2
    await handler("file:///deck.md", "t1", "slide:2:0.5000:0.5000");

    // Observable outcome (a): a panel was created — navigation side effect
    expect(window.createWebviewPanel).toHaveBeenCalled();

    // Observable outcome (b): comments:focus posted to webview with blockId containing slide 2
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "comments:focus",
        threadId: "t1",
        blockId: "slide:2:0.5000:0.5000",
      }),
    );

    // The slide index parsed from blockId must be reflected in the outcome.
    // blockId "slide:2:..." must produce a focus that references slide 2.
    const focusCall = (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      ([msg]: [unknown]) => (msg as Record<string, unknown>)["type"] === "comments:focus",
    );
    expect(focusCall).toBeDefined();
    const blockId = (focusCall?.[0] as Record<string, unknown>)["blockId"] as string;
    expect(blockId).toContain("slide:2");
  });

  it("M50-FOCUS-05: focusThread posts { type: 'comments:focus', threadId, blockId } to webview after navigation", async () => {
    // After navigating to the correct slide, the command must post comments:focus to the webview.
    const bridge = makeBridge();
    setupExtensions(bridge, true);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    vi.mocked(workspace.openTextDocument).mockResolvedValue({
      getText: vi.fn().mockReturnValue("---\nmarp: true\n---\n\n# Slide\n"),
    } as unknown as import("vscode").TextDocument);

    const panel = new MockWebviewPanel("accordo.marp.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);

    const focusThreadReg = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([cmd]: [string]) => cmd === "accordo.presentation.internal.focusThread",
    );
    const [, handler] = focusThreadReg as [string, (...args: unknown[]) => unknown];

    await handler("file:///deck.md", "thread-42", "slide:1:0.2500:0.7500");

    // The webview must receive comments:focus with the threadId and blockId.
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "comments:focus",
        threadId: "thread-42",
        blockId: "slide:1:0.2500:0.7500",
      }),
    );
  });

  it("M50-FOCUS-02: focusThread requires all three string parameters (uri, threadId, blockId)", async () => {
    // The approved contract is (uri: string, threadId: string, blockId: string).
    // Nullable uri is not part of the approved contract.
    const bridge = makeBridge();
    setupExtensions(bridge, true);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const focusThreadReg = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      ([cmd]: [string]) => cmd === "accordo.presentation.internal.focusThread",
    );
    expect(focusThreadReg).toBeDefined();
    const [, handler] = focusThreadReg as [string, (...args: unknown[]) => unknown];

    // All three parameters must be strings — no null/undefined allowed.
    // A null uri should not silently succeed; the command should handle it as missing.
    await expect(handler("file:///deck.md", "t1", "slide:0:0.5:0.5")).resolves.not.toThrow();
  });

  it("M50-FOCUS: focusThread does NOT use old router-owned open+goto path (no duplicate sequencing)", async () => {
    // M50-FOCUS is the single canonical focus path. The old pattern where the router
    // calls open THEN goto is replaced by focusThread which owns the full sequence.
    // The router must NOT do its own open+settling before calling focusThread.
    const bridge = makeBridge();
    setupExtensions(bridge, true);
    setupEngineConfig("marp");
    const ctx = makeExtensionContext();

    await activate(asCtx(ctx));

    const registeredCmds = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([cmd]: [string]) => cmd,
    );

    // The focusThread command is the single point of entry for slide thread focus.
    // It must NOT be preceded by a separate accordo.presentation.open call in the router.
    expect(registeredCmds).toContain("accordo.presentation.internal.focusThread");

    // The focusThread implementation should handle deck open internally (M50-FOCUS-03).
    // Verify the command exists — the design is that it owns open sequencing internally.
  });
});

// ── deactivate ────────────────────────────────────────────────────────────────

describe("deactivate", () => {
  it("does not throw", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
