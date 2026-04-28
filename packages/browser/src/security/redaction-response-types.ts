export interface TextMapLike {
  segments: Array<{ textRaw: string; textNormalized: string; accessibleName?: string }>;
}

export interface SemanticGraphLike {
  a11yTree: Array<{ name?: string; children: SemanticGraphLike["a11yTree"] }>;
  landmarks: Array<{ label?: string }>;
  outline: Array<{ text: string }>;
  forms: Array<{ name?: string; fields: Array<{ label?: string; value?: string; name?: string }> }>;
}

export interface PageMapLike {
  nodes: unknown[];
  children?: unknown[];
}

export interface InspectElementLike {
  element?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface DomExcerptLike {
  text?: string;
}
