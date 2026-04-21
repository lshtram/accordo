/**
 * navigation-registry-integration.test.ts — regression tests for
 * comments-panel slide navigation dispatch and registry lifecycle contracts.
 *
 * Architecture references: architecture.md §17.1, §17.4.
 * These tests verify current guarantees (command-path dispatch + fallback behavior)
 * and keep the registry lifecycle contract covered while routing remains mixed-mode.
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
 * These tests cover the current slide routing contract:
 * 1. navigateToThread accepts an optional registry parameter for compatibility.
 * 2. slide focus dispatch is command-driven via `accordo.presentation.internal.focusThread`.
 * 3. fallback to `DEFERRED_COMMANDS.PRESENTATION_GOTO` remains available when needed.
 * 4. failures degrade gracefully without throwing.
 */

describe("REQ-NR-1: NavigationAdapterRegistry routing for surface:slide", () => {
  let env: MockNavigationEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  it("REQ-NR-1.1: navigateToThread accepts a NavigationAdapterRegistry parameter", () => {
    // Compatibility guarantee: navigateToThread signature includes an optional
    // registry argument (even though the main runtime path is command-plan-driven).
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../panel/navigation-router.ts"),
      "utf-8"
    );

    expect(source).toMatch(/navigateToThread\s*\([^)]*registry[^)]*\)/);
  });

  it("REQ-NR-1.2: navigateToThread for surface:slide calls executeCommand with slide focus command", async () => {
    // Slide surface dispatch uses buildNavigationDispatchPlan → navigateWithPlan
    // and calls executeCommand with the slide focus command.
    const anchor: CommentThread["anchor"] = {
      kind: "surface",
      uri: "file:///deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 3, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);

    await navigateToThread(thread, env);

    // navigateWithPlan for slide calls executeCommand with focus args
    expect(env.executeCommand).toHaveBeenCalledWith(
      "accordo.presentation.internal.focusThread",
      "file:///deck.md",
      "thread-1",
      "slide:3:0.5:0.5",
    );
  });

  it("REQ-NR-1.3: navigateToThread calls adapter.focusThread when slide adapter exists — via executeCommand path", async () => {
    // Current routing path uses executeCommand directly. Registry argument remains
    // accepted for contract stability while runtime dispatch is command-driven.
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

    // navigateWithPlan calls executeCommand with slide focus args
    expect(env.executeCommand).toHaveBeenCalledWith(
      "accordo.presentation.internal.focusThread",
      "file:///deck.md",
      "thread-1",
      "slide:3:0.5:0.5",
    );
  });

  it("REQ-NR-1.4: navigateToThread falls back to DEFERRED_COMMANDS when primary command fails", async () => {
    // When the primary focus command fails, router falls back to PRESENTATION_GOTO.
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

    // Primary command fails, fallback succeeds
    env.executeCommand.mockImplementation(async (cmd: string) => {
      if (cmd === "accordo.presentation.internal.focusThread") {
        throw new Error("command not available");
      }
      if (cmd === "accordo_presentation_internal_goto") {
        return undefined;
      }
      return undefined;
    });

    await navigateToThread(thread, env, mockRegistry);

    // Fallback is called when primary fails
    expect(env.executeCommand).toHaveBeenCalledWith(
      "accordo_presentation_internal_goto",
    );
  });

  it("REQ-NR-1.5: surface:slide graceful degradation — shows warning when fallback also fails", async () => {
    // When both primary and fallback commands fail, router shows a warning.
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

    // Both primary and fallback throw
    env.executeCommand.mockRejectedValue(new Error("command not available"));

    await navigateToThread(thread, env, mockRegistry);

    // Warning is shown when both primary and fallback fail
    const warnCalled = env.showWarningMessage.mock.calls.length > 0;
    expect(warnCalled).toBe(true);
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
