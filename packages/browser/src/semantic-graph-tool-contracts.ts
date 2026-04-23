import type { SnapshotEnvelopeFields } from "./types.js";

/** Relay timeout for semantic graph collection (ms). B2-SG-010. */
export const SEMANTIC_GRAPH_TOOL_TIMEOUT_MS = 15_000;

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

export interface SemanticA11yNode {
  role: string;
  name?: string;
  level?: number;
  nodeId: number;
  children: SemanticA11yNode[];
  states?: string[];
  inShadowRoot?: true;
  shadowHostId?: number;
}

export interface Landmark {
  role: string;
  label?: string;
  nodeId: number;
  tag: string;
}

export interface OutlineHeading {
  level: number;
  text: string;
  nodeId: number;
  id?: string;
}

export interface FormField {
  tag: string;
  type?: string;
  name?: string;
  label?: string;
  required: boolean;
  value?: string;
  nodeId: number;
}

export interface FormModel {
  formId?: string;
  name?: string;
  action?: string;
  method: string;
  nodeId: number;
  fields: FormField[];
}

export interface SemanticGraphResponse extends SnapshotEnvelopeFields {
  pageUrl: string;
  title: string;
  a11yTree: SemanticA11yNode[];
  landmarks: Landmark[];
  outline: OutlineHeading[];
  forms: FormModel[];
  redactionApplied?: boolean;
  redactionWarning?: string;
  auditId?: string;
}

export interface SemanticGraphToolError {
  success: false;
  error: "browser-not-connected" | "timeout" | "action-failed" | "iframe-cross-origin" | "no-content-script";
}
