import { toInspectPayload } from "./message-action-helpers.js";

export async function routeInspectElement(payload: Record<string, unknown>): Promise<{ data?: unknown; error?: string }> {
  const { inspectElement } = await import("./element-inspector.js");
  const inspectPayload = toInspectPayload(payload);
  if ("error" in inspectPayload) return { error: inspectPayload.error };
  const inspectArgs = inspectPayload.payload;
  const selector = getSelectorCandidate(inspectArgs);
  if (selector !== undefined && shouldValidateSelector(inspectArgs) && isMalformedSelector(selector)) {
    return { error: "invalid-request" };
  }
  return { data: inspectElement(inspectArgs) };
}

export async function routeDomExcerpt(payload: Record<string, unknown>): Promise<{ data?: unknown; error?: string }> {
  const { getDomExcerpt } = await import("./element-inspector.js");
  const { selector, anchorKey, creationSnapshotId, maxDepth, maxLength } = payload as {
    selector?: string;
    anchorKey?: string;
    creationSnapshotId?: string;
    maxDepth?: number;
    maxLength?: number;
  };
  const selectorTarget = hasTarget(selector) ? selector : undefined;
  if (!hasTarget(anchorKey) && selectorTarget === undefined) return { error: "no-target" };
  if (!hasTarget(anchorKey) && selectorTarget !== undefined && isMalformedSelector(selectorTarget)) return { error: "invalid-request" };
  return { data: getDomExcerpt({ selector, anchorKey, creationSnapshotId }, maxDepth, maxLength) };
}

export async function routeSpatialRelations(payload: Record<string, unknown>): Promise<{ data?: unknown; error?: string }> {
  const { handleGetSpatialRelationsAction } = await import("./spatial-relations-handler.js");
  const result = handleGetSpatialRelationsAction(payload);
  return "error" in result ? { error: String(result.error) } : { data: result.data };
}

export async function routeDiffSnapshots(payload: Record<string, unknown>): Promise<{ data?: unknown; error?: string }> {
  const { defaultStore } = await import("../relay-definitions.js");
  const { computeDiff } = await import("../diff-engine.js");
  const fromId = typeof payload.fromSnapshotId === "string" ? payload.fromSnapshotId : undefined;
  const toId = typeof payload.toSnapshotId === "string" ? payload.toSnapshotId : undefined;
  if (!fromId || !toId) return { error: "invalid-request" };
  const fromResult = await defaultStore.get(fromId);
  if ("error" in fromResult) return { error: defaultStore.isStale(fromId) ? "snapshot-stale" : "snapshot-not-found" };
  const toResult = await defaultStore.get(toId);
  if ("error" in toResult) return { error: defaultStore.isStale(toId) ? "snapshot-stale" : "snapshot-not-found" };
  return { data: computeDiff(fromResult, toResult) };
}

function shouldValidateSelector(args: Record<string, unknown>): boolean {
  return typeof args.selector === "string" && !hasTarget(args.uid as string | undefined) && !hasTarget(args.anchorKey as string | undefined) && !hasTarget(args.ref as string | undefined) && typeof args.nodeId !== "number";
}

function getSelectorCandidate(args: Record<string, unknown>): string | undefined {
  return typeof args.selector === "string" ? args.selector : undefined;
}

function hasTarget(value?: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isMalformedSelector(selector: string): boolean {
  if (!hasTarget(selector)) return false;
  try {
    document.querySelector(selector);
    return false;
  } catch {
    return true;
  }
}
