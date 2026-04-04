/**
 * relay-type-guards.ts — Type narrowing helpers for relay payload/response data.
 *
 * Replaces unsafe `as X` casts with runtime-checked narrowing functions.
 * All helpers follow the pattern: read → validate → return typed value or undefined.
 *
 * @module
 */

import type { CapturePayload } from "./relay-definitions.js";
import type { SnapshotEnvelope } from "./snapshot-versioning.js";
import type { VersionedSnapshot } from "./snapshot-versioning.js";

// ── Scalar field readers ─────────────────────────────────────────────────────

/**
 * Read a required string field from an unknown record.
 * Returns the string value, or empty string if the field is absent/not a string.
 */
export function readString(
  payload: Record<string, unknown>,
  field: string,
): string {
  const val = payload[field];
  return typeof val === "string" ? val : "";
}

/**
 * Read an optional string field from an unknown record.
 * Returns undefined if the field is absent or not a string.
 */
export function readOptionalString(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const val = payload[field];
  return typeof val === "string" ? val : undefined;
}

/**
 * Read an optional number field from an unknown record.
 * Returns undefined if the field is absent or not a number.
 */
export function readOptionalNumber(
  payload: Record<string, unknown>,
  field: string,
): number | undefined {
  const val = payload[field];
  return typeof val === "number" ? val : undefined;
}

// ── Payload type guards ──────────────────────────────────────────────────────

/**
 * Anchor context shape for comment creation.
 */
export interface AnchorContext {
  tagName: string;
  textSnippet?: string;
  ariaLabel?: string;
  pageTitle?: string;
}

/**
 * Read the anchorContext object from a payload, if present and well-formed.
 */
export function readAnchorContext(
  payload: Record<string, unknown>,
): AnchorContext | undefined {
  const val = payload.anchorContext;
  if (val === null || typeof val !== "object") return undefined;
  const v = val as Record<string, unknown>;
  if (typeof v.tagName !== "string") return undefined;
  return {
    tagName: v.tagName,
    textSnippet: typeof v.textSnippet === "string" ? v.textSnippet : undefined,
    ariaLabel: typeof v.ariaLabel === "string" ? v.ariaLabel : undefined,
    pageTitle: typeof v.pageTitle === "string" ? v.pageTitle : undefined,
  };
}

/**
 * Narrow an unknown value to a CapturePayload, validating only the optional
 * fields that the capture logic actually reads.
 *
 * B2-CTX-003: tabId is extracted from the payload and included in the returned
 * CapturePayload so the capture handler can route to the correct tab.
 */
export function toCapturePayload(payload: Record<string, unknown>): CapturePayload {
  const rect = payload.rect;
  let typedRect: CapturePayload["rect"];
  if (rect !== null && typeof rect === "object") {
    const r = rect as Record<string, unknown>;
    if (
      typeof r.x === "number" &&
      typeof r.y === "number" &&
      typeof r.width === "number" &&
      typeof r.height === "number"
    ) {
      typedRect = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
  }
  const mode = payload.mode;
  const typedMode: "viewport" | "fullPage" | undefined =
    mode === "viewport" || mode === "fullPage" ? mode : undefined;
  return {
    tabId: readOptionalNumber(payload, "tabId"),
    anchorKey: readOptionalString(payload, "anchorKey"),
    nodeRef: readOptionalString(payload, "nodeRef"),
    padding: readOptionalNumber(payload, "padding"),
    quality: readOptionalNumber(payload, "quality"),
    rect: typedRect,
    mode: typedMode,
  };
}

// ── Response type guards ─────────────────────────────────────────────────────

/**
 * Type guard: response has an `error` string field.
 */
export function hasErrorField(val: unknown): val is { error: string } {
  return val !== null && typeof val === "object" && "error" in val && typeof (val as Record<string, unknown>).error === "string";
}

/**
 * Type guard: response has a `data` field.
 */
export function hasDataField(val: unknown): val is { data: unknown } {
  return val !== null && typeof val === "object" && "data" in val;
}

/**
 * Type guard: value conforms to SnapshotEnvelope shape.
 * Checks that snapshotId, pageId, frameId, capturedAt, and source are strings.
 */
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

/**
 * Type guard: response object has a VersionedSnapshot-shaped `captureResult`.
 * Used to validate capture results before saving to the store.
 */
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

/**
 * Type guard: value is an object with a `bounds` field of the expected shape.
 */
export function resolveBoundsFromMessage(
  val: unknown,
): { x: number; y: number; width: number; height: number } | null {
  if (val === null || typeof val !== "object") return null;
  const v = val as Record<string, unknown>;
  if (hasErrorField(val)) return null;
  const b = v.bounds;
  if (b === null || typeof b !== "object") return null;
  const bounds = b as Record<string, unknown>;
  if (
    typeof bounds.x === "number" &&
    typeof bounds.y === "number" &&
    typeof bounds.width === "number" &&
    typeof bounds.height === "number"
  ) {
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }
  return null;
}

/**
 * Narrow an unknown value to a bounds rect `{x, y, width, height}`.
 * Returns null if the value is not a well-formed bounds object.
 */
export function readBoundsLiteral(
  val: unknown,
): { x: number; y: number; width: number; height: number } | undefined {
  if (val === null || typeof val !== "object" || Array.isArray(val)) return undefined;
  const v = val as Record<string, unknown>;
  if (
    typeof v.x === "number" &&
    typeof v.y === "number" &&
    typeof v.width === "number" &&
    typeof v.height === "number"
  ) {
    return { x: v.x, y: v.y, width: v.width, height: v.height };
  }
  return undefined;
}
