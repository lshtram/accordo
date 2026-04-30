import { toInspectPayload } from "./message-action-helpers.js";
import { isKnownPageMapOwner, isCurrentOwner } from "./spatial-snapshot-registry.js";
import { parseUid } from "./spatial-relations-grammar.js";

function hasTarget(value?: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isMalformedUid(uid: string): boolean {
  return parseUid(uid) === null;
}

/** Check if raw args use a snapshot-scoped handle (uid, ref, or nodeId). */
function usesSnapshotScopedHandle(args: Record<string, unknown>): boolean {
  const hasUid = hasTarget(args.uid as string | undefined);
  const hasRef = hasTarget(args.ref as string | undefined);
  const hasAnchorKey = hasTarget(args.anchorKey as string | undefined);
  const hasSelector = hasTarget(args.selector as string | undefined);
  const hasSnapshotContext = hasTarget(args.creationSnapshotId as string | undefined);
  return hasTarget(args.uid as string | undefined)
    || hasTarget(args.ref as string | undefined)
    || ((hasSnapshotContext || (!hasUid && !hasRef && !hasAnchorKey && !hasSelector)) && args.nodeId !== undefined && typeof args.nodeId === "number");
}

/** Returns true when a snapshot-scoped handle is used without creationSnapshotId. */
function isMissingCreationSnapshotId(args: Record<string, unknown>): boolean {
  return usesSnapshotScopedHandle(args)
    && !hasTarget(args.creationSnapshotId as string | undefined);
}

/** Classify a snapshotId against the page-map owner registry. */
function classifySnapshotOwner(snapshotId: string): "current" | "stale" | "not-found" {
  if (isCurrentOwner(snapshotId)) return "current";
  if (isKnownPageMapOwner(snapshotId)) return "stale";
  return "not-found";
}

/** Validate snapshot-scoped handle usage on the raw payload before normalization. */
function validateSnapshotScopedHandle(
  args: Record<string, unknown>,
): "invalid-request" | "snapshot-not-found" | "snapshot-stale" | null {
  if (!usesSnapshotScopedHandle(args)) return null;
  if (isMissingCreationSnapshotId(args)) return "invalid-request";
  const snapshotId = args.creationSnapshotId as string;
  const classification = classifySnapshotOwner(snapshotId);
  if (classification === "not-found") return "snapshot-not-found";
  if (classification === "stale") return "snapshot-stale";
  return null;
}

/** Call inspectElement for the non-snapshot-scoped path (anchorKey/selector only). */
async function callInspectForNonSnapshotCase(
  payload: Record<string, unknown>,
): Promise<{ data?: unknown; error?: string }> {
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

export async function routeInspectElement(
  payload: Record<string, unknown>,
): Promise<{ data?: unknown; error?: string }> {
  const rawUid = typeof payload.uid === "string" && payload.uid.trim() ? payload.uid : undefined;
  if (rawUid !== undefined && isMalformedUid(rawUid)) return { error: "invalid-request" };

  const snapshotError = validateSnapshotScopedHandle(payload);
  if (snapshotError !== null) return { error: snapshotError };

  const uid = rawUid;
  const ref = typeof payload.ref === "string" && payload.ref.trim() ? payload.ref : undefined;
  const anchorKey = typeof payload.anchorKey === "string" && payload.anchorKey.trim() ? payload.anchorKey : undefined;
  const selector = typeof payload.selector === "string" && payload.selector.trim() ? payload.selector : undefined;
  const creationSnapshotId = hasTarget(payload.creationSnapshotId as string | undefined)
    ? (payload.creationSnapshotId as string)
    : undefined;
  const nodeId = (creationSnapshotId !== undefined || (uid === undefined && ref === undefined && anchorKey === undefined && selector === undefined)) && typeof payload.nodeId === "number" ? payload.nodeId : undefined;

  if (uid !== undefined) {
    const { inspectElement } = await import("./element-inspector.js");
    return { data: inspectElement({ uid, creationSnapshotId }) };
  }
  if (ref !== undefined) {
    const { inspectElement } = await import("./element-inspector.js");
    return { data: inspectElement({ ref, creationSnapshotId }) };
  }
  if (nodeId !== undefined) {
    const { inspectElement } = await import("./element-inspector.js");
    return { data: inspectElement({ nodeId, creationSnapshotId }) };
  }

  return callInspectForNonSnapshotCase(payload);
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
  if (!hasTarget(anchorKey) && selectorTarget !== undefined && isMalformedSelector(selectorTarget)) {
    return { error: "invalid-request" };
  }
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
  return (
    typeof args.selector === "string"
    && !hasTarget(args.uid as string | undefined)
    && !hasTarget(args.anchorKey as string | undefined)
    && !hasTarget(args.ref as string | undefined)
    && typeof args.nodeId !== "number"
  );
}

function getSelectorCandidate(args: Record<string, unknown>): string | undefined {
  return typeof args.selector === "string" ? args.selector : undefined;
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
