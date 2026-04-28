/**
 * relay-get-page-map-remote.ts — Remote (tab) page-map handler helpers.
 *
 * Extracted from relay-get-page-map.ts so the coordinator stays <= 30 lines.
 * handleGetPageMapRemote() was ~42 lines; now coordinator <= 30 lines.
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed } from "./relay-definitions.js";
import { applyRedaction, attachRedactionWarning, enrichWithAuditLog, mintAuditId } from "./relay-privacy.js";

// ── Target resolution ───────────────────────────────────────────────────────

export async function resolveRemoteTabId(request: RelayActionRequest): Promise<number | null> {
  const { resolveTargetTabId } = await import("./relay-forwarder.js");
  const tabId = await resolveTargetTabId(request.payload);
  return tabId ?? null;
}

// ── Origin check ────────────────────────────────────────────────────────────

export async function checkRemoteOrigin(request: RelayActionRequest, tabId: number): Promise<RelayActionResponse | null> {
  const { checkGetPageMapOrigin } = await import("./relay-get-page-map-origin.js");
  return checkGetPageMapOrigin(request, tabId);
}

// ── Forward to tab ────────────────────────────────────────────────────────────

export async function forwardToTab(request: RelayActionRequest, tabId: number): Promise<Record<string, unknown> | null> {
  const { forwardGetPageMap } = await import("./relay-get-page-map-forward.js");
  return forwardGetPageMap(request, tabId);
}

// ── Frame stitching ──────────────────────────────────────────────────────────

export async function stitchFrameNodes(
  tabId: number,
  data: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!payload.traverseFrames || !Array.isArray(data.iframes)) return;
  const { stitchFrameNodesIntoPageMap } = await import("./relay-page-frame-tree.js");
  await stitchFrameNodesIntoPageMap(tabId, data, payload);
}

// ── Snapshot save ─────────────────────────────────────────────────────────────

export async function persistRemoteSnapshot(data: Record<string, unknown>): Promise<void> {
  const { savePageMapSnapshot } = await import("./relay-get-page-map-forward.js");
  await savePageMapSnapshot(data);
}

// ── Redaction ─────────────────────────────────────────────────────────────────

interface RedactionResult {
  finalData: unknown;
  redactionApplied: boolean;
}

export function applyRedactionToData(
  data: Record<string, unknown>,
  redactPII: boolean,
): RedactionResult {
  if (!redactPII) return { finalData: data, redactionApplied: false };
  try {
    const result = applyRedaction(data);
    const finalData = result.data;
    if (finalData !== null && typeof finalData === "object") {
      (finalData as Record<string, unknown>)["redactionApplied"] = result.redactionApplied;
    }
    return { finalData, redactionApplied: result.redactionApplied };
  } catch {
    return { finalData: null, redactionApplied: false };
  }
}

export function buildRedactionErrorResponse(request: RelayActionRequest, auditId: string): RelayActionResponse {
  return { requestId: request.requestId, success: false, error: "redaction-failed", retryable: false, auditId };
}

// ── Response finalization ────────────────────────────────────────────────────

export function finalizeRemoteResponse(
  request: RelayActionRequest,
  data: Record<string, unknown>,
  finalData: unknown,
  redactionApplied: boolean,
  redactPII: boolean,
  auditId: string,
): RelayActionResponse {
  const response: RelayActionResponse = { requestId: request.requestId, success: true, data: finalData, auditId };
  attachRedactionWarning(response, redactPII);
  enrichWithAuditLog({
    auditId,
    toolName: request.action,
    pageId: (data as { pageId?: string }).pageId ?? "",
    origin: "unknown",
    action: "allowed",
    redacted: redactionApplied,
    durationMs: 0,
    response: response as unknown as Record<string, unknown>,
  });
  return response;
}

// ── Coordinator (was ~42 lines, now <= 30 lines) ─────────────────────────────

export async function handleGetPageMapRemote(request: RelayActionRequest): Promise<RelayActionResponse> {
  const tabId = await resolveRemoteTabId(request);
  if (!tabId) return actionFailed(request);

  const blocked = await checkRemoteOrigin(request, tabId);
  if (blocked) return blocked;

  const traverseFrames = request.payload.traverseFrames === true;
  const data = await forwardToTab(request, tabId);
  if (data === null) return actionFailed(request, "no-content-script");

  await stitchFrameNodes(tabId, data, request.payload as Record<string, unknown>);
  await persistRemoteSnapshot(data);

  const auditId = mintAuditId();
  const redactPII = request.payload.redactPII === true;
  const { finalData, redactionApplied } = applyRedactionToData(data, redactPII);
  if (finalData === null) return buildRedactionErrorResponse(request, auditId);

  return finalizeRemoteResponse(request, data, finalData, redactionApplied, redactPII, auditId);
}