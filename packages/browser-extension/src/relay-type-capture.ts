import type { CapturePayload } from "./relay-definitions.js";
import { readOptionalNumber, readOptionalString, readOptionalStringArray } from "./relay-type-readers.js";

export interface AnchorContext {
  tagName: string;
  frameId?: string;
  textSnippet?: string;
  ariaLabel?: string;
  pageTitle?: string;
  snapshotId?: string;
  confidence?: "high" | "medium" | "low" | "none";
  resolvedTier?: 1 | 2 | 3 | 4 | 5 | 6;
  snapshotDrift?: boolean;
}

export function readAnchorContext(
  payload: Record<string, unknown>,
): AnchorContext | undefined {
  const val = payload.anchorContext;
  if (val === null || typeof val !== "object") return undefined;
  const v = val as Record<string, unknown>;
  if (typeof v.tagName !== "string") return undefined;
  return {
    tagName: v.tagName,
    frameId: typeof v.frameId === "string" ? v.frameId : undefined,
    textSnippet: typeof v.textSnippet === "string" ? v.textSnippet : undefined,
    ariaLabel: typeof v.ariaLabel === "string" ? v.ariaLabel : undefined,
    pageTitle: typeof v.pageTitle === "string" ? v.pageTitle : undefined,
    snapshotId: typeof v.snapshotId === "string" ? v.snapshotId : undefined,
    confidence:
      v.confidence === "high" || v.confidence === "medium" || v.confidence === "low" || v.confidence === "none"
        ? v.confidence
        : undefined,
    resolvedTier:
      v.resolvedTier === 1 || v.resolvedTier === 2 || v.resolvedTier === 3 || v.resolvedTier === 4 || v.resolvedTier === 5 || v.resolvedTier === 6
        ? v.resolvedTier
        : undefined,
    snapshotDrift: typeof v.snapshotDrift === "boolean" ? v.snapshotDrift : undefined,
  };
}

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
  const format = payload.format;
  const typedFormat: "jpeg" | "png" | "webp" | undefined =
    format === "jpeg" || format === "png" || format === "webp" ? format : undefined;
  return {
    tabId: readOptionalNumber(payload, "tabId"),
    anchorKey: readOptionalString(payload, "anchorKey"),
    nodeRef: readOptionalString(payload, "nodeRef"),
    padding: readOptionalNumber(payload, "padding"),
    quality: readOptionalNumber(payload, "quality"),
    rect: typedRect,
    mode: typedMode,
    format: typedFormat,
    redactPatterns: readOptionalStringArray(payload, "redactPatterns"),
  };
}

export type ResolveBoundsResult =
  | { bounds: { x: number; y: number; width: number; height: number } }
  | { error: string }
  | null;

export function resolveBoundsFromMessage(
  val: unknown,
): ResolveBoundsResult {
  if (val === null || typeof val !== "object") return null;
  const v = val as Record<string, unknown>;
  const raw = v["error"];
  if (typeof raw === "string") {
    return { error: raw };
  }
  const b = v.bounds;
  if (b === null || typeof b !== "object") return null;
  const bounds = b as Record<string, unknown>;
  if (
    typeof bounds.x === "number" &&
    typeof bounds.y === "number" &&
    typeof bounds.width === "number" &&
    typeof bounds.height === "number"
  ) {
    return { bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
  }
  return null;
}

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
