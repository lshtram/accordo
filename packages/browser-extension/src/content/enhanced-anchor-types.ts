export type AnchorStrategy =
  | "id"
  | "data-testid"
  | "aria"
  | "css-path"
  | "tag-sibling"
  | "viewport-pct";

export type AnchorResolvedTier = 1 | 2 | 3 | 4 | 5 | 6;

export interface AnchorGenerationResult {
  anchorKey: string;
  strategy: AnchorStrategy;
  confidence: "high" | "medium" | "low";
}

export interface ParsedEnhancedAnchor {
  strategy: AnchorStrategy;
  value: string;
  offsetX?: number;
  offsetY?: number;
}

export const STRATEGY_CONFIDENCE: Readonly<Record<AnchorStrategy, "high" | "medium" | "low">> = {
  id: "high",
  "data-testid": "high",
  aria: "medium",
  "css-path": "medium",
  "tag-sibling": "low",
  "viewport-pct": "low",
};

export const STRATEGY_RESOLVED_TIER: Readonly<Record<AnchorStrategy, AnchorResolvedTier>> = {
  id: 1,
  "data-testid": 2,
  aria: 3,
  "css-path": 4,
  "tag-sibling": 5,
  "viewport-pct": 6,
};

export const STRATEGY_PREFIXES: readonly string[] = [
  "id:", "data-testid:", "aria:", "css:", "tag:", "body:",
];
