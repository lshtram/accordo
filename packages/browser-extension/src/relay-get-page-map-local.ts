/**
 * relay-get-page-map-local.ts — Local (content-script) page-map handler.
 *
 * Extracted from relay-get-page-map.ts so the coordinator stays <= 30 lines.
 * handleGetPageMapLocal() was 56 lines; now the coordinator uses helpers.
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { defaultStore, isVersionedSnapshot } from "./relay-definitions.js";
import { isOriginBlockedByPolicy, parseOriginPolicy, enrichWithAuditLog, attachRedactionWarning, mintAuditId } from "./relay-privacy.js";
import { appendNodePaginationMetadata, clampOffsetLimit, cloneRecord } from "./relay-page-runtime.js";

// ── Origin check ─────────────────────────────────────────────────────────────

export function checkLocalOrigin(
  request: RelayActionRequest,
): { blocked: true; auditId: string; response: RelayActionResponse } | { blocked: false } {
  const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);
  if (allowedOrigins === undefined && deniedOrigins === undefined) return { blocked: false };
  const origin = window.location.origin;
  if (!isOriginBlockedByPolicy(origin, allowedOrigins, deniedOrigins)) return { blocked: false };

  const auditId = mintAuditId();
  const blockedResp: RelayActionResponse = {
    requestId: request.requestId,
    success: false,
    error: "origin-blocked",
    retryable: false,
    auditId,
  };
  enrichWithAuditLog({ auditId, toolName: request.action, pageId: "", origin, action: "blocked", redacted: false, durationMs: 0, response: blockedResp });
  return { blocked: true, auditId, response: blockedResp };
}

// ── Payload → collector options ─────────────────────────────────────────────

interface PageMapCollectorOptions {
  maxDepth?: number;
  maxNodes?: number;
  includeBounds?: boolean;
  viewportOnly?: boolean;
  visibleOnly?: boolean;
  interactiveOnly?: boolean;
  roles?: string[];
  textMatch?: string;
  selector?: string;
  regionFilter?: { x: number; y: number; width: number; height: number };
  piercesShadow?: boolean;
  traverseFrames?: boolean;
  logicalFrameId?: string;
}

export function mapCollectorOptions(p: Record<string, unknown>): PageMapCollectorOptions {
  return {
    maxDepth: typeof p.maxDepth === "number" ? p.maxDepth : undefined,
    maxNodes: typeof p.maxNodes === "number" ? p.maxNodes : undefined,
    includeBounds: typeof p.includeBounds === "boolean" ? p.includeBounds : undefined,
    viewportOnly: typeof p.viewportOnly === "boolean" ? p.viewportOnly : undefined,
    visibleOnly: typeof p.visibleOnly === "boolean" ? p.visibleOnly : undefined,
    interactiveOnly: typeof p.interactiveOnly === "boolean" ? p.interactiveOnly : undefined,
    roles: Array.isArray(p.roles) ? (p.roles as unknown[]).filter((r): r is string => typeof r === "string") : undefined,
    textMatch: typeof p.textMatch === "string" ? p.textMatch : undefined,
    selector: typeof p.selector === "string" ? p.selector : undefined,
    piercesShadow: typeof p.piercesShadow === "boolean" ? p.piercesShadow : undefined,
    traverseFrames: typeof p.traverseFrames === "boolean" ? p.traverseFrames : undefined,
    logicalFrameId: typeof p.logicalFrameId === "string" ? p.logicalFrameId : undefined,
  };
}

export function applyPagination(result: Record<string, unknown>, p: Record<string, unknown>): void {
  const pagination = clampOffsetLimit(p, 200, 500, "maxNodes");
  if (!pagination.hasPagination) return;
  const totalAvailable = Array.isArray(result.nodes) ? result.nodes.length : 0;
  appendNodePaginationMetadata(result, { totalAvailable, offset: pagination.offset, limit: pagination.limit });
}

// ── Snapshot save ─────────────────────────────────────────────────────────────

export async function saveVersionedSnapshot(result: Record<string, unknown>): Promise<void> {
  if (isVersionedSnapshot(result)) {
    await defaultStore.save((result as { pageId: string }).pageId, result as Parameters<typeof defaultStore.save>[1]);
  }
}

// ── Coordinator (was 56 lines, now uses helpers) ─────────────────────────────

export async function handleGetPageMapLocal(request: RelayActionRequest): Promise<RelayActionResponse> {
  const originCheck = checkLocalOrigin(request);
  if (originCheck.blocked) return originCheck.response;
  const result = await collectLocalPageMap(request.payload as Record<string, unknown>);
  await saveVersionedSnapshot(result as unknown as Record<string, unknown>);
  const responseResult = cloneRecord(result as unknown as Record<string, unknown>);
  applyPagination(responseResult, request.payload as Record<string, unknown>);
  return buildLocalSuccessResponse(request, responseResult);
}

async function collectLocalPageMap(p: Record<string, unknown>): Promise<Record<string, unknown> & { snapshotId: string; frameId?: string; pageId?: string }> {
  const { collectPageMap } = await import("./content/page-map-collector.js");
  const { registerPageMapOwner } = await import("./content/spatial-snapshot-registry.js");
  const { readBoundsLiteral } = await import("./relay-type-guards.js");
  const regionFilter = readBoundsLiteral(p.regionFilter);
  const opts = mapCollectorOptions(p);
  if (regionFilter) opts.regionFilter = regionFilter;
  const result = collectPageMap(opts);
  registerPageMapOwner(result.snapshotId, result.frameId ?? "main");
  return result as unknown as Record<string, unknown> & { snapshotId: string; frameId?: string; pageId?: string };
}

function buildLocalSuccessResponse(request: RelayActionRequest, result: { pageId?: string }): RelayActionResponse {
  const auditId = mintAuditId();
  const redactPII = request.payload.redactPII === true;
  const response: RelayActionResponse = { requestId: request.requestId, success: true, data: result, auditId };
  attachRedactionWarning(response, redactPII);
  enrichWithAuditLog({
    auditId,
    toolName: request.action,
    pageId: result.pageId ?? "",
    origin: window.location.origin,
    action: "allowed",
    redacted: false,
    durationMs: 0,
    response: response as unknown as Record<string, unknown>,
  });
  return response;
}
