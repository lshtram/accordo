/**
 * navigation-registry.test.ts — Phase B tests for NavigationAdapterRegistry
 * lifecycle rules and contract.
 *
 * Source: presentation-comments-modularity-A.md §17.1 Registry lifecycle rules
 * + architecture.md §17.1
 * Related: capabilities-foundation-phase-a.md §3.1 (navigation contracts in scope)
 *
 * API checklist:
 *   ✓ createNavigationAdapterRegistry — 6 tests (lifecycle rules)
 *   ✓ NavigationAdapterRegistry.register — 3 tests
 *   ✓ NavigationAdapterRegistry.unregister — 2 tests
 *   ✓ NavigationAdapterRegistry.get — 2 tests
 *   ✓ NavigationAdapterRegistry.dispose — 2 tests
 *
 * These tests verify the registry implementation matches the frozen contract.
 * The factory + basic lifecycle tests PASS against the current implementation.
 * The structural/adapter tests FAIL because accordo-marp doesn't register an adapter yet.
 */

import { describe, it, expect, vi } from "vitest";
import { createNavigationAdapterRegistry } from "../navigation.js";
import type { NavigationAdapter, NavigationAdapterRegistry } from "../navigation.js";

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeAdapter(surfaceType: string, withDispose = false): NavigationAdapter {
  const adapter: NavigationAdapter = {
    surfaceType,
    navigateToAnchor: vi.fn().mockResolvedValue(true),
    focusThread: vi.fn().mockResolvedValue(true),
  };
  if (withDispose) {
    adapter.dispose = vi.fn();
  }
  return adapter;
}

// ── REQ-NAV-1: createNavigationAdapterRegistry factory ─────────────────────────

describe("REQ-NAV-1: createNavigationAdapterRegistry factory", () => {
  it("REQ-NAV-1.1: returns an object satisfying NavigationAdapterRegistry", () => {
    const registry = createNavigationAdapterRegistry();
    expect(registry).toHaveProperty("register");
    expect(registry).toHaveProperty("unregister");
    expect(registry).toHaveProperty("get");
    expect(registry).toHaveProperty("dispose");
    expect(typeof registry.register).toBe("function");
    expect(typeof registry.unregister).toBe("function");
    expect(typeof registry.get).toBe("function");
    expect(typeof registry.dispose).toBe("function");
  });

  it("REQ-NAV-1.2: newly created registry has no adapters", () => {
    const registry = createNavigationAdapterRegistry();
    expect(registry.get("any")).toBeUndefined();
  });

  it("REQ-NAV-1.3: dispose() on empty registry does not throw", () => {
    const registry = createNavigationAdapterRegistry();
    expect(() => registry.dispose()).not.toThrow();
  });
});

// ── REQ-NAV-2: register() lifecycle ──────────────────────────────────────────

describe("REQ-NAV-2: register() lifecycle", () => {
  it("REQ-NAV-2.1: registered adapter is retrievable by surfaceType", () => {
    const registry = createNavigationAdapterRegistry();
    const adapter = makeAdapter("slide");
    registry.register(adapter);
    expect(registry.get("slide")).toBe(adapter);
    registry.dispose();
  });

  it("REQ-NAV-2.2: last-writer-wins — re-registering same surfaceType replaces and disposes previous", () => {
    // When an adapter for an existing surfaceType is registered:
    // 1. The previous adapter is disposed (if it has dispose())
    // 2. The new adapter replaces it
    const registry = createNavigationAdapterRegistry();

    const oldAdapter = makeAdapter("slide", true); // has dispose
    const newAdapter = makeAdapter("slide", false);

    registry.register(oldAdapter);
    registry.register(newAdapter);

    expect(oldAdapter.dispose).toHaveBeenCalled();
    expect(registry.get("slide")).toBe(newAdapter);
    registry.dispose();
  });

  it("REQ-NAV-2.3: register() with no dispose() on previous — replaces without throw", () => {
    // If the previous adapter has no dispose(), replacement still works.
    const registry = createNavigationAdapterRegistry();

    const oldAdapter = makeAdapter("slide", false); // no dispose
    const newAdapter = makeAdapter("slide", true);

    registry.register(oldAdapter);
    registry.register(newAdapter); // must not throw even though oldAdapter.dispose is undefined

    expect(registry.get("slide")).toBe(newAdapter);
    registry.dispose();
  });
});

// ── REQ-NAV-3: unregister() lifecycle ─────────────────────────────────────────

