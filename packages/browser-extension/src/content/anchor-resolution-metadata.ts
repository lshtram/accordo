import { STRATEGY_CONFIDENCE, STRATEGY_RESOLVED_TIER, generateAnchorKey, parseAnchorKey, parseEnhancedAnchorKey } from "./enhanced-anchor.js";

const SNAPSHOT_DRIFT_VERSION_THRESHOLD = 10;

function parseSnapshotVersion(snapshotId: string | undefined): number | undefined {
  if (!snapshotId) return undefined;
  const colonIdx = snapshotId.lastIndexOf(":");
  if (colonIdx === -1) return undefined;
  const version = Number.parseInt(snapshotId.slice(colonIdx + 1), 10);
  return Number.isNaN(version) ? undefined : version;
}

function computeSnapshotDrift(currentSnapshotId: string, creationSnapshotId: string | undefined): boolean | undefined {
  if (!creationSnapshotId) return undefined;
  const currentPrefix = currentSnapshotId.slice(0, currentSnapshotId.lastIndexOf(":"));
  const creationPrefix = creationSnapshotId.slice(0, creationSnapshotId.lastIndexOf(":"));
  if (currentPrefix !== creationPrefix) return true;
  const currentVersion = parseSnapshotVersion(currentSnapshotId);
  const creationVersion = parseSnapshotVersion(creationSnapshotId);
  if (currentVersion === undefined || creationVersion === undefined) return undefined;
  return Math.abs(currentVersion - creationVersion) > SNAPSHOT_DRIFT_VERSION_THRESHOLD;
}

export function resolveAnchorResolutionMetadata(
  element: Element,
  currentSnapshotId: string,
  creationSnapshotId: string | undefined,
): {
  anchorKey: string;
  anchorStrategy: "id" | "data-testid" | "aria" | "css-path" | "tag-sibling" | "viewport-pct";
  anchorConfidence: "high" | "medium" | "low";
  resolvedTier: 1 | 2 | 3 | 4 | 5 | 6;
  snapshotDrift?: boolean;
} {
  const snapshotDrift = computeSnapshotDrift(currentSnapshotId, creationSnapshotId);
  const { anchorKey, strategy, confidence } = generateAnchorKey(element);
  return {
    anchorKey,
    anchorStrategy: strategy,
    anchorConfidence: confidence,
    resolvedTier: STRATEGY_RESOLVED_TIER[strategy],
    ...(snapshotDrift !== undefined ? { snapshotDrift } : {}),
  };
}

export function normalizeIncomingAnchorKey(anchorKey: string): string {
  const normalizedMatch = anchorKey.match(/^(-?\d*\.?\d+):(-?\d*\.?\d+)$/);
  if (!normalizedMatch) return anchorKey;
  const x = Number.parseFloat(normalizedMatch[1]);
  const y = Number.parseFloat(normalizedMatch[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return anchorKey;
  return `body:${Math.round(x * 100)}%x${Math.round(y * 100)}%`;
}

function buildCanonicalAnchorMetadata(element: Element): {
  canonicalAnchorKey: string;
  canonicalAnchorStrategy: "id" | "data-testid" | "aria" | "css-path" | "tag-sibling" | "viewport-pct";
  canonicalAnchorConfidence: "high" | "medium" | "low";
  canonicalResolvedTier: 1 | 2 | 3 | 4 | 5 | 6;
} {
  const { anchorKey, strategy, confidence } = generateAnchorKey(element);
  return {
    canonicalAnchorKey: anchorKey,
    canonicalAnchorStrategy: strategy,
    canonicalAnchorConfidence: confidence,
    canonicalResolvedTier: STRATEGY_RESOLVED_TIER[strategy],
  };
}

export function resolveReportedAnchorMetadata(
  inputAnchorKey: string | undefined,
  element: Element,
  currentSnapshotId: string,
  creationSnapshotId: string | undefined,
): {
  anchorKey: string;
  anchorStrategy?: "id" | "data-testid" | "aria" | "css-path" | "tag-sibling" | "viewport-pct";
  anchorConfidence?: "high" | "medium" | "low";
  resolvedTier?: 1 | 2 | 3 | 4 | 5 | 6;
  snapshotDrift?: boolean;
  canonicalAnchorKey?: string;
  canonicalAnchorStrategy?: "id" | "data-testid" | "aria" | "css-path" | "tag-sibling" | "viewport-pct";
  canonicalAnchorConfidence?: "high" | "medium" | "low";
  canonicalResolvedTier?: 1 | 2 | 3 | 4 | 5 | 6;
} {
  const snapshotDrift = computeSnapshotDrift(currentSnapshotId, creationSnapshotId);
  const canonical = buildCanonicalAnchorMetadata(element);

  if (!inputAnchorKey) {
    return {
      anchorKey: canonical.canonicalAnchorKey,
      anchorStrategy: canonical.canonicalAnchorStrategy,
      anchorConfidence: canonical.canonicalAnchorConfidence,
      resolvedTier: canonical.canonicalResolvedTier,
      ...(snapshotDrift !== undefined ? { snapshotDrift } : {}),
    };
  }

  const normalizedAnchorKey = normalizeIncomingAnchorKey(inputAnchorKey);
  const parsed = parseEnhancedAnchorKey(normalizedAnchorKey);
  const strategy = parsed?.strategy ?? (parseAnchorKey(normalizedAnchorKey) ? "tag-sibling" : undefined);
  return {
    anchorKey: normalizedAnchorKey,
    ...(strategy
      ? {
          anchorStrategy: strategy,
          anchorConfidence: STRATEGY_CONFIDENCE[strategy],
          resolvedTier: STRATEGY_RESOLVED_TIER[strategy],
        }
      : {}),
    ...(snapshotDrift !== undefined ? { snapshotDrift } : {}),
    ...canonical,
  };
}
