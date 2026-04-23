import type { SnapshotEnvelopeFields } from "./types.js";

export interface GetDomExcerptArgs {
  tabId?: number;
  selector: string;
  maxDepth?: number;
  maxLength?: number;
  frameId?: string;
  allowedOrigins?: string[];
  deniedOrigins?: string[];
  redactPII?: boolean;
}

export interface DomExcerptResponse extends SnapshotEnvelopeFields {
  found: boolean;
  html?: string;
  text?: string;
  nodeCount?: number;
  truncated?: boolean;
  auditId?: string;
  redactionApplied?: boolean;
  redactionWarning?: string;
}

export interface WaitForArgs {
  tabId?: number;
  texts?: string[];
  selector?: string;
  stableLayoutMs?: number;
  timeout?: number;
}

export interface GetTextMapArgs {
  tabId?: number;
  maxSegments?: number;
  frameId?: string;
  redactPII?: boolean;
  allowedOrigins?: string[];
  deniedOrigins?: string[];
  offset?: number;
  limit?: number;
}

export interface GetSemanticGraphArgs {
  tabId?: number;
  maxDepth?: number;
  visibleOnly?: boolean;
  piercesShadow?: boolean;
  frameId?: string;
  redactPII?: boolean;
  allowedOrigins?: string[];
  deniedOrigins?: string[];
}
