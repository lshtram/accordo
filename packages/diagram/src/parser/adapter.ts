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
  ParsedDiagram,
} from "../types.js";
import { parseFlowchart } from "./flowchart.js";
import { parseStateDiagram } from "./state-diagram.js";
import { parseClassDiagram } from "./class-diagram.js";

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
            message: `Diagram type '${m[1]}' is not supported by this extension.`,
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

  // Extract %% @rename annotations from source comments
  const renames: RenameAnnotation[] = [];
  const renameRe = new RegExp(RENAME_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = renameRe.exec(source)) !== null) {
    renames.push({ oldId: m[1], newId: m[2] });
  }

  // Invoke the mermaid internal parser — all mermaid-version-specific field
  // access (including diag.db) is in the per-type files (flowchart.ts etc.).
  type MermaidDb = Record<string, unknown>;
  interface MermaidDiagram {
    db: MermaidDb;
  }
  const mermaid = await getMermaid();
  const mermaidApi = (mermaid as unknown as {
    mermaidAPI: { getDiagramFromText(s: string): Promise<MermaidDiagram> };
  }).mermaidAPI;

  let diag: MermaidDiagram;
  try {
    diag = await mermaidApi.getDiagramFromText(source);
  } catch (e: unknown) {
    // Guard-first narrowing: check for Error first, then mermaid-specific shape
    if (e instanceof Error) {
      // Error & { hash?: {...} } preserves both the standard Error.message
      // and the mermaid-specific hash property.
      const err = e as Error & { hash?: { line?: number } };
      return {
        valid: false,
        error: {
          line: err.hash?.line ?? 0,
          message: err.message,
        },
      };
    }
    // Non-Error throws (string, number, null, undefined) — contain with String(e).
    return {
      valid: false,
      error: {
        line: 0,
        message: String(e),
      },
    };
  }

  // Mermaid 11.x stores the parsed diagram database at diag.db.
  // The top-level diag.parser and diag.parser.yy are internal bookkeeping
  // objects that are not needed here.
  const db = diag.db;

  // Dispatch to the appropriate parser based on diagram type.
  const PARSERS: Record<string, (db: MermaidDb) => ParsedDiagram> = {
    flowchart: parseFlowchart,
    "stateDiagram-v2": parseStateDiagram,
    classDiagram: parseClassDiagram,
  };

  const parser = PARSERS[type];
  if (!parser) {
    const registered = Object.keys(PARSERS).join(", ");
    return {
      valid: false,
      error: {
        line: 0,
        message: `Diagram type '${type}' is not supported. Supported types: ${registered}`,
      },
    };
  }

  let parsed: ParsedDiagram;
  try {
    parsed = parser(db);
  } catch (e: unknown) {
    return {
      valid: false,
      error: {
        line: 0,
        message: String(e),
      },
    };
  }
  return {
    valid: true,
    diagram: { ...parsed, type, renames },
  };
}
