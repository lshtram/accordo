import type { SnapshotEnvelopeFields } from "./types.js";

export interface GetPageMapArgs {
  tabId?: number;
  maxDepth?: number;
  maxNodes?: number;
  includeBounds?: boolean;
  viewportOnly?: boolean;
  offset?: number;
  limit?: number;
  visibleOnly?: boolean;
  interactiveOnly?: boolean;
  roles?: string[];
  textMatch?: string;
  selector?: string;
  regionFilter?: { x: number; y: number; width: number; height: number };
  piercesShadow?: boolean;
  traverseFrames?: boolean;
  frameFilter?: Array<"content" | "ad" | "widget" | "unknown">;
  allowedOrigins?: string[];
  deniedOrigins?: string[];
  redactPII?: boolean;
}

export interface PageMapResponse extends SnapshotEnvelopeFields {
  pageUrl: string;
  title: string;
  nodes: unknown[];
  totalElements: number;
  depth: number;
  truncated: boolean;
  filterSummary?: {
    activeFilters: string[];
    totalBeforeFilter: number;
    totalAfterFilter: number;
    reductionRatio: number;
  };
  iframes?: readonly IframeMetadata[];
  auditId?: string;
  redactionApplied?: boolean;
  redactionWarning?: string;
  hasMore?: boolean;
  nextOffset?: number;
  totalAvailable?: number;
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
}
