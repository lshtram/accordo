export type InspectPayload =
  | { uid: string; creationSnapshotId?: string; anchorKey?: string; ref?: string; selector?: string }
  | { anchorKey: string; creationSnapshotId?: string; ref?: string; selector?: string }
  | { nodeId: number; creationSnapshotId?: string }
  | { ref: string; creationSnapshotId?: string; anchorKey?: string; selector?: string }
  | { selector: string; creationSnapshotId?: string };

export function toInspectPayload(raw: Record<string, unknown>): InspectPayload {
  const uid = typeof raw.uid === "string" && raw.uid.length > 0 ? raw.uid : undefined;
  const anchorKey = typeof raw.anchorKey === "string" && raw.anchorKey.length > 0 ? raw.anchorKey : undefined;
  const creationSnapshotId = typeof raw.creationSnapshotId === "string" && raw.creationSnapshotId.length > 0 ? raw.creationSnapshotId : undefined;
  const ref = typeof raw.ref === "string" && raw.ref.length > 0 ? raw.ref : undefined;
  const selector = typeof raw.selector === "string" && raw.selector.length > 0 ? raw.selector : undefined;

  if (uid !== undefined) return { uid, creationSnapshotId, anchorKey, ref, selector };
  if (anchorKey !== undefined) return { anchorKey, creationSnapshotId, ref, selector };
  if (ref !== undefined) return { ref, creationSnapshotId, anchorKey, selector };
  if (selector !== undefined) return { selector, creationSnapshotId };
  if (typeof raw.nodeId === "number") return { nodeId: raw.nodeId, creationSnapshotId };
  return { selector: "" };
}
