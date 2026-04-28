/**
 * spatial-relations-contract-narrow.ts — Per-field narrowing helpers.
 *
 * Extracted from spatial-relations-contract.ts (narrowSpatialArgs ~48 lines).
 * Each helper <= 15 lines.
 *
 * @module
 */

import type { GetSpatialRelationsArgs } from "./page-tool-meta-types.js";

// ── snapshotId ───────────────────────────────────────────────────────────────

export function narrowSnapshotId(obj: Record<string, unknown>): string | null {
  return typeof obj["snapshotId"] === "string" ? (obj["snapshotId"] as string) : null;
}

// ── nodeIds ──────────────────────────────────────────────────────────────────

export function narrowNodeIds(obj: Record<string, unknown>, result: GetSpatialRelationsArgs): void {
  if (Array.isArray(obj["nodeIds"])) {
    const nodeIds = (obj["nodeIds"] as unknown[]).filter(
      (id): id is number => typeof id === "number" && Number.isInteger(id) && id >= 0,
    );
    if (nodeIds.length > 0) result.nodeIds = nodeIds;
  }
}

// ── uids ─────────────────────────────────────────────────────────────────────

export function narrowUids(obj: Record<string, unknown>, result: GetSpatialRelationsArgs): void {
  if (Array.isArray(obj["uids"])) {
    const uids = (obj["uids"] as unknown[]).filter(
      (uid): uid is string => typeof uid === "string" && uid.length > 0,
    );
    if (uids.length > 0) result.uids = uids;
  }
}

// ── tabId ────────────────────────────────────────────────────────────────────

export function narrowTabId(obj: Record<string, unknown>, result: GetSpatialRelationsArgs): void {
  if (typeof obj["tabId"] === "number") {
    result.tabId = obj["tabId"];
  }
}

// ── origins ──────────────────────────────────────────────────────────────────

export function narrowOrigins(obj: Record<string, unknown>, result: GetSpatialRelationsArgs): void {
  if (Array.isArray(obj["allowedOrigins"])) {
    result.allowedOrigins = obj["allowedOrigins"] as string[];
  }
  if (Array.isArray(obj["deniedOrigins"])) {
    result.deniedOrigins = obj["deniedOrigins"] as string[];
  }
}

// ── Non-empty checks ─────────────────────────────────────────────────────────

export function hasNonEmptyNodeIds(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj["nodeIds"]) && (obj["nodeIds"] as unknown[]).length > 0;
}

export function hasNonEmptyUids(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj["uids"]) && (obj["uids"] as unknown[]).length > 0;
}