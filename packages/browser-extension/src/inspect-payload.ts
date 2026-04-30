import { parseUid } from "./spatial-grammar.js";

/**
 * InspectPayload — discriminated by the snapshot-scoped handle.
 *
 * Priority (highest to lowest):
 *   uid > ref > anchorKey > selector > nodeId
 *
 * Each variant guarantees its primary handle is present.
 * For secondary handles, they are optional (present only if provided alongside
 * the primary handle and don't change the discriminator).
 */
export type InspectPayload =
  // uid is guaranteed; anchorKey/ref/selector are optional secondary handles
  | { uid: string; creationSnapshotId?: string; anchorKey?: string; ref?: string; selector?: string }
  // ref is guaranteed; anchorKey is optional secondary (only if provided alongside ref)
  | { ref: string; creationSnapshotId?: string; anchorKey?: string }
  // anchorKey is guaranteed; NO ref or selector (they have their own primary cases)
  | { anchorKey: string; creationSnapshotId?: string }
  // selector is guaranteed; no secondary handles
  | { selector: string; creationSnapshotId?: string }
  // nodeId is guaranteed; no secondary handles
  | { nodeId: number; creationSnapshotId?: string };

export type InspectPayloadReadResult =
  | { payload: InspectPayload }
  | { error: "no-target" | "invalid-request" };

export function toInspectPayload(raw: Record<string, unknown>): InspectPayloadReadResult {
  const uid = readNonEmptyString(raw.uid);
  const anchorKey = readNonEmptyString(raw.anchorKey);
  const creationSnapshotId = readNonEmptyString(raw.creationSnapshotId);
  const ref = readNonEmptyString(raw.ref);
  const selector = readNonEmptyString(raw.selector);
  const hasNonNodeTarget = uid !== undefined || ref !== undefined || anchorKey !== undefined || selector !== undefined;

  if (uid !== undefined && isMalformedUid(uid)) {
    return { error: "invalid-request" };
  }
  if (uid !== undefined) return { payload: { uid, creationSnapshotId, anchorKey, ref, selector } };
  if (ref !== undefined) return { payload: { ref, creationSnapshotId, anchorKey } };
  if (creationSnapshotId !== undefined && typeof raw.nodeId === "number") return { payload: { nodeId: raw.nodeId, creationSnapshotId } };
  if (anchorKey !== undefined) return { payload: { anchorKey, creationSnapshotId } };
  if (selector !== undefined) return { payload: { selector, creationSnapshotId } };
  if (!hasNonNodeTarget && typeof raw.nodeId === "number") return { payload: { nodeId: raw.nodeId, creationSnapshotId } };
  return { error: "no-target" };
}

function isMalformedUid(uid: string): boolean {
  return parseUid(uid) === null;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
