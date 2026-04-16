/**
 * navigation-registry-integration.test.ts — Phase B failing tests for
 * presentation+comments navigation routing via NavigationAdapterRegistry.
 *
 * Source: presentation-comments-modularity-A.md §17.4 Deferred Navigation Registry Wiring
 * Architecture: architecture.md §17.1, §17.4
 *
 * API checklist:
 *   ✓ navigateToThread — 4 tests (registry routing for surface:slide)
 *
 * Tests MUST fail at assertion level against current codebase.
 * The Phase A design requires navigateToThread to route surface:slide through
 * NavigationAdapterRegistry.get("slide").focusThread() rather than calling
 * DEFERRED_COMMANDS.PRESENTATION_GOTO directly.
 *
 * Phase A deferred: The registry wiring is not yet implemented in navigateToThread.
 * The current code uses DEFERRED_COMMANDS directly (hardcoded path).
 * These tests document the routing behavior that Phase B implementation must provide.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { navigateToThread } from "../../panel/navigation-router.js";
import type { NavigationEnv } from "../../panel/navigation-router.js";
import type { CommentThread } from "@accordo/bridge-types";
import { DEFERRED_COMMANDS } from "@accordo/capabilities";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeThread(anchor: CommentThread["anchor"]): CommentThread {
  return {
    id: "thread-1",
    anchor,
    comments: [{
      id: "c1",
      threadId: "thread-1",
      createdAt: "2026-03-06T00:00:00Z",
      author: { kind: "user", name: "User" },
      body: "Test",
      anchor,
      status: "open",
    }],
    status: "open",
    createdAt: "2026-03-06T00:00:00Z",
    lastActivity: "2026-03-06T00:00:00Z",
  };
}

// ── Mock NavigationEnv ────────────────────────────────────────────────────────

interface MockNavigationEnv extends NavigationEnv {
  showTextDocument: ReturnType<typeof vi.fn>;
  executeCommand: ReturnType<typeof vi.fn>;
  showWarningMessage: ReturnType<typeof vi.fn>;
  showInformationMessage: ReturnType<typeof vi.fn>;
  delay: ReturnType<typeof vi.fn>;
  visibleTextEditorUris: ReturnType<typeof vi.fn>;
}

function makeEnv(): MockNavigationEnv {
  return {
    showTextDocument: vi.fn().mockResolvedValue({ revealRange: vi.fn() }),
    executeCommand: vi.fn().mockResolvedValue(undefined),
    showWarningMessage: vi.fn().mockResolvedValue(undefined),
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockResolvedValue(undefined),
    visibleTextEditorUris: vi.fn().mockReturnValue([]),
  };
}

// ── REQ-NR-1: NavigationAdapterRegistry routing for surface:slide ──────────────
/**
 * Source: presentation-comments-modularity-A.md §17.4 + architecture.md §17.1
 *
 * The Phase A deferred migration path (§17.4) requires:
 * 1. accordo-marp registers a NavigationAdapter with surfaceType="slide" at activation
 * 2. accordo-comments routes focusThread through registry instead of DEFERRED_COMMANDS
 * 3. Graceful degradation when no slide adapter is registered
 *
 * These tests verify the structural pre-condition: navigateToThread must accept
 * a NavigationAdapterRegistry so it can route surface:slide calls through the registry.
 *
 * Current behavior: navigateToThread calls DEFERRED_COMMANDS.PRESENTATION_GOTO directly.
 * Desired behavior: navigateToThread accepts a registry and calls
 *   registry.get("slide")?.focusThread() instead of DEFERRED_COMMANDS directly.
 */

