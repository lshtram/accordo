/**
 * Project Identity — stable per-workspace identifier
 *
 * Used by the Bridge to scope its reconnect state (SecretStorage keys, registry
 * entries) so that two VS Code windows opened on different projects do not
 * accidentally share or overwrite each other's Hub process state.
 *
 * Design:
 * - projectId is derived from the workspace root path.
 *   For a non-empty workspace, the path is sanitized (replacing unsafe chars).
 *   For an empty/no-folder window, a deterministic fallback ID is used so that
 *   all empty-window sessions share the same isolated "empty-workspace" slot.
 * - scopedSecretKey() prepends "accordo." and the projectId to a key suffix.
 *
 * Requirements: requirements-bridge.md §4 (LCM-01 scope)
 */

import * as crypto from "node:crypto";

/**
 * Convert a workspace root path to a stable project identifier.
 *
 * Replaces path separators and characters that are unsafe for file paths
 * with dashes. Collapses runs of dashes. Appends a short hex hash of the
 * original path to all but the most trivially-short inputs, making collisions
 * extremely unlikely even if two different paths sanitize to the same string.
 *
 * For empty/no-folder windows (empty string input), returns a deterministic
 * 32-char hex string derived from the sentinel so that all such windows share
 * the same isolated "empty-workspace" slot.
 */
export function getProjectId(workspaceRoot: string): string {
  if (workspaceRoot && workspaceRoot.trim() !== "") {
    // Normalize path separators and remove unsafe filesystem chars.
    // Both forward slash (POSIX) and backslash (Windows) are replaced so the
    // resulting ID is consistent across platforms.
    const sanitized = workspaceRoot
      .replace(/[\\/:*?"<>|]/g, "-")  // backslash, forward slash, colons, other unsafe chars → dash
      .replace(/-+/g, "-");            // collapse runs of dashes

    // Trivial inputs (single short token) get only a hash to keep the result
    // compact and collision-resistant for edge cases like "/tmp" or "C:\".
    if (sanitized.length <= 8) {
      return `h-${crypto.createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 8)}`;
    }

    // Otherwise: readable prefix (up to 24 chars) + 8-char hash suffix.
    // The hash makes collisions near-impossible while keeping the prefix readable.
    const prefix = sanitized.slice(0, 24);
    const suffix = crypto.createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 8);
    return `${prefix}-${suffix}`;
  }

  // Empty workspace — deterministic fallback so all empty windows share the
  // same isolated slot (won't collide with any real project path).
  return crypto.createHash("sha256").update("__empty-workspace__").digest("hex").slice(0, 32);
}

/**
 * Prefix a SecretStorage key with the project scope.
 * Results in "accordo.<projectId>.<keySuffix>".
 */
export function scopedSecretKey(keySuffix: string, projectId: string): string {
  return `accordo.${projectId}.${keySuffix}`;
}

/**
 * Bridge secret key suffix (used with scopedSecretKey).
 */
export const BRIDGE_SECRET_KEY = "bridgeSecret";

/**
 * Hub token key suffix (used with scopedSecretKey).
 */
export const HUB_TOKEN_KEY = "hubToken";
