import type { SnapshotEnvelope } from "../snapshot-versioning.js";

export type TextVisibility = "visible" | "hidden" | "offscreen";

export interface TextSegment {
  textRaw: string;
  textNormalized: string;
  nodeId: number;
  uid?: string;
  role?: string;
  accessibleName?: string;
  bbox: { x: number; y: number; width: number; height: number };
  visibility: TextVisibility;
  readingOrderIndex: number;
}

export interface TextMapOptions {
  maxSegments?: number;
  logicalFrameId?: string;
}

export interface TextMapResult extends SnapshotEnvelope {
  pageUrl: string;
  title: string;
  segments: TextSegment[];
  totalSegments: number;
  truncated: boolean;
}

export const DEFAULT_MAX_SEGMENTS = 500;
export const MAX_SEGMENTS_LIMIT = 2000;
export const TEXT_EXCLUDED_TAGS: ReadonlySet<string> = new Set([
  "script", "style", "noscript", "template", "link", "meta",
]);
export const VERTICAL_BAND_TOLERANCE_PX = 5;

export const TAG_ROLES: Readonly<Record<string, string>> = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  button: "button",
  a: "link",
  img: "img",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  form: "form",
  table: "table",
  input: "textbox",
  textarea: "textbox",
  select: "listbox",
  ul: "list",
  ol: "list",
  li: "listitem",
};
