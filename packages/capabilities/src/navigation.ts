/**
 * @accordo/capabilities — Shared Navigation Contracts
 *
 * Host-agnostic navigation adapter interfaces for cross-surface
 * comment-thread focusing and slide/page navigation.
 *
 * These contracts enable any Accordo surface (presentation, browser,
 * diagram, markdown preview) to participate in a unified navigation
 * system without cross-package source imports.
 *
 * Source: presentation-comments-modularity-A.md §Navigation contracts
 */

// ── NavigationEnv ────────────────────────────────────────────────────────────

/**
 * Host-agnostic command/navigation environment passed to adapter methods.
 *
 * Allows adapters to execute VS Code commands or equivalent operations
 * without importing `vscode` directly. The host extension wires in
 * the real implementation at registration time.
 */
export interface NavigationEnv {
  /**
   * Execute a command by ID with the given arguments.
   * Mirrors `vscode.commands.executeCommand` semantics.
   */
  executeCommand<T = unknown>(
    command: string,
    ...args: readonly unknown[]
  ): Promise<T>;
}

// ── NavigationAdapter ────────────────────────────────────────────────────────

/**
 * A surface-specific adapter that can navigate to anchors and focus
 * comment threads. Each modality (presentations, browser, diagram, etc.)
 * registers one adapter for its surface type.
 *
 * Lifecycle:
 * - Registered via `NavigationAdapterRegistry.register()`
 * - Unregistered via `NavigationAdapterRegistry.unregister()` or
 *   `NavigationAdapterRegistry.dispose()`
 * - If the adapter has a `dispose()` method, it is called on unregister
 */
export interface NavigationAdapter {
  /**
   * Unique surface type identifier (e.g. "slide", "browser", "diagram").
   * Used as the registry key — must be stable across sessions.
   */
  readonly surfaceType: string;

  /**
   * Navigate to a specific anchor location within the surface.
   *
   * @param anchor - Opaque anchor object (shape depends on surface type)
   * @param env    - Host-agnostic navigation environment
   * @returns true if navigation succeeded, false if the target was not found
   */
  navigateToAnchor(
    anchor: Readonly<Record<string, unknown>>,
    env: NavigationEnv,
  ): Promise<boolean>;

  /**
   * Focus a comment thread in the surface's UI.
   *
   * @param threadId - ID of the thread to focus
   * @param anchor   - Anchor associated with the thread
   * @param env      - Host-agnostic navigation environment
   * @returns true if the thread was found and focused, false otherwise
   */
  focusThread(
    threadId: string,
    anchor: Readonly<Record<string, unknown>>,
    env: NavigationEnv,
  ): Promise<boolean>;

  /**
   * Optional cleanup method called when the adapter is unregistered.
   */
  dispose?(): void;
}

// ── NavigationAdapterRegistry ────────────────────────────────────────────────

/**
 * Registry for navigation adapters. Each surface type has at most one
 * registered adapter.
 *
 * Lifecycle rules:
 * - `register()`: last-writer-wins replacement for same `surfaceType`.
 *   If the previous adapter has `dispose()`, it is called before replacement.
 * - `unregister()`: no-op if absent; calls `dispose()` on the adapter if supported.
 * - `get()`: returns the adapter or `undefined` — callers must handle missing adapters gracefully.
 * - `dispose()`: disposes all registered adapters and clears the registry.
 */
export interface NavigationAdapterRegistry {
  /**
   * Register an adapter for a surface type.
   * If an adapter for the same surfaceType already exists, replaces it
   * (disposing the previous adapter if it has a dispose method).
   */
  register(adapter: NavigationAdapter): void;

  /**
   * Unregister the adapter for a surface type.
   * No-op if no adapter is registered for the given surface type.
   * Calls `adapter.dispose()` if the adapter supports it.
   */
  unregister(surfaceType: string): void;

  /**
   * Get the adapter for a surface type, or undefined if none is registered.
   */
  get(surfaceType: string): NavigationAdapter | undefined;

  /**
   * Dispose all registered adapters and clear the registry.
   */
  dispose(): void;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a new NavigationAdapterRegistry instance.
 *
 * This is the only runtime code in this module — a minimal factory
 * that returns a Map-backed registry. All interface contracts are
 * type-only.
 */
export function createNavigationAdapterRegistry(): NavigationAdapterRegistry {
  const adapters = new Map<string, NavigationAdapter>();

  return {
    register(adapter: NavigationAdapter): void {
      const existing = adapters.get(adapter.surfaceType);
      if (existing?.dispose) {
        existing.dispose();
      }
      adapters.set(adapter.surfaceType, adapter);
    },

    unregister(surfaceType: string): void {
      const existing = adapters.get(surfaceType);
      if (!existing) return;
      if (existing.dispose) {
        existing.dispose();
      }
      adapters.delete(surfaceType);
    },

    get(surfaceType: string): NavigationAdapter | undefined {
      return adapters.get(surfaceType);
    },

    dispose(): void {
      for (const adapter of adapters.values()) {
        if (adapter.dispose) {
          adapter.dispose();
        }
      }
      adapters.clear();
    },
  };
}
