import type { SnapshotEnvelope, VersionedSnapshot } from "./snapshot-versioning.js";

export function hasErrorField(val: unknown): val is { error: string } {
  return val !== null && typeof val === "object" && "error" in val && typeof (val as Record<string, unknown>).error === "string";
}

export function hasDataField(val: unknown): val is { data: unknown } {
  return val !== null && typeof val === "object" && "data" in val;
}

export function isSnapshotEnvelope(val: unknown): val is SnapshotEnvelope {
  if (val === null || typeof val !== "object") return false;
  const v = val as Record<string, unknown>;
  return (
    typeof v.snapshotId === "string" &&
    typeof v.pageId === "string" &&
    typeof v.frameId === "string" &&
    typeof v.capturedAt === "string" &&
    typeof v.source === "string"
  );
}

export function toCaptureStoreRecord(
  captureResult: Record<string, unknown>,
): {
  pageId: string;
  frameId: string;
  snapshotId: string;
  capturedAt: string;
  viewport: VersionedSnapshot["viewport"];
  source: VersionedSnapshot["source"];
  nodes: VersionedSnapshot["nodes"];
  totalElements: number;
} | null {
  const pageId = captureResult.pageId;
  const frameId = captureResult.frameId;
  const snapshotId = captureResult.snapshotId;
  const capturedAt = captureResult.capturedAt;
  const source = captureResult.source;
  const viewport = captureResult.viewport;

  if (
    typeof pageId !== "string" ||
    typeof snapshotId !== "string" ||
    typeof capturedAt !== "string" ||
    typeof source !== "string" ||
    viewport === null ||
    typeof viewport !== "object"
  ) {
    return null;
  }

  return {
    pageId,
    frameId: typeof frameId === "string" ? frameId : "main",
    snapshotId,
    capturedAt,
    viewport: viewport as VersionedSnapshot["viewport"],
    source: source as VersionedSnapshot["source"],
    nodes: [],
    totalElements: typeof captureResult.totalElements === "number" ? captureResult.totalElements : 0,
  };
}
