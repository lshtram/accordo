export type InspectPayload =
  | { uid: string; creationSnapshotId?: string; anchorKey?: string; ref?: string; selector?: string }
  | { anchorKey: string; creationSnapshotId?: string; ref?: string; selector?: string }
  | { nodeId: number; creationSnapshotId?: string }
  | { ref: string; creationSnapshotId?: string; anchorKey?: string; selector?: string }
  | { selector: string; creationSnapshotId?: string };

export type InspectPayloadReadResult =
  | { payload: InspectPayload }
  | { error: "no-target" | "invalid-request" };

export function toInspectPayload(raw: Record<string, unknown>): InspectPayloadReadResult {
  const uid = readNonEmptyString(raw.uid);
  const anchorKey = readNonEmptyString(raw.anchorKey);
  const creationSnapshotId = readNonEmptyString(raw.creationSnapshotId);
  const ref = readNonEmptyString(raw.ref);
  const selector = readNonEmptyString(raw.selector);

  if (uid !== undefined && isMalformedUid(uid)) {
    return { error: "invalid-request" };
  }
  if (uid !== undefined) return { payload: { uid, creationSnapshotId, anchorKey, ref, selector } };
  if (anchorKey !== undefined) return { payload: { anchorKey, creationSnapshotId, ref, selector } };
  if (ref !== undefined) return { payload: { ref, creationSnapshotId, anchorKey, selector } };
  if (selector !== undefined) return { payload: { selector, creationSnapshotId } };
  if (typeof raw.nodeId === "number") return { payload: { nodeId: raw.nodeId, creationSnapshotId } };
  return { error: "no-target" };
}

function isMalformedUid(uid: string): boolean {
  return !/^[^:]+:\d+$/.test(uid);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
