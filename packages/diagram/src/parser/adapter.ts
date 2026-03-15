/**
 * A2 — Flowchart parser adapter (public API)
 *
 * Exposes a stable interface over mermaid's internal parser.
 * All mermaid-version-specific code is in the per-diagram-type files
 * (e.g. flowchart.ts). Nothing outside the parser/ directory imports
 * mermaid internals directly.
 *
 * Source: diag_arch_v4.2.md §6
 */

import type {
  DiagramType,
  SpatialDiagramType,
  ParseResult,
  RenameAnnotation,
} from "../types.js";
import { parseFlowchart } from "./flowchart.js";

// Node.js compatibility: Mermaid 11 bundles DOMPurify and initialises it as a
// module-level variable (`var yt = sr()`) when mermaid's chunks are first
// evaluated. `sr()` (the DOMPurify factory) calls `bo()` which returns
// `typeof window > "u" ? null : window`. When window is undefined, it returns
// null and the factory exits EARLY — without ever defining `.sanitize`.
//
// Because ESM static imports are always evaluated before the module body,
// `import mermaid from "mermaid"` would evaluate mermaid's chunks before this
// file's body runs (and before the window shim is in place). The result: `yt`
// (DOMPurify) is created without `.sanitize`, so any diagram with node labels
// throws "DOMPurify.sanitize is not a function".
//
// FIX: The window shim runs synchronously here, then mermaid is loaded via a
// dynamic import. Dynamic imports are deferred — they execute after this
// module's synchronous body, so the shim is in place before mermaid evaluates.
if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    document: {
      nodeType: 9,        // DOCUMENT_NODE — satisfies DOMPurify's initial guard
      currentScript: null,
      cookie: "",
      implementation: {}, // no createHTMLDocument → DOMPurify.isSupported=false
      createElement: () => ({ innerHTML: "" }),
      createNodeIterator: () => ({ nextNode: () => null }),
    },
    Element: class {},    // satisfies !e.Element guard in DOMPurify factory
  };
}

// Mermaid is loaded lazily (dynamic import) so that the window shim above is
// always in place before mermaid's chunks set up the module-level DOMPurify
// instance. The promise is resolved once and cached.
let _mermaidReady: Promise<typeof import("mermaid").default> | null = null;
function getMermaid(): Promise<typeof import("mermaid").default> {
  if (!_mermaidReady) {
    _mermaidReady = import("mermaid").then((mod) => {
      const m = mod.default;
      // §6.6 — parse-only mode: securityLevel:"loose" skips removeScript/addHook
      (m as { initialize(cfg: Record<string, unknown>): void }).initialize({
        startOnLoad: false,
        securityLevel: "loose",
      });
      return m;
    });
  }
  return _mermaidReady;
}

const SPATIAL_TYPES = new Set<string>([
  "flowchart",
  "block-beta",
  "classDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "mindmap",
]);

// More-specific patterns must come before shorter matches.
const TYPE_PATTERNS: ReadonlyArray<[RegExp, DiagramType]> = [
  [/^(flowchart|graph)\b/, "flowchart"],
  [/^stateDiagram-v2\b/, "stateDiagram-v2"],
  [/^classDiagram\b/, "classDiagram"],
  [/^erDiagram\b/, "erDiagram"],
  [/^mindmap\b/, "mindmap"],
  [/^block-beta\b/, "block-beta"],
];

// Known sequential/non-spatial types that are explicitly out of scope.
const UNSUPPORTED_TYPE_RE =
  /^(sequenceDiagram|gantt|gitGraph|timeline|quadrantChart)\b/;

const RENAME_RE = /%% @rename: (\S+) -> (\S+)/g;

/**
 * Detect the diagram type from the first non-empty, non-comment line of source.
 * Returns null if the source is empty or the type is unrecognised.
 */
export function detectDiagramType(source: string): DiagramType | null {
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    for (const [pattern, type] of TYPE_PATTERNS) {
      if (pattern.test(trimmed)) return type;
    }
    return null;
  }
  return null;
}

/**
 * Type guard: returns true when the string is a supported spatial diagram type.
 * Use this to validate types detected from file content before processing.
 */
export function isSpatialType(type: string): type is DiagramType {
  return SPATIAL_TYPES.has(type);
}

/**
 * Parse a Mermaid source string into a structured ParsedDiagram.
 *
 * Returns `{ valid: false, error }` for syntax errors or unsupported types
 * rather than throwing. Callers must check `.valid` before using `.diagram`.
 */
export async function parseMermaid(source: string): Promise<ParseResult> {
  const type = detectDiagramType(source);
  if (type === null) {
    // Check whether the source starts with a known-but-unsupported sequential type
    // so callers receive an actionable message rather than a generic error.
    for (const line of source.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("%%")) continue;
      const m = UNSUPPORTED_TYPE_RE.exec(trimmed);
      if (m) {
        return {
          valid: false,
          error: {
            line: 0,
            message: `Diagram type '${m[1]}' is not supported by this extension. Only spatial types are supported: flowchart, classDiagram, stateDiagram-v2, erDiagram, mindmap, block-beta.`,
          },
        };
      }
      break; // first meaningful line checked — no need to scan further
    }
    return {
      valid: false,
      error: { line: 0, message: "Unrecognised or empty diagram source" },
    };
  }

  if (type !== "flowchart") {
    return {
      valid: false,
      error: {
        line: 0,
        message: `Diagram type '${type}' is not supported in diag.1 (flowchart only)`,
      },
    };
  }

  // Extract %% @rename annotations from source comments
  const renames: RenameAnnotation[] = [];
  const renameRe = new RegExp(RENAME_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = renameRe.exec(source)) !== null) {
    renames.push({ oldId: m[1], newId: m[2] });
  }

  // Invoke the mermaid internal parser — all mermaid-version-specific field
  // access is in the per-type files (flowchart.ts etc.).
  type MermaidDb = Record<string, unknown>;
  interface MermaidDiagram {
    parser: { yy: MermaidDb; parser?: { yy: MermaidDb } };
  }
  const mermaid = await getMermaid();
  const mermaidApi = (mermaid as unknown as {
    mermaidAPI: { getDiagramFromText(s: string): Promise<MermaidDiagram> };
  }).mermaidAPI;

  let diag: MermaidDiagram;
  try {
    diag = await mermaidApi.getDiagramFromText(source);
  } catch (e: unknown) {
    const err = e as { message?: string; hash?: { line?: number } };
    return {
      valid: false,
      error: {
        line: err.hash?.line ?? 0,
        message: err.message ?? String(e),
      },
    };
  }

  // Mermaid 11.x wraps the real db at diag.parser.parser.yy; the top-level
  // diag.parser.yy is an empty proxy when running in a real Node environment.
  // Mocked tests return the db directly at diag.parser.yy (no inner parser).
  const db = diag.parser.parser?.yy ?? diag.parser.yy;
  const parsed = parseFlowchart(db);
  return {
    valid: true,
    diagram: { ...parsed, type, renames },
  };
}
