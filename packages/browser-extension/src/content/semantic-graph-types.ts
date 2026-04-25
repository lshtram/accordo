export const DEFAULT_MAX_DEPTH = 8;
export const MAX_DEPTH_LIMIT = 16;
export const SEMANTIC_GRAPH_TIMEOUT_MS = 15_000;

export const EXCLUDED_TAGS: ReadonlySet<string> = new Set([
  "script", "style", "noscript", "template", "link", "meta",
]);

export const LANDMARK_ROLES: ReadonlySet<string> = new Set([
  "navigation",
  "main",
  "banner",
  "contentinfo",
  "complementary",
  "search",
  "form",
  "region",
]);

export const LANDMARK_TAG_ROLES: Readonly<Record<string, string>> = {
  header: "banner",
  nav: "navigation",
  main: "main",
  aside: "complementary",
  footer: "contentinfo",
  form: "form",
  search: "search",
};

export const TAG_ROLES: Readonly<Record<string, string>> = {
  ...LANDMARK_TAG_ROLES,
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  button: "button",
  a: "link",
  img: "img",
  table: "table",
  input: "textbox",
  textarea: "textbox",
  select: "listbox",
  ul: "list",
  ol: "list",
  li: "listitem",
  article: "article",
  div: "generic",
  span: "generic",
};

export interface SemanticA11yNode {
  role: string;
  name?: string;
  level?: number;
  nodeId: number;
  uid?: string;
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
  uid?: string;
  disabled?: boolean;
  readonly?: boolean;
  constraints?: {
    minLength?: number;
    maxLength?: number;
    min?: number | string;
    max?: number | string;
    step?: number | string;
    pattern?: string;
  };
  validationState?: "valid" | "invalid";
  validationMessage?: string;
}

export interface FormModel {
  formId?: string;
  name?: string;
  action?: string;
  method: string;
  nodeId: number;
  uid?: string;
  fields: FormField[];
  summary?: {
    total: number;
    optional: number;
    disabled: number;
  };
}

export interface SemanticGraphOptions {
  maxDepth?: number;
  visibleOnly?: boolean;
  piercesShadow?: boolean;
  logicalFrameId?: string;
}

export interface SemanticGraphResult {
  pageId: string;
  frameId: string;
  snapshotId: string;
  capturedAt: string;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    devicePixelRatio: number;
  };
  source: "dom" | "a11y" | "visual" | "layout" | "network";
  pageUrl: string;
  title: string;
  a11yTree: SemanticA11yNode[];
  landmarks: Landmark[];
  outline: OutlineHeading[];
  forms: FormModel[];
}
