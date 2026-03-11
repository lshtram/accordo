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

import mermaid from "mermaid";
import type {
  DiagramType,
  SpatialDiagramType,
  SequentialDiagramType,
  ParseResult,
  RenameAnnotation,
} from "../types.js";
import { parseFlowchart } from "./flowchart.js";

const SPATIAL_TYPES = new Set<string>([
  "flowchart",
  "block-beta",
  "classDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "mindmap",
]);

const SEQUENTIAL_TYPES = new Set<string>([
  "sequenceDiagram",
  "gantt",
  "gitGraph",
  "timeline",
  "quadrantChart",
]);

// More-specific patterns must come before shorter matches.
const TYPE_PATTERNS: ReadonlyArray<[RegExp, DiagramType]> = [
  [/^(flowchart|graph)\b/, "flowchart"],
  [/^stateDiagram-v2\b/, "stateDiagram-v2"],
  [/^sequenceDiagram\b/, "sequenceDiagram"],
  [/^classDiagram\b/, "classDiagram"],
  [/^erDiagram\b/, "erDiagram"],
  [/^gantt\b/, "gantt"],
  [/^gitGraph\b/, "gitGraph"],
  [/^mindmap\b/, "mindmap"],
  [/^timeline\b/, "timeline"],
  [/^quadrantChart\b/, "quadrantChart"],
  [/^block-beta\b/, "block-beta"],
];

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
 * Type guard: returns true when `type` is a SpatialDiagramType.
 * Spatial diagrams have 2-D node positions and need a .layout.json file.
 */
export function isSpatialType(
  type: DiagramType
): type is SpatialDiagramType {
  return SPATIAL_TYPES.has(type);
}

/**
 * Type guard: returns true when `type` is a SequentialDiagramType.
 * Sequential diagrams are rendered via Kroki only; no canvas involved.
 */
export function isSequentialType(
  type: DiagramType
): type is SequentialDiagramType {
  return SEQUENTIAL_TYPES.has(type);
}

/**
 * Parse a Mermaid source string into a structured ParsedDiagram.
 *
 * Returns `{ valid: false, error }` for syntax errors or unsupported types
 * rather than throwing. Callers must check `.valid` before using `.diagram`.
 */
export function parseMermaid(source: string): ParseResult {
  const type = detectDiagramType(source);
  if (type === null) {
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
  // access is in the per-type files (flowchart.ts etc.).
  type MermaidDb = Record<string, unknown>;
  interface MermaidDiagram {
    parser: { yy: MermaidDb };
  }
  const mermaidApi = (mermaid as unknown as {
    mermaidAPI: { getDiagramFromText(s: string): MermaidDiagram };
  }).mermaidAPI;

  let diag: MermaidDiagram;
  try {
    diag = mermaidApi.getDiagramFromText(source);
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

  const parsed = parseFlowchart(diag.parser.yy);
  return {
    valid: true,
    diagram: { ...parsed, type, renames },
  };
}