describe("REQ-NR-1: NavigationAdapterRegistry routing for surface:slide", () => {
  let env: MockNavigationEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  it("REQ-NR-1.1: navigateToThread accepts a NavigationAdapterRegistry parameter", () => {
    // The Phase A deferred refactor requires navigateToThread to accept a registry
    // so it can route surface:slide calls through the registry.
    // Currently FAILS: navigateToThread signature is:
    //   (thread: CommentThread, env: NavigationEnv) => Promise<void>
    // No registry parameter exists.
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../panel/navigation-router.ts"),
      "utf-8"
    );

    // navigateToThread should accept a third parameter: registry: NavigationAdapterRegistry
    // Currently the source does not contain a registry parameter in navigateToThread
    expect(source).toMatch(/navigateToThread\s*\([^)]*registry[^)]*\)/);
  });

  it("REQ-NR-1.2: navigateToThread calls registry.get('slide') for surface:slide routing", async () => {
    // When routing a surface:slide thread, navigateToThread must call
    // registry.get("slide") and use the returned adapter.
    // Currently FAILS: no registry parameter, so no registry lookup happens.
    const slideAdapter = {
      surfaceType: "slide" as const,
      navigateToAnchor: vi.fn().mockResolvedValue(true),
      focusThread: vi.fn().mockResolvedValue(true),
    };

    const mockRegistry = {
      get: vi.fn().mockReturnValue(slideAdapter),
      register: vi.fn(),
      unregister: vi.fn(),
      dispose: vi.fn(),
    };

    const anchor: CommentThread["anchor"] = {
      kind: "surface",
      uri: "file:///deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 3, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);

    // navigateToThread should call registry.get("slide") when routing surface:slide
    // Since the current implementation has no registry parameter,
    // we check that the registry.get was called (it won't be).
    // This test FAILS because navigateToThread doesn't have a registry to call.
    await navigateToThread(thread, env, mockRegistry);

    expect(mockRegistry.get).toHaveBeenCalledWith("slide");
  });

  it("REQ-NR-1.3: navigateToThread calls adapter.focusThread when slide adapter exists", async () => {
    // When registry.get("slide") returns an adapter, navigateToThread must call
    // adapter.focusThread(threadId, anchor, env) instead of DEFERRED_COMMANDS.
    // Currently FAILS: navigateToThread has no registry parameter.
    const focusThreadMock = vi.fn().mockResolvedValue(true);
    const slideAdapter = {
      surfaceType: "slide" as const,
      navigateToAnchor: vi.fn().mockResolvedValue(true),
      focusThread: focusThreadMock,
    };

    const mockRegistry = {
      get: vi.fn().mockReturnValue(slideAdapter),
      register: vi.fn(),
      unregister: vi.fn(),
      dispose: vi.fn(),
    };

    const anchor: CommentThread["anchor"] = {
      kind: "surface",
      uri: "file:///deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 3, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);

    await navigateToThread(thread, env, mockRegistry);

    // The slide adapter's focusThread must be called
    expect(focusThreadMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: "surface", surfaceType: "slide" }),
      expect.objectContaining({ executeCommand: expect.any(Function) }),
    );
  });

  it("REQ-NR-1.4: navigateToThread falls back to DEFERRED_COMMANDS when registry returns undefined", async () => {
    // When no slide adapter is registered (registry.get("slide") is undefined),
    // navigateToThread must fall back to the DEFERRED_COMMANDS path.
    // This is the graceful degradation requirement from §17.4.
    const mockRegistry = {
      get: vi.fn().mockReturnValue(undefined),
      register: vi.fn(),
      unregister: vi.fn(),
      dispose: vi.fn(),
    };

    const anchor: CommentThread["anchor"] = {
      kind: "surface",
      uri: "file:///deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 3, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);

    await navigateToThread(thread, env, mockRegistry);

    // Should fall back to DEFERRED_COMMANDS
    expect(env.executeCommand).toHaveBeenCalledWith(
      DEFERRED_COMMANDS.PRESENTATION_GOTO,
      3,
    );
  });

  it("REQ-NR-1.5: surface:slide graceful degradation — no throw + user-visible message", async () => {
    // Graceful degradation requirement (§17.4): when no adapter exists and deferred
    // commands fail, navigateToThread must NOT throw. It must show a user-visible
    // message (information or warning) so the user knows navigation failed.
    //
    // The specific message type (info vs warning) is an implementation detail.
    // What matters semantically: (1) no exception propagates, (2) user is informed.
    //
    // Sequence:
    // 1. PRESENTATION_GOTO (first) → throws (goto fails)
    // 2. accordo.presentation.open → succeeds (deck opens)
    // 3. delay(2000) → resolves
    // 4. PRESENTATION_GOTO (second) → throws (goto still fails)
    // 5. Inner catch → user-visible message (information OR warning)
    const mockRegistry = {
      get: vi.fn().mockReturnValue(undefined),
      register: vi.fn(),
      unregister: vi.fn(),
      dispose: vi.fn(),
    };

    const anchor: CommentThread["anchor"] = {
      kind: "surface",
      uri: "file:///deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 2, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);

    env.executeCommand.mockImplementation(async (cmd: string) => {
      if (cmd === DEFERRED_COMMANDS.PRESENTATION_GOTO) {
        throw new Error("command not available");
      }
      if (cmd === "accordo.presentation.open") {
        return undefined; // succeed so we reach the inner catch
      }
      return undefined;
    });

    await navigateToThread(thread, env, mockRegistry);

    // Semantic requirements for graceful degradation:
    // 1. No exception propagates (navigateToThread resolves without throwing)
    // 2. A user-visible message is shown (information OR warning)
    const infoCalled = env.showInformationMessage.mock.calls.length > 0;
    const warnCalled = env.showWarningMessage.mock.calls.length > 0;
    expect(infoCalled || warnCalled,
      "Expected either showInformationMessage or showWarningMessage to be called").toBe(true);
  });
});

