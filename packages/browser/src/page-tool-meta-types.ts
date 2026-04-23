import type { SnapshotEnvelopeFields } from "./types.js";

export interface ListPagesArgs {
  tabId?: number;
}

export interface SelectPageArgs {
  tabId: number;
}

export interface ListPagesResponse {
  pages: { tabId: number; url: string; title: string; active: boolean }[];
}

export interface SelectPageResponse {
  success: boolean;
  error?: string;
}

export interface GetSpatialRelationsArgs {
  tabId?: number;
  nodeIds?: number[];
  uids?: string[];
  allowedOrigins?: string[];
  deniedOrigins?: string[];
}

export interface SpatialRelationsResponse extends SnapshotEnvelopeFields {
  pageUrl: string;
  relations: readonly {
    sourceNodeId: number;
    targetNodeId: number;
    sourceUid?: string;
    targetUid?: string;
    leftOf: boolean;
    above: boolean;
    contains: boolean;
    containedBy: boolean;
    overlap: number;
    distance: number;
  }[];
  nodeCount: number;
  pairCount: number;
  missingNodeIds?: number[];
  auditId?: string;
}

export interface PageToolError {
  success: false;
  error: string;
  retryable?: boolean;
  retryAfterMs?: number;
  details?: string;
  recoveryHints?: string;
  pageUrl?: null;
  found?: false;
}

export type RelayError = "browser-not-connected" | "timeout" | "action-failed";
export type FrameError = "iframe-cross-origin" | "no-content-script";
export type SecurityError = "origin-blocked" | "redaction-failed";
export type SpatialError = "too-many-nodes" | "no-bounds";
export type BrowserToolErrorCode =
  | RelayError
  | SecurityError
  | SpatialError
  | FrameError
  | import("./page-tool-capture-types.js").CaptureError;

export const SPATIAL_RELATIONS_TIMEOUT_MS = 10_000;
export const PAGE_MAP_TIMEOUT_MS = 10_000;
export const INSPECT_TIMEOUT_MS = 5_000;
export const EXCERPT_TIMEOUT_MS = 5_000;
export const CAPTURE_REGION_TIMEOUT_MS = 5_000;
export const WAIT_FOR_RELAY_TIMEOUT_MS = 35_000;
export const TEXT_MAP_TIMEOUT_MS = 10_000;
export const SEMANTIC_GRAPH_TIMEOUT_MS = 15_000;
export const TAB_MGMT_TIMEOUT_MS = 5_000;

export function classifyRelayError(err: unknown): "timeout" | "browser-not-connected" {
  if (err instanceof Error) {
    if (err.message.includes("not-connected") || err.message.includes("disconnected")) {
      return "browser-not-connected";
    }
    return "timeout";
  }
  return "timeout";
}

const TRANSIENT_ERRORS: Record<string, number> = {
  "browser-not-connected": 2000,
  timeout: 1000,
  "action-failed": 1000,
  "detached-node": 1000,
  "capture-failed": 2000,
  "element-off-screen": 1000,
};

const RECOVERY_HINTS: Record<string, string> = {
  "browser-not-connected": "Check that the browser relay is running and the Chrome extension is connected.",
  timeout: "The operation timed out. Retry with a longer timeout or verify the page has loaded.",
  "action-failed": "The browser action failed. The element may have changed — take a fresh snapshot and retry.",
  "detached-node": "The target element was removed from the DOM. Take a new snapshot to find the updated element.",
  "capture-failed": "Screenshot capture failed. The tab may still be loading — wait briefly and retry.",
  "element-off-screen": "The element is outside the visible viewport. Scroll it into view before retrying.",
  "origin-blocked": "This origin is blocked by the security policy. Check allowedOrigins/deniedOrigins.",
  "invalid-request": "The request parameters are invalid. Check required fields and value constraints.",
};

export function buildStructuredError(
  errorCode: string,
  details?: string,
  extra?: { pageUrl?: null; found?: false },
): PageToolError {
  const retryable = errorCode in TRANSIENT_ERRORS;
  const retryAfterMs = retryable ? TRANSIENT_ERRORS[errorCode] : undefined;
  const recoveryHints = RECOVERY_HINTS[errorCode];

  return {
    success: false,
    error: errorCode,
    ...(retryable ? { retryable: true, retryAfterMs } : { retryable: false }),
    ...(details !== undefined ? { details } : {}),
    ...(recoveryHints !== undefined ? { recoveryHints } : {}),
    ...(extra ?? { pageUrl: null, found: false }),
  };
}
