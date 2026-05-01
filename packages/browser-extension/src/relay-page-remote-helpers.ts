/**
 * GAP-D1 — Spatial Relations Remote Page Helpers
 *
 * Extracted from relay-page-remote.ts for modularity:
 * - spatial routing frame derivation
 * - generic frame routing derivation
 *
 * Each helper <= 30 lines.
 *
 * @module
 */

import type { RelayActionRequest } from "./relay-definitions.js";
import { parseUid } from "./spatial-grammar.js";

// ── GAP-D1: Spatial routing frame derivation ─────────────────────────────────

/**
 * GAP-D1 — Derive routing frame for get_spatial_relations from validated payload.uids[]
 * using the canonical shared UID parser.
 *
 * Routing contract:
 * - uids[] with same-frame "main"           -> route to main frame
 * - uids[] with same-frame non-main         -> route to that iframe via handleFrameIdRequest
 * - nodeIds[] (no valid same-frame uids)    -> route to main frame
 * - malformed/mixed-frame/mixed uids[]      -> undefined (let content validation surface invalid-request)
 * - legacy payload.frameId / singular uid   -> ignored for routing
 *
 * Returns the target frameId for routing, or undefined to fall through to main-frame path.
 */
export function getSpatialRoutingFrame(payload: Record<string, unknown>): string | undefined {
  const uids = payload.uids;
  if (!Array.isArray(uids) || uids.length === 0) return "main";
  const first = uids[0];
  if (typeof first !== "string") return undefined;
  const parsed = parseUid(first);
  if (parsed === null) return undefined;
  for (let i = 1; i < uids.length; i++) {
    const item = uids[i];
    if (typeof item !== "string") return undefined;
    const p = parseUid(item);
    if (p === null || p.frameId !== parsed.frameId) return undefined;
  }
  return parsed.frameId;
}

// ── Generic frame routing derivation ────────────────────────────────────────

export function deriveFrameId(payload: Record<string, unknown>): string | undefined {
  const rawFrameId = payload.frameId;
  const uid = typeof payload.uid === "string" ? payload.uid : undefined;
  const uidFrameId = uid && uid.includes(":") ? uid.slice(0, uid.lastIndexOf(":")) : undefined;
  if (typeof rawFrameId === "string" && rawFrameId.trim().length > 0) {
    return rawFrameId === "main" ? undefined : rawFrameId;
  }
  return uidFrameId === "main" ? undefined : uidFrameId;
}

// ── Spatial routing decision (returns frameId or "main" or undefined) ───────

export function spatialRoutingDecision(payload: Record<string, unknown>): string | undefined {
  return getSpatialRoutingFrame(payload);
}
