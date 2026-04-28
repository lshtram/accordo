/**
 * spatial-relations-runtime-relay.ts — Relay response processing helpers (stage 3-6).
 *
 * Extracted from spatial-relations-runtime-helpers.ts.
 * Re-exports cap/guard helpers from spatial-relations-runtime-caps.ts.
 *
 * @module
 */

import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotEnvelopeFields } from "./types.js";
import type { SecurityConfig } from "./security/index.js";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SpatialRelationsToolError } from "./spatial-relations-tool.js";
import type { SpatialRelationsResponse } from "./page-tool-meta-types.js";
import { forwardSpatialRelations } from "./spatial-relations-relay-call.js";
import { classifySpatialError, buildSpatialError } from "./spatial-relations-error-map.js";
import { completeAuditBlocked, completeAuditAllowed } from "./spatial-relations-audit.js";
import type { beginSpatialAudit } from "./spatial-relations-audit.js";
import { checkRelayOrigin } from "./spatial-relations-origin.js";
import { checkCountCap, guardResponseObject } from "./spatial-relations-runtime-caps.js";

// Stage 3 — relay error classifier
export function classifyRelayErrorResponse(
  resp: Record<string, unknown>,
  security: SecurityConfig,
  entry: ReturnType<typeof beginSpatialAudit>["entry"],
  startTime: number,
): SpatialRelationsToolError | null {
  if (!resp["success"] || resp["data"] === undefined) {
    completeAuditBlocked(security, entry, startTime);
    return buildSpatialError(classifySpatialError(resp["error"] as string | undefined));
  }
  return null;
}

// Stage 4 — origin policy
export function checkOriginPolicyResponse(
  respData: Record<string, unknown>,
  security: SecurityConfig,
  args: Parameters<typeof forwardSpatialRelations>[1],
  entry: ReturnType<typeof beginSpatialAudit>["entry"],
  startTime: number,
): SpatialRelationsToolError | null {
  const data = respData["data"] as Record<string, unknown> | undefined;
  const pageUrl = (data?.pageUrl as string | undefined) ?? (respData["pageUrl"] as string | undefined);
  if (checkRelayOrigin(pageUrl, security, args.allowedOrigins, args.deniedOrigins) === "blocked") {
    completeAuditBlocked(security, entry, startTime);
    return buildSpatialError("origin-blocked");
  }
  return null;
}

// Stage 5 — narrow response
export function narrowResponse(
  respData: unknown,
  security: SecurityConfig,
  entry: ReturnType<typeof beginSpatialAudit>["entry"],
  startTime: number,
): SpatialRelationsResponse | SpatialRelationsToolError {
  if (typeof respData !== "object" || respData === null) {
    completeAuditBlocked(security, entry, startTime);
    return buildSpatialError(classifySpatialError("action-failed"));
  }
  const obj = respData as Record<string, unknown>;
  if (!Array.isArray(obj["relations"])) {
    completeAuditBlocked(security, entry, startTime);
    return buildSpatialError(classifySpatialError("action-failed"));
  }
  if (!hasSnapshotEnvelope(respData)) {
    completeAuditBlocked(security, entry, startTime);
    return buildSpatialError(classifySpatialError("action-failed"));
  }
  return respData as SpatialRelationsResponse;
}

// Stage 6 — success path
export function completeSpatialSuccess(
  respData: unknown,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
  entry: ReturnType<typeof beginSpatialAudit>["entry"],
  startTime: number,
): SpatialRelationsResponse | SpatialRelationsToolError {
  if (hasSnapshotEnvelope(respData)) {
    store.save((respData as SnapshotEnvelopeFields).pageId, respData as SnapshotEnvelopeFields);
  }
  completeAuditAllowed(security, entry, startTime);
  const narrowed = narrowResponse(respData, security, entry, startTime);
  if ("success" in narrowed && !narrowed.success) return narrowed;
  return { ...narrowed, auditId: entry.auditId } as SpatialRelationsResponse;
}

// Stage 3 — audit + cap check
export function guardCapAndAudit(
  security: SecurityConfig,
  entry: ReturnType<typeof beginSpatialAudit>["entry"],
  startTime: number,
  nodeIds: unknown[] | undefined,
  uids: unknown[] | undefined,
): SpatialRelationsToolError | null {
  const capErr = checkCountCap(nodeIds, uids);
  if (capErr) completeAuditBlocked(security, entry, startTime);
  return capErr;
}

// Stage 3 — forward + catch + guard with audit
export async function forwardWithAudit(
  relay: BrowserRelayLike,
  args: Parameters<typeof forwardSpatialRelations>[1],
  security: SecurityConfig,
  entry: ReturnType<typeof beginSpatialAudit>["entry"],
  startTime: number,
): Promise<Record<string, unknown> | SpatialRelationsToolError> {
  let response: unknown;
  try { response = await forwardSpatialRelations(relay, args); }
  catch (err: unknown) {
    completeAuditBlocked(security, entry, startTime);
    return { success: false, error: "timeout" } as unknown as SpatialRelationsToolError;
  }
  const resp = guardResponseObject(response);
  if (!resp) { completeAuditBlocked(security, entry, startTime); return buildSpatialError(classifySpatialError("action-failed")); }
  return resp;
}

// Stage 4+5 — origin check + narrow + store
export function narrowAndStore(
  resp: Record<string, unknown>,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
  args: Parameters<typeof forwardSpatialRelations>[1],
  entry: ReturnType<typeof beginSpatialAudit>["entry"],
  startTime: number,
): SpatialRelationsToolError | SpatialRelationsResponse {
  const originErr = checkOriginPolicyResponse(resp, security, args, entry, startTime);
  if (originErr) return originErr;
  return completeSpatialSuccess(resp["data"], store, security, entry, startTime);
}