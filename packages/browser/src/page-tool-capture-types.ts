import type { SnapshotEnvelopeFields } from "./types.js";

export interface CaptureRegionArgs {
  tabId?: number;
  anchorKey?: string;
  nodeRef?: string;
  rect?: { x: number; y: number; width: number; height: number };
  padding?: number;
  quality?: number;
  mode?: "viewport" | "fullPage";
  format?: "jpeg" | "png" | "webp";
  allowedOrigins?: string[];
  deniedOrigins?: string[];
  redactPII?: boolean;
  transport?: "inline" | "file-ref";
}

export interface CaptureRegionResponse extends SnapshotEnvelopeFields {
  success: boolean;
  dataUrl?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  anchorSource?: string;
  mode?: string;
  error?: CaptureError;
  auditId?: string;
  redactionWarning?: string;
  relatedSnapshotId?: string;
  screenshotRedactionApplied?: boolean;
  redactedSegmentCount?: number;
  ocrRedactionOutOfScope?: true;
  artifactMode?: "inline" | "file-ref" | "remote-ref";
  fileUri?: string;
  filePath?: string;
  transportFallback?: boolean;
}

export type CaptureError =
  | "element-not-found"
  | "element-off-screen"
  | "image-too-large"
  | "capture-failed"
  | "no-target"
  | "browser-not-connected"
  | "timeout"
  | "origin-blocked"
  | "redaction-failed"
  | "detached-node"
  | "blocked-resource"
  | "navigation-failed";
