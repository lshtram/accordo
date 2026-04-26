import type { SnapshotEnvelopeFields } from "./types.js";

/** Relay timeout for text map collection (ms). */
export const TEXT_MAP_TIMEOUT_MS = 10_000;
export const TEXT_MAP_DEFAULT_MAX_SEGMENTS = 500;
export const TEXT_MAP_MAX_SEGMENTS = 2000;

export interface GetTextMapArgs {
  tabId?: number;
  maxSegments?: number;
  visibleOnly?: boolean;
  frameId?: string;
  redactPII?: boolean;
  allowedOrigins?: string[];
  deniedOrigins?: string[];
  offset?: number;
  limit?: number;
}

export type TextVisibility = "visible" | "hidden" | "offscreen";

export interface TextSegment {
  textRaw: string;
  textNormalized: string;
  nodeId: number;
  role?: string;
  accessibleName?: string;
  bbox: { x: number; y: number; width: number; height: number };
  visibility: TextVisibility;
  readingOrderIndex: number;
}

export interface TextMapResponse extends SnapshotEnvelopeFields {
  pageUrl: string;
  title: string;
  segments: TextSegment[];
  totalSegments: number;
  truncated: boolean;
  redactionApplied?: boolean;
  redactionWarning?: string;
  hasMore?: boolean;
  nextOffset?: number;
  totalAvailable?: number;
}

export interface TextMapToolError {
  success: false;
  error: "browser-not-connected" | "timeout" | "action-failed" | "iframe-cross-origin" | "no-content-script" | "origin-blocked";
}
