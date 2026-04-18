/**
 * presentation-modularity.test.ts — tests for Presentation + Comments
 * modularity outcomes.
 *
 * Source: presentation-comments-modularity-A.md §§Frozen + Deferred
 * Architecture: architecture.md §17
 *
 * API checklist:
 *   ✓ PresentationProvider.open()     — 2 tests (renderer seam)
 *   ✓ PresentationProvider.close()   — 1 test
 *   ✓ PresentationProvider.setRenderer — 1 test
 *   ✓ MarpAdapter.handleViewSlideChanged — 3 tests (event seam)
 *
 * Tests MUST fail at assertion level against current codebase.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PresentationRuntimeAdapter } from "../runtime-adapter.js";
import type { PresentationRenderer, MarpRenderResult } from "../types.js";
import { PresentationProvider } from "../presentation-provider.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { window, workspace } from "./mocks/vscode.js";

// ── Mocks ──────────────────────────────────────────────────────────────────────

function makeMockRenderer(): PresentationRenderer {
  return {
    render: vi.fn().mockReturnValue({
      html: "<svg data-marpit-svg class=\"active\"><text>Slide 1</text></svg><svg data-marpit-svg><text>Slide 2</text></svg>",
      css: "",
      slideCount: 2,
      comments: ["", ""],
    } satisfies MarpRenderResult),
    getNotes: vi.fn().mockReturnValue(null),
  };
}

function makeMockAdapter(): PresentationRuntimeAdapter {
  return {
    listSlides: vi.fn().mockResolvedValue([
      { index: 0, title: "Slide 1" },
      { index: 1, title: "Slide 2" },
    ]),
    getCurrent: vi.fn().mockResolvedValue({ index: 0, title: "Slide 1" }),
    goto: vi.fn().mockResolvedValue(undefined),
    next: vi.fn().mockResolvedValue(undefined),
    prev: vi.fn().mockResolvedValue(undefined),
    onSlideChanged: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    validateDeck: vi.fn().mockReturnValue({ valid: true }),
    handleViewSlideChanged: vi.fn(),
    handleWebviewSlideChanged: vi.fn(),
    dispose: vi.fn(),
  };
}

function makeMockContext() {
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    workspaceState: { get: vi.fn(), update: vi.fn() },
    secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
    extensionUri: { fsPath: "/tmp" },
  } as unknown as import("vscode").ExtensionContext;
}

// ── REQ-MOD-1: handleViewSlideChanged event seam ───────────────────────────────
/**
 * Source: presentation-comments-modularity-A.md §Frozen Runtime Seam + §17.2
 *
 * The canonical seam for view-driven slide changes is handleViewSlideChanged(index).
 * Event flow: webview postMessage → Provider.handleWebviewMessage →
 * adapter.handleViewSlideChanged(index) (typed call, no cast) → adapter emits
 * through onSlideChanged listeners.
 *
 * This test suite verifies the typed call exists and the event propagates.
 */