// ── REQ-NR-2: NavigationAdapterRegistry lifecycle contract ─────────────────────
/**
 * Source: presentation-comments-modularity-A.md §17.1 Registry lifecycle rules
 * + architecture.md §17.1
 *
 * These tests verify the registry lifecycle rules are correctly implemented
 * by the factory in @accordo/capabilities. They serve as documentation of
 * the expected contract and catch regressions in the registry implementation.
 */

describe("REQ-NR-2: NavigationAdapterRegistry lifecycle contract", () => {
  it("REQ-NR-2.1: register() / get() roundtrip", async () => {
    // Basic lifecycle: register an adapter, retrieve it by surfaceType.
    const { createNavigationAdapterRegistry } = await import("@accordo/capabilities");
    const registry = createNavigationAdapterRegistry();

    const adapter = {
      surfaceType: "test",
      navigateToAnchor: vi.fn().mockResolvedValue(true),
      focusThread: vi.fn().mockResolvedValue(true),
    };

    registry.register(adapter);
    expect(registry.get("test")).toBe(adapter);
    registry.dispose();
  });

  it("REQ-NR-2.2: register() last-writer-wins for same surfaceType", async () => {
    // When registering two adapters for the same surfaceType, the second
    // replaces the first (disposing the first if it has dispose()).
    const { createNavigationAdapterRegistry } = await import("@accordo/capabilities");
    const registry = createNavigationAdapterRegistry();

    const firstAdapter = {
      surfaceType: "slide",
      navigateToAnchor: vi.fn().mockResolvedValue(true),
      focusThread: vi.fn().mockResolvedValue(true),
      dispose: vi.fn(),
    };
    const secondAdapter = {
      surfaceType: "slide",
      navigateToAnchor: vi.fn().mockResolvedValue(true),
      focusThread: vi.fn().mockResolvedValue(true),
    };

    registry.register(firstAdapter);
    registry.register(secondAdapter);

    // Second adapter wins
    expect(registry.get("slide")).toBe(secondAdapter);
    // First adapter was disposed
    expect(firstAdapter.dispose).toHaveBeenCalled();
    registry.dispose();
  });

  it("REQ-NR-2.3: unregister() disposes adapter and removes it", async () => {
    // unregister() must call dispose() on the adapter (if supported) and remove it.
    const { createNavigationAdapterRegistry } = await import("@accordo/capabilities");
    const registry = createNavigationAdapterRegistry();

    const adapter = {
      surfaceType: "slide",
      navigateToAnchor: vi.fn().mockResolvedValue(true),
      focusThread: vi.fn().mockResolvedValue(true),
      dispose: vi.fn(),
    };

    registry.register(adapter);
    registry.unregister("slide");

    expect(adapter.dispose).toHaveBeenCalled();
    expect(registry.get("slide")).toBeUndefined();
    registry.dispose();
  });

  it("REQ-NR-2.4: unregister() is no-op for absent surfaceType", async () => {
    // Calling unregister() for a non-existent surfaceType must not throw.
    const { createNavigationAdapterRegistry } = await import("@accordo/capabilities");
    const registry = createNavigationAdapterRegistry();

    expect(() => registry.unregister("nonexistent")).not.toThrow();
    expect(registry.get("nonexistent")).toBeUndefined();
    registry.dispose();
  });

  it("REQ-NR-2.5: dispose() disposes all adapters and clears registry", async () => {
    // dispose() must call dispose() on all registered adapters and clear the registry.
    const { createNavigationAdapterRegistry } = await import("@accordo/capabilities");
    const registry = createNavigationAdapterRegistry();

    const slideAdapter = {
      surfaceType: "slide",
      navigateToAnchor: vi.fn().mockResolvedValue(true),
      focusThread: vi.fn().mockResolvedValue(true),
      dispose: vi.fn(),
    };
    const browserAdapter = {
      surfaceType: "browser",
      navigateToAnchor: vi.fn().mockResolvedValue(true),
      focusThread: vi.fn().mockResolvedValue(true),
      dispose: vi.fn(),
    };

    registry.register(slideAdapter);
    registry.register(browserAdapter);
    registry.dispose();

    expect(slideAdapter.dispose).toHaveBeenCalled();
    expect(browserAdapter.dispose).toHaveBeenCalled();
    expect(registry.get("slide")).toBeUndefined();
    expect(registry.get("browser")).toBeUndefined();
  });

  it("REQ-NR-2.6: get() returns undefined for absent surfaceType (no throw)", async () => {
    // Callers must handle missing adapters gracefully — get() never throws.
    const { createNavigationAdapterRegistry } = await import("@accordo/capabilities");
    const registry = createNavigationAdapterRegistry();

    expect(() => registry.get("absent")).not.toThrow();
    expect(registry.get("absent")).toBeUndefined();
    registry.dispose();
  });
});