describe("REQ-NAV-3: unregister() lifecycle", () => {
  it("REQ-NAV-3.1: unregister() removes adapter and calls dispose() if supported", () => {
    const registry = createNavigationAdapterRegistry();
    const adapter = makeAdapter("slide", true);
    registry.register(adapter);

    registry.unregister("slide");

    expect(adapter.dispose).toHaveBeenCalled();
    expect(registry.get("slide")).toBeUndefined();
    registry.dispose();
  });

  it("REQ-NAV-3.2: unregister() for absent surfaceType is no-op (no throw)", () => {
    const registry = createNavigationAdapterRegistry();
    expect(() => registry.unregister("never-registered")).not.toThrow();
    expect(registry.get("never-registered")).toBeUndefined();
    registry.dispose();
  });
});

// ── REQ-NAV-4: get() contract ─────────────────────────────────────────────────

describe("REQ-NAV-4: get() contract", () => {
  it("REQ-NAV-4.1: get() returns registered adapter", () => {
    const registry = createNavigationAdapterRegistry();
    const adapter = makeAdapter("browser");
    registry.register(adapter);
    expect(registry.get("browser")).toBe(adapter);
    registry.dispose();
  });

  it("REQ-NAV-4.2: get() returns undefined for absent surfaceType (never throws)", () => {
    const registry = createNavigationAdapterRegistry();
    expect(() => registry.get("xyz")).not.toThrow();
    expect(registry.get("xyz")).toBeUndefined();
    registry.dispose();
  });
});

// ─- REQ-NAV-5: dispose() lifecycle ────────────────────────────────────────────

describe("REQ-NAV-5: dispose() lifecycle", () => {
  it("REQ-NAV-5.1: dispose() calls dispose() on all registered adapters", () => {
    const registry = createNavigationAdapterRegistry();
    const slideAdapter = makeAdapter("slide", true);
    const browserAdapter = makeAdapter("browser", true);
    registry.register(slideAdapter);
    registry.register(browserAdapter);

    registry.dispose();

    expect(slideAdapter.dispose).toHaveBeenCalled();
    expect(browserAdapter.dispose).toHaveBeenCalled();
  });

  it("REQ-NAV-5.2: dispose() clears the registry (get() returns undefined for all)", () => {
    const registry = createNavigationAdapterRegistry();
    registry.register(makeAdapter("slide"));
    registry.register(makeAdapter("browser"));
    registry.dispose();

    expect(registry.get("slide")).toBeUndefined();
    expect(registry.get("browser")).toBeUndefined();
  });

  it("REQ-NAV-5.3: dispose() is idempotent (can be called multiple times)", () => {
    const registry = createNavigationAdapterRegistry();
    registry.register(makeAdapter("slide"));
    registry.dispose();
    expect(() => registry.dispose()).not.toThrow();
    expect(() => registry.dispose()).not.toThrow();
  });
});

// ── REQ-NAV-6: Missing adapter graceful degradation ───────────────────────────
/**
 * Source: presentation-comments-modularity-A.md §17.1 Registry lifecycle rules
 * "Missing adapter fallback: comments routing degrades gracefully, no throw"
 */

describe("REQ-NAV-6: Missing adapter graceful degradation", () => {
  it("REQ-NAV-6.1: get() for never-registered surfaceType returns undefined (no throw)", () => {
    const registry = createNavigationAdapterRegistry();
    expect(registry.get("not-registered")).toBeUndefined();
    registry.dispose();
  });

  it("REQ-NAV-6.2: disposing an already-disposed registry is safe", () => {
    const registry = createNavigationAdapterRegistry();
    registry.dispose();
    expect(() => registry.unregister("any")).not.toThrow();
    expect(() => registry.register(makeAdapter("new"))).not.toThrow();
  });
});

// ── REQ-NAV-7: NavigationEnv interface ────────────────────────────────────────
/**
 * Source: presentation-comments-modularity-A.md §17.1
 * NavigationEnv is passed to adapter methods so adapters can execute commands
 * without importing vscode directly.
 */

describe("REQ-NAV-7: NavigationEnv interface compatibility", () => {
  it("REQ-NAV-7.1: NavigationAdapter.navigateToAnchor accepts NavigationEnv", async () => {
    const registry = createNavigationAdapterRegistry();
    const adapter = makeAdapter("slide");
    registry.register(adapter);

    const env = {
      executeCommand: vi.fn().mockResolvedValue(undefined),
    };

    // navigateToAnchor must accept a NavigationEnv-like object
    const result = await adapter.navigateToAnchor(
      { slideIndex: 1, type: "slide" } as Record<string, unknown>,
      env,
    );

    expect(result).toBe(true);
    registry.dispose();
  });

  it("REQ-NAV-7.2: NavigationAdapter.focusThread accepts NavigationEnv", async () => {
    const registry = createNavigationAdapterRegistry();
    const adapter = makeAdapter("slide");
    registry.register(adapter);

    const env = {
      executeCommand: vi.fn().mockResolvedValue(undefined),
    };

    const result = await adapter.focusThread("thread-42", {} as Record<string, unknown>, env);
    expect(result).toBe(true);
    registry.dispose();
  });
});