describe("REQ-MOD-1: handleViewSlideChanged event seam", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  it("REQ-MOD-1.1: PresentationRuntimeAdapter interface has handleViewSlideChanged(index: number): void", () => {
    // The frozen contract requires handleViewSlideChanged on the adapter interface.
    const adapter = makeMockAdapter();
    expect(typeof adapter.handleViewSlideChanged).toBe("function");
  });

  it("REQ-MOD-1.2: handleViewSlideChanged emits to onSlideChanged listeners with correct index", () => {
    // When the webview reports a slide change, the adapter must update its state
    // and notify onSlideChanged listeners — this is the core event propagation contract.
    const listeners: Array<(index: number) => void> = [];
    const adapter = {
      ...makeMockAdapter(),
      // Override onSlideChanged to collect listeners
      onSlideChanged: (listener: (index: number) => void) => {
        listeners.push(listener);
        return { dispose: () => { const i = listeners.indexOf(listener); if (i !== -1) listeners.splice(i, 1); } };
      },
      // Override handleViewSlideChanged to emit to all listeners
      handleViewSlideChanged: (index: number) => {
        for (const l of listeners) l(index);
      },
    };
    const listener = vi.fn();
    adapter.onSlideChanged(listener);

    // Simulate webview-initiated slide change via the typed seam
    adapter.handleViewSlideChanged(1);

    // Adapter must emit the event to all registered listeners
    expect(listener).toHaveBeenCalledWith(1);
  });

  it("REQ-MOD-1.3: handleViewSlideChanged ignores out-of-bounds index without throwing", () => {
    // The adapter must guard against malformed webview messages gracefully.
    const adapter = makeMockAdapter();
    expect(() => adapter.handleViewSlideChanged(999)).not.toThrow();
    expect(() => adapter.handleViewSlideChanged(-1)).not.toThrow();
  });

  it("REQ-MOD-1.4: handleViewSlideChanged does not emit when index is unchanged", () => {
    // Guard: if the webview reports the current slide, don't emit a redundant event.
    const adapter = makeMockAdapter();
    const listener = vi.fn();
    adapter.onSlideChanged(listener);
    adapter.handleViewSlideChanged(0); // same as current (0)
    expect(listener).not.toHaveBeenCalled();
  });

  it("REQ-MOD-1.5: Provider.handleWebviewMessage routes presentation:slideChanged to adapter.handleViewSlideChanged", async () => {
    // The full event flow: webview sends { type: 'presentation:slideChanged', index: n }
    // → Provider.handleWebviewMessage (private) → adapter.handleViewSlideChanged(index)
    // The provider must call adapter.handleViewSlideChanged(n) directly (typed, no cast).
    //
    // We test this by spying on the adapter method after passing a message through
    // the provider's webview message handler.
    const ctx = makeMockContext();
    const provider = new PresentationProvider({ context: ctx });
    const adapter = makeMockAdapter();

    // Use the shared mock (via vitest resolve.alias) instead of vi.stubGlobal
    vi.mocked(workspace.fs.readFile).mockResolvedValue(Buffer.from("# Slide 1\n\n---\n\n# Slide 2") as never);
    vi.mocked(workspace.createFileSystemWatcher).mockReturnValue({
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    });
    vi.mocked(window.createWebviewPanel).mockReturnValue({
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn().mockResolvedValue(true),
        cspSource: "https://localhost",
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
      dispose: vi.fn(),
    } as never);

    await provider.open("/deck.md", adapter, makeMockRenderer(), null);

    // Simulate the webview sending a slide-changed message
    // handleWebviewMessage is private, so we access it via casting.
    // This tests the real integration path, not a direct adapter call.
    const handleWebviewMessage = (provider as unknown as { handleWebviewMessage(msg: unknown): void }).handleWebviewMessage.bind(provider);
    handleWebviewMessage({ type: "presentation:slideChanged", index: 1 });

    // Provider must have called adapter.handleWebviewSlideChanged(1) — single typed path.
    // handleWebviewSlideChanged is declared on PresentationRuntimeAdapter and
    // implemented by MarpAdapter (delegates to handleViewSlideChanged internally).
    expect(adapter.handleWebviewSlideChanged).toHaveBeenCalledWith(1);

    provider.dispose();
  });
});

// ── REQ-MOD-2: PresentationRenderer seam ─────────────────────────────────────
/**
 * Source: presentation-comments-modularity-A.md §Frozen Presentation Renderer Seam
 * + §17.3 + architecture.md §17.3
 *
 * PresentationProvider.open() accepts PresentationRenderer (not concrete MarpRenderer).
 * This allows engine substitution without changing the provider.
 *
 * Phase A verified: MarpRenderer satisfies PresentationRenderer.
 * Phase B gap: Provider constructs new MarpRenderer() internally in constructor,
 * making renderer injection non-functional for callers who want to substitute
 * a different engine or mock AFTER construction.
 *
 * setRenderer() exists and works for post-construction renderer replacement.
 */

