import type { BrowserCommentThread } from "./types.js";

type SurfaceMetadata = Record<string, string | undefined>;
type AnchorContext = NonNullable<BrowserCommentThread["anchorContext"]>;

export function hasRelevantSurfaceMetadata(surfaceMetadata: SurfaceMetadata | undefined): boolean {
  if (!surfaceMetadata) return false;
  return [
    surfaceMetadata.anchorKey,
    surfaceMetadata.frameId,
    surfaceMetadata.snapshotId,
    surfaceMetadata.confidence,
    surfaceMetadata.resolvedTier,
    surfaceMetadata.snapshotDrift,
  ].some((value) => typeof value === "string" && value.length > 0);
}

function parseConfidence(value: string | undefined): AnchorContext["confidence"] {
  return value === "high" || value === "medium" || value === "low" || value === "none" ? value : undefined;
}

function parseResolvedTier(value: string | undefined): AnchorContext["resolvedTier"] {
  return value && /^[1-6]$/.test(value) ? (Number(value) as 1 | 2 | 3 | 4 | 5 | 6) : undefined;
}

function parseSnapshotDrift(value: string | undefined): boolean | undefined {
  return value === "true" ? true : value === "false" ? false : undefined;
}

export function surfaceMetadataToAnchorContext(anchorMetadata: SurfaceMetadata | undefined): BrowserCommentThread["anchorContext"] | undefined {
  if (!anchorMetadata) return undefined;
  return {
    ...(anchorMetadata.tagName ? { tagName: anchorMetadata.tagName } : {}),
    ...(anchorMetadata.frameId ? { frameId: anchorMetadata.frameId } : {}),
    ...(anchorMetadata.textSnippet ? { textSnippet: anchorMetadata.textSnippet } : {}),
    ...(anchorMetadata.ariaLabel ? { ariaLabel: anchorMetadata.ariaLabel } : {}),
    ...(anchorMetadata.pageTitle ? { pageTitle: anchorMetadata.pageTitle } : {}),
    ...(anchorMetadata.snapshotId ? { snapshotId: anchorMetadata.snapshotId } : {}),
    ...(parseConfidence(anchorMetadata.confidence) ? { confidence: parseConfidence(anchorMetadata.confidence) } : {}),
    ...(parseResolvedTier(anchorMetadata.resolvedTier) ? { resolvedTier: parseResolvedTier(anchorMetadata.resolvedTier) } : {}),
    ...(parseSnapshotDrift(anchorMetadata.snapshotDrift) !== undefined
      ? { snapshotDrift: parseSnapshotDrift(anchorMetadata.snapshotDrift) }
      : {}),
  };
}

export function mergeAnchorContexts(
  local: BrowserCommentThread["anchorContext"] | undefined,
  hub: BrowserCommentThread["anchorContext"] | undefined,
): BrowserCommentThread["anchorContext"] | undefined {
  if (!local) return hub;
  if (!hub) return local;
  return {
    ...(local.tagName || hub.tagName ? { tagName: local.tagName ?? hub.tagName } : {}),
    frameId: local.frameId ?? hub.frameId,
    textSnippet: local.textSnippet ?? hub.textSnippet,
    ariaLabel: local.ariaLabel ?? hub.ariaLabel,
    pageTitle: local.pageTitle ?? hub.pageTitle,
    snapshotId: local.snapshotId ?? hub.snapshotId,
    confidence: local.confidence ?? hub.confidence,
    resolvedTier: local.resolvedTier ?? hub.resolvedTier,
    snapshotDrift: local.snapshotDrift ?? hub.snapshotDrift,
  };
}
