import type { SnapshotEnvelope } from "../snapshot-versioning.js";

export interface PageNode {
  ref: string;
  tag: string;
  nodeId: number;
  uid?: string;
  persistentId?: string;
  id?: string;
  role?: string;
  name?: string;
  text?: string;
  attrs?: Record<string, string>;
  bounds?: { x: number; y: number; width: number; height: number };
  viewportRatio?: number;
  containerId?: number;
  zIndex?: number;
  isStacked?: boolean;
  occluded?: boolean;
  inShadowRoot?: true;
  shadowHostId?: number;
  shadowRoot?: "closed";
  children?: PageNode[];
}

export interface PageMapOptions {
  maxDepth?: number;
  maxNodes?: number;
  includeBounds?: boolean;
  viewportOnly?: boolean;
  visibleOnly?: boolean;
  interactiveOnly?: boolean;
  roles?: string[];
  textMatch?: string;
  selector?: string;
  regionFilter?: { x: number; y: number; width: number; height: number };
  piercesShadow?: boolean;
  traverseFrames?: boolean;
  logicalFrameId?: string;
}

export interface IframeMetadata {
  frameId: string;
  src: string;
  bounds: { x: number; y: number; width: number; height: number };
  sameOrigin: boolean;
  parentFrameId: string | null;
  title?: string;
  depth: number;
  classification: "content" | "ad" | "widget" | "unknown";
  visible: boolean;
  nodes?: PageNode[];
  iframes?: IframeMetadata[];
}

export interface FilterSummary {
  activeFilters: string[];
  totalBeforeFilter: number;
  totalAfterFilter: number;
  reductionRatio: number;
}

export interface PageMapResult extends SnapshotEnvelope {
  pageUrl: string;
  title: string;
  nodes: PageNode[];
  totalElements: number;
  truncated: boolean;
  filterSummary?: FilterSummary;
  iframes?: IframeMetadata[];
}

export const EXCLUDED_TAGS: ReadonlySet<string> = new Set([
  "script", "style", "noscript", "template", "link", "meta",
]);

export const MAX_DEPTH_LIMIT = 8;
export const MAX_NODES_LIMIT = 500;
export const DEFAULT_MAX_DEPTH = 4;
export const DEFAULT_MAX_NODES = 200;
export const MAX_TEXT_LENGTH = 100;

export const INCLUDED_ATTRS: readonly string[] = [
  "id", "class", "href", "src", "type", "data-testid", "data-cy", "data-test",
  "aria-label", "aria-labelledby", "aria-describedby", "alt", "title", "name",
  "placeholder", "value", "action", "method",
];