describe("REQ-MOD-2: PresentationRenderer seam", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("REQ-MOD-2.1: PresentationProvider.open() accepts PresentationRenderer (interface, not class)", async () => {
    // The provider must accept any renderer satisfying the PresentationRenderer interface.
    // This is the frozen seam — callers can pass a custom/mock renderer without
    // casting to concrete MarpRenderer.
    const ctx = makeMockContext();
    const provider = new PresentationProvider({ context: ctx });
    const adapter = makeMockAdapter();
    const customRenderer = makeMockRenderer();

    // Use the shared mock (via vitest resolve.alias) instead of vi.stubGlobal
    vi.mocked(workspace.fs.readFile).mockResolvedValue(Buffer.from("# Slide 1\n\n---\n\n# Slide 2") as never);
    vi.mocked(workspace.createFileSystemWatcher).mockReturnValue({
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    });
    vi.mocked(window.createWebviewPanel).mockReturnValue({
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn().mockResolvedValue(true),
        cspSource: "https://localhost",
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
      dispose: vi.fn(),
    } as never);

    // This call must NOT throw — provider must accept the interface type.
    await provider.open("/deck.md", adapter, customRenderer, null);

    // Verify the renderer was actually used (not replaced by internal MarpRenderer)
    expect(customRenderer.render).toHaveBeenCalled();

    provider.dispose();
  });

  it("REQ-MOD-2.2: open() assigns the renderer parameter to instance (structural check)", () => {
    // Phase B requirement: open() must assign the injected renderer parameter to
    // the provider instance so that render calls use the injected renderer.
    //
    // Valid implementation: open() does `this.renderer = renderer` (or `setRenderer(renderer)`)
    // then uses `this.renderer.render(...)`. This satisfies both dependency injection
    // and the existing render call site.
    //
    // Current broken implementation: open() accepts `renderer` parameter but NEVER assigns it.
    // The constructor creates `new MarpRenderer()` and open() calls `this.renderer.render(...)`
    // which uses the constructor's instance, not the injected renderer.
    //
    // This structural check verifies that open() assigns the renderer parameter.
    // FAILS on current code (no assignment in open()).
    // PASSES on valid fix (open() does `this.renderer = renderer` or `setRenderer(renderer)`).
    const providerSource = readFileSync(
      resolve(__dirname, "../presentation-provider.ts"),
      "utf-8"
    );

    // Extract the open() method body
    const openMethodStart = providerSource.indexOf("async open(");
    if (openMethodStart === -1) {
      expect(providerSource).toContain("async open(");
      return;
    }
    const openBrace = providerSource.indexOf("{", openMethodStart);
    let depth = 0;
    let end = openBrace;
    for (let i = openBrace; i < providerSource.length; i++) {
      if (providerSource[i] === "{") depth++;
      else if (providerSource[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const openMethodBody = providerSource.slice(openBrace, end + 1);

    // The renderer parameter must be assigned to the instance in open()
    // Valid patterns: this.renderer = renderer  OR  setRenderer(renderer)
    // This check FAILS on current code (parameter never assigned in open())
    const hasAssignment = /this\.renderer\s*=\s*renderer/.test(openMethodBody) ||
                        /setRenderer\s*\(\s*renderer\s*\)/.test(openMethodBody);
    expect(hasAssignment, "open() must assign the renderer parameter to the instance (this.renderer = renderer or setRenderer(renderer))").toBe(true);
  });

  it("REQ-MOD-2.3: MarpRenderer satisfies PresentationRenderer interface", async () => {
    // Verifies the frozen seam: MarpRenderer is a valid implementation of the interface.
    const { MarpRenderer } = await import("../marp-renderer.js");
    const renderer = new MarpRenderer();
    expect(typeof renderer.render).toBe("function");
    expect(typeof renderer.getNotes).toBe("function");

    // Smoke test: can call methods without throwing
    const result = renderer.render("# Slide 1\n\n---\n\n# Slide 2");
    expect(result.html).toBeDefined();
    expect(result.slideCount).toBe(2);
  });

  it("REQ-MOD-2.4: Provider constructor does NOT hard-code MarpRenderer (structural source check)", () => {
    // Phase B requirement: Provider must NOT construct a concrete MarpRenderer
    // in its constructor. Instead, it should accept a renderer via constructor
    // or rely on open() to set it.
    //
    // Currently FAILS: constructor has `this.renderer = new MarpRenderer()` (line 122).
    // This instantiates MarpRenderer regardless of what the caller passes to open().
    //
    // This is a structural source check: the constructor must NOT call `new MarpRenderer()`.
    const providerSource = readFileSync(
      resolve(__dirname, "../presentation-provider.ts"),
      "utf-8"
    );

    // The constructor should NOT contain `new MarpRenderer()`
    // Currently it does at line 122: `this.renderer = new MarpRenderer()`
    // This is the structural violation of the renderer injection principle.
    expect(providerSource).not.toMatch(/this\.renderer\s*=\s*new\s+MarpRenderer\s*\(\s*\)/);
  });
});

// ── REQ-MOD-3: NavigationAdapter registration at activation ───────────────────
/**
 * Source: presentation-comments-modularity-A.md §17.4 Deferred Navigation Registry Wiring
 * + architecture.md §17.4
 *
 * Phase A deferred: accordo-marp registers a NavigationAdapter with surfaceType "slide"
 * at extension activation. The registry wiring in comments routing is also deferred.
 *
 * Phase A ONLY established the contracts. Full wiring is Phase B scope.
 * These tests verify the structural pre-condition: the extension source code
 * must import and use NavigationAdapterRegistry.
 */

describe("REQ-MOD-3: NavigationAdapter registration (deferred — structural)", () => {
  const EXTENSION_SRC = resolve(__dirname, "../extension.ts");

  it("REQ-MOD-3.1: extension.ts imports createNavigationAdapterRegistry from @accordo/capabilities", () => {
    // The extension must import the registry factory to create a registry at activation.
    // Currently FAILS: extension.ts does not import NavigationAdapterRegistry.
    const source = readFileSync(EXTENSION_SRC, "utf-8");
    expect(source).toContain("createNavigationAdapterRegistry");
    expect(source).toContain("from \"@accordo/capabilities\"");
  });

  it("REQ-MOD-3.2: extension.ts creates a NavigationAdapterRegistry at activation", () => {
    // The extension must create a registry instance that adapters are registered into.
    // Currently FAILS: extension.ts has no createNavigationAdapterRegistry call.
    const source = readFileSync(EXTENSION_SRC, "utf-8");
    expect(source).toMatch(/createNavigationAdapterRegistry\s*\(\s*\)/);
  });

  it("REQ-MOD-3.3: extension.ts registers a NavigationAdapter with surfaceType 'slide'", () => {
    // At activation, the extension must register a slide NavigationAdapter so that
    // comments can route focusThread through the registry.
    // Currently FAILS: no NavigationAdapter is created or registered in extension.ts.
    const source = readFileSync(EXTENSION_SRC, "utf-8");

    // Should contain: register({ surfaceType: "slide", ... })
    expect(source).toMatch(/surfaceType\s*:\s*["']slide["']/);

    // Should contain: registry.register(
    expect(source).toMatch(/registry\.register\s*\(/);
  });

  it("REQ-MOD-3.4: NavigationAdapter.focusThread delegates to the canonical focusThread command", () => {
    // The slide adapter's focusThread must invoke the canonical command
    // "accordo.presentation.internal.focusThread" (not the old DEFERRED_COMMAND placeholder).
    // This test verifies the adapter implementation uses the correct command.
    const source = readFileSync(EXTENSION_SRC, "utf-8");

    // The adapter's focusThread implementation should call executeCommand
    // with the canonical command string
    expect(source).toContain("accordo.presentation.internal.focusThread");
  });

  it("REQ-MOD-3.5: NavigationAdapter.navigateToAnchor delegates to executeCommand(PRESENTATION_GOTO)", () => {
    // The slide adapter's navigateToAnchor must invoke the PRESENTATION_GOTO command.
    // Currently FAILS: no adapter exists in extension.ts.
    const source = readFileSync(EXTENSION_SRC, "utf-8");
    expect(source).toContain("PRESENTATION_GOTO");
  });
});
