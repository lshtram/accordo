export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewportInfo {
  readonly width: number;
  readonly height: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

export interface SpatialRelation {
  readonly sourceNodeId: number;
  readonly targetNodeId: number;
  readonly leftOf: boolean;
  readonly above: boolean;
  readonly contains: boolean;
  readonly containedBy: boolean;
  readonly overlap: number;
  readonly distance: number;
}

export interface SpatialRelationsResult {
  readonly relations: readonly SpatialRelation[];
  readonly nodeCount: number;
  readonly pairCount: number;
}

export const MAX_SPATIAL_NODE_IDS = 50;

export const SEMANTIC_CONTAINER_TAGS: ReadonlySet<string> = new Set([
  "article",
  "section",
  "aside",
  "main",
  "dialog",
  "details",
  "nav",
  "header",
  "footer",
  "form",
]);

export const SEMANTIC_CONTAINER_ROLES: ReadonlySet<string> = new Set([
  "dialog",
  "region",
  "navigation",
  "main",
  "complementary",
  "banner",
  "contentinfo",
  "form",
]);
