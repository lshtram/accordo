import type { SnapshotEnvelopeFields } from "./types.js";
import type { CaptureError } from "./page-tool-capture-types.js";
import { RELAY_RECOVERY_HINTS, RELAY_RETRY_AFTER_MS, classifyThrownRelayError } from "./relay-error-policy.js";

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
  | CaptureError;

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
  return classifyThrownRelayError(err);
}

export function buildStructuredError(
  errorCode: string,
  details?: string,
  extra?: { pageUrl?: null; found?: false },
): PageToolError {
  const retryAfterMs = RELAY_RETRY_AFTER_MS[errorCode as keyof typeof RELAY_RETRY_AFTER_MS];
  const retryable = retryAfterMs !== undefined;
  const recoveryHints = RELAY_RECOVERY_HINTS[errorCode as keyof typeof RELAY_RECOVERY_HINTS];

  return {
    success: false,
    error: errorCode,
    ...(retryable ? { retryable: true, retryAfterMs } : { retryable: false }),
    ...(details !== undefined ? { details } : {}),
    ...(recoveryHints !== undefined ? { recoveryHints } : {}),
    ...(extra ?? { pageUrl: null, found: false }),
  };
}
