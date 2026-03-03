/**
 * Shared utilities for accordo-editor tool handlers.
 *
 * Source: requirements-editor.md §5.1, §5.2
 */

import * as path from "node:path";
import * as vscode from "vscode";

// ── resolvePath ───────────────────────────────────────────────────────────────

/**
 * Resolve a user-supplied file path to an absolute, workspace-rooted path.
 *
 * Algorithm (requirements-editor.md §5.1):
 *   1. Absolute paths: normalise separators, verify inside a workspace folder.
 *   2. Relative paths: try each workspace root; exactly one match → use it;
 *      multiple matches → throw ambiguous; no match in multi-root → throw;
 *      single-root workspace → resolve against that root.
 *   3. No symlink resolution.
 *   4. Always returns forward-slash-only absolute path.
 *
 * @param input - Raw path string from tool arguments
 * @param workspaceFolders - Optional override (defaults to vscode.workspace.workspaceFolders)
 * @returns Normalised absolute path
 * @throws Error with descriptive message on resolution failure
 */
export function resolvePath(
  input: string,
  workspaceFolders?: string[],
): string {
  const roots = workspaceFolders ?? getWorkspaceRoots();

  // Normalise first so Windows paths (C:\...) become C:/... before the absolute check.
  const normalised = normaliseSlashes(path.normalize(input));
  // Treat as absolute if POSIX-absolute OR Windows drive-letter path (cross-platform support).
  const isAbsolutePath = path.isAbsolute(input) || /^[a-zA-Z]:\//.test(normalised);

  if (isAbsolutePath) {
    if (roots.length > 0 && !isInsideWorkspace(normalised, roots)) {
      throw new Error(`Path is outside workspace: ${normalised}`);
    }
    return normalised;
  }

  // Relative path
  if (roots.length === 0) {
    throw new Error("No workspace folders are open");
  }
  if (roots.length === 1) {
    return normaliseSlashes(path.resolve(roots[0], input));
  }
  // Multi-root: relative paths are ambiguous without an fs stat
  throw new Error(
    `Ambiguous relative path '${input}' — specify an absolute path in a multi-root workspace`,
  );
}

// ── wrapHandler ──────────────────────────────────────────────────────────────

/**
 * Wrap a tool handler so that any thrown error is caught and returned
 * as `{ error: string }` rather than propagating as an unhandled rejection.
 *
 * Also validates that the result is JSON-serialisable (no circular refs,
 * no functions, no undefined values).
 *
 * Algorithm (requirements-editor.md §5.2):
 *   1. try: result = await handler(args)
 *   2. if result is not JSON-serialisable → throw (error cases)
 *   3. return result
 *   4. catch: return { error: err.message }
 *
 * @param name - Tool name for error context (used in thrown error messages)
 * @param handler - Async function implementing the tool
 * @returns Wrapped async handler with identical signature
 */
export function wrapHandler<T extends Record<string, unknown>>(
  _name: string,
  handler: (args: Record<string, unknown>) => Promise<T>,
): (args: Record<string, unknown>) => Promise<T | { error: string }> {
  return async (args) => {
    try {
      const result = await handler(args);
      // Catch non-serialisable results (e.g. circular references)
      JSON.stringify(result);
      return result;
    } catch (err) {
      return { error: errorMessage(err) };
    }
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Extract a human-readable message from a caught error value.
 * Handles both `Error` instances and thrown primitives.
 * @internal
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Normalise all path separators to forward slashes.
 * @internal
 */
export function normaliseSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Check if a given absolute path is inside any of the given workspace roots.
 * Returns true if it falls within at least one root.
 * @internal
 */
export function isInsideWorkspace(
  absolutePath: string,
  roots: string[],
): boolean {
  const norm = normaliseSlashes(path.normalize(absolutePath));
  return roots.some((root) => {
    const normRoot = normaliseSlashes(path.normalize(root));
    const prefix = normRoot.endsWith("/") ? normRoot : normRoot + "/";
    return norm === normRoot || norm.startsWith(prefix);
  });
}

/**
 * Return the workspace folder root paths from vscode.workspace.workspaceFolders.
 * Returns an empty array if no folders are open.
 * @internal
 */
export function getWorkspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) =>
    normaliseSlashes(f.uri.fsPath),
  );
}
