/**
 * A14 — MCP tool definitions for the diagram package.
 *
 * Exports the six accordo_diagram_* tool definitions plus all handler
 * functions and supporting types. Handlers are exported separately so
 * tests can call them directly with a mock DiagramToolContext.
 *
 * Public API
 * ──────────
 *   createDiagramTools(ctx) → ExtensionToolDefinition[]   (used by extension entry)
 *   resolveGuarded(root, inputPath) → string               (throws DiagToolError)
 *   listHandler / getHandler / createHandler / patchHandler / renderHandler / styleGuideHandler
 *
 * Source: diag_workplan.md §4.14, diag_arch_v4.2.md §6
 */

import { readFile, writeFile, readdir, access } from "node:fs/promises";
import { resolve, relative, join, dirname, basename, extname, isAbsolute } from "node:path";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { DiagramType, ParsedNode, ParsedEdge, ParsedCluster, LayoutStore, NodeStyle, ReconcileResult } from "../types.js";
import { parseMermaid, detectDiagramType } from "../parser/adapter.js";
import { computeInitialLayout } from "../layout/auto-layout.js";
import { layoutPathFor, readLayout, writeLayout } from "../layout/layout-store.js";
import { reconcile, InvalidMermaidError } from "../reconciler/reconciler.js";

// ── Result envelope ───────────────────────────────────────────────────────────

export type ErrorCode =
  | "FILE_NOT_FOUND"
  | "PARSE_ERROR"
  | "TRAVERSAL_DENIED"
  | "ALREADY_EXISTS"
  | "PANEL_NOT_OPEN"
  | "PANEL_MISMATCH";

export type ToolOk<T> = { ok: true; data: T };
export type ToolErr = { ok: false; errorCode: ErrorCode; message: string };
export type ToolResult<T> = ToolOk<T> | ToolErr;

// ── Path helper error ─────────────────────────────────────────────────────────

/**
 * Thrown by resolveGuarded when a path escapes the workspace root.
 * Handlers catch this and convert it to a ToolErr.
 */
export class DiagToolError extends Error {
  constructor(
    public readonly errorCode: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DiagToolError";
  }
}

// ── Context interfaces ────────────────────────────────────────────────────────

export interface DiagramPanelLike {
  readonly mmdPath: string;
  requestExport(format: "svg" | "png"): Promise<Buffer>;
}

export interface DiagramToolContext {
  workspaceRoot: string;
  getPanel(): DiagramPanelLike | undefined;
}

// ── Return-data interfaces (public for test type-checking) ───────────────────

export interface DiagramListEntry {
  /** Path relative to workspaceRoot */
  path: string;
  /** Detected diagram type, or null for unrecognised */
  type: string | null;
  nodeCount: number;
}

export interface DiagramGetResult {
  source: string;
  type: DiagramType;
  nodes: ParsedNode[];
  edges: readonly ParsedEdge[];
  clusters: readonly ParsedCluster[];
  /** null when no .layout.json exists */
  layout: LayoutStore | null;
}

export interface DiagramCreateResult {
  created: true;
  path: string;
  layoutPath: string;
  type: DiagramType;
  nodeCount: number;
}

export interface DiagramPatchResult {
  patched: true;
  path: string;
  changes: ReconcileResult["changes"];
  /** Present when @rename annotations were processed */
  mermaidCleaned?: string;
}

export interface DiagramRenderResult {
  rendered: true;
  output_path: string;
  format: "svg" | "png";
  bytes: number;
}

export interface DiagramStyleGuideResult {
  palette: Record<string, string>;
  starterTemplate: string;
  conventions: string[];
  /** How to apply per-node colours and fonts via accordo_diagram_patch. */
  stylingInstructions: string[];
}

// ── Path guard ────────────────────────────────────────────────────────────────

/**
 * Resolve `inputPath` against `workspaceRoot` and verify that the result
 * stays inside the root (no directory traversal).
 *
 * Uses path.relative() to detect escapes — the resolved path is safe iff
 *   !rel.startsWith("..") && !path.isAbsolute(rel)
 *
 * @throws {DiagToolError} errorCode: "TRAVERSAL_DENIED" when path escapes root
 */
export function resolveGuarded(workspaceRoot: string, inputPath: string): string {
  const resolved = resolve(workspaceRoot, inputPath);
  const rel = relative(workspaceRoot, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new DiagToolError(
      "TRAVERSAL_DENIED",
      `Path '${inputPath}' escapes the workspace root`,
    );
  }
  return resolved;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Walk a directory recursively and collect all files matching the predicate. */
async function globFiles(
  dir: string,
  predicate: (name: string) => boolean,
  results: string[] = [],
): Promise<string[]> {
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await globFiles(full, predicate, results);
    } else if (predicate(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/** Return a ToolErr object (does not throw). */
function err<T>(errorCode: ErrorCode, message: string): ToolResult<T> {
  return { ok: false, errorCode, message };
}

/** Return a ToolOk object. */
function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

// ── Handler stubs ─────────────────────────────────────────────────────────────

/**
 * accordo_diagram_list — Discover all .mmd files in the workspace.
 * Returns path (relative), detected type, and parsed node count per file.
 */
export async function listHandler(
  _args: Record<string, unknown>,
  ctx: DiagramToolContext,
): Promise<ToolResult<DiagramListEntry[]>> {
  const files = await globFiles(ctx.workspaceRoot, (name) => name.endsWith(".mmd"));
  const entries: DiagramListEntry[] = [];
  for (const absPath of files) {
    const source = await readFile(absPath, "utf-8").catch(() => "");
    const type = detectDiagramType(source);
    let nodeCount = 0;
    if (type !== null) {
      const result = await parseMermaid(source);
      if (result.valid) {
        nodeCount = result.diagram.nodes.size;
      }
    }
    entries.push({
      path: relative(ctx.workspaceRoot, absPath),
      type,
      nodeCount,
    });
  }
  return ok(entries);
}

/**
 * accordo_diagram_get — Parse a .mmd file and return its semantic graph + layout.
 * args.path: string (relative to workspaceRoot)
 */
export async function getHandler(
  args: Record<string, unknown>,
  ctx: DiagramToolContext,
): Promise<ToolResult<DiagramGetResult>> {
  let resolved: string;
  try {
    resolved = resolveGuarded(ctx.workspaceRoot, args.path as string);
  } catch (e) {
    if (e instanceof DiagToolError) return err(e.errorCode, e.message);
    throw e;
  }

  let source: string;
  try {
    source = await readFile(resolved, "utf-8");
  } catch {
    return err("FILE_NOT_FOUND", `File not found: ${args.path as string}`);
  }

  const parseResult = await parseMermaid(source);
  if (!parseResult.valid) {
    return err("PARSE_ERROR", parseResult.error.message);
  }
  const { diagram } = parseResult;

  const layoutPath = layoutPathFor(resolved, ctx.workspaceRoot);
  const layout = await readLayout(layoutPath);

  return ok({
    source,
    type: diagram.type,
    nodes: Array.from(diagram.nodes.values()),
    edges: Array.from(diagram.edges),
    clusters: Array.from(diagram.clusters),
    layout,
  });
}

/**
 * accordo_diagram_create — Write a new .mmd file and compute its initial layout.
 * args.path: string, args.content: string, args.force?: boolean
 */
export async function createHandler(
  args: Record<string, unknown>,
  ctx: DiagramToolContext,
): Promise<ToolResult<DiagramCreateResult>> {
  let resolved: string;
  try {
    resolved = resolveGuarded(ctx.workspaceRoot, args.path as string);
  } catch (e) {
    if (e instanceof DiagToolError) return err(e.errorCode, e.message);
    throw e;
  }

  const content = args.content as string;
  const force = Boolean(args.force ?? false);

  // Validate content before touching disk
  const parseResult = await parseMermaid(content);
  if (!parseResult.valid) {
    return err("PARSE_ERROR", parseResult.error.message);
  }
  const { diagram } = parseResult;

  // Check existence (honour force flag)
  if (!force) {
    try {
      await access(resolved);
      return err("ALREADY_EXISTS", `File already exists: ${args.path as string}`);
    } catch {
      // does not exist — proceed
    }
  }

  const layout = computeInitialLayout(diagram);
  const lPath = layoutPathFor(resolved, ctx.workspaceRoot);

  await writeFile(resolved, content, "utf-8");
  await writeLayout(lPath, layout);

  return ok({
    created: true as const,
    path: relative(ctx.workspaceRoot, resolved),
    layoutPath: relative(ctx.workspaceRoot, lPath),
    type: diagram.type,
    nodeCount: diagram.nodes.size,
  });
}

/**
 * accordo_diagram_patch — Update an existing .mmd file and reconcile its layout.
 * args.path: string, args.content: string
 *
 * Layout fallback (when .layout.json is missing or corrupt):
 *   parse oldSource → computeInitialLayout(oldParsed) → reconcile(old, new, baseline)
 */
export async function patchHandler(
  args: Record<string, unknown>,
  ctx: DiagramToolContext,
): Promise<ToolResult<DiagramPatchResult>> {
  let resolved: string;
  try {
    resolved = resolveGuarded(ctx.workspaceRoot, args.path as string);
  } catch (e) {
    if (e instanceof DiagToolError) return err(e.errorCode, e.message);
    throw e;
  }

  let oldSource: string;
  try {
    oldSource = await readFile(resolved, "utf-8");
  } catch {
    return err("FILE_NOT_FOUND", `File not found: ${args.path as string}`);
  }

  const newSource = args.content as string;
  const lPath = layoutPathFor(resolved, ctx.workspaceRoot);

  let currentLayout = await readLayout(lPath);
  if (currentLayout === null) {
    const oldParseResult = await parseMermaid(oldSource);
    if (oldParseResult.valid) {
      currentLayout = computeInitialLayout(oldParseResult.diagram);
    } else {
      // Old source is also unreadable — build from new source after reconcile
      // The reconciler will handle this as an empty-old-diagram baseline
      currentLayout = {
        version: "1.0",
        diagram_type: (detectDiagramType(newSource) ?? "flowchart") as DiagramType,
        nodes: {},
        edges: {},
        clusters: {},
        unplaced: [],
        aesthetics: { roughness: 1, animationMode: "draw-on" },
      } as LayoutStore;
    }
  }

  let reconcileResult: ReconcileResult;
  try {
    reconcileResult = await reconcile(oldSource, newSource, currentLayout);
  } catch (e) {
    if (e instanceof InvalidMermaidError) {
      return err("PARSE_ERROR", e.message);
    }
    throw e;
  }

  // Apply any nodeStyles overrides passed by the caller.
  // width/height are layout sizing overrides (applied to nl.w / nl.h).
  // All other fields are visual style overrides (applied to nl.style).
  let finalLayout = reconcileResult.layout;
  const rawNodeStyles = args.nodeStyles as Record<string, Record<string, unknown>> | undefined;
  if (rawNodeStyles !== undefined && typeof rawNodeStyles === "object") {
    const updatedNodes = { ...finalLayout.nodes };
    for (const [nodeId, overrides] of Object.entries(rawNodeStyles)) {
      if (updatedNodes[nodeId] === undefined) continue;
      const existing = updatedNodes[nodeId]!; // guarded by the undefined check above
      // Extract sizing overrides — these go into NodeLayout w/h, not NodeStyle.
      const { width, height, x, y, ...styleOverrides } = overrides;
      // Whitelist known NodeStyle keys so unknown agent fields are silently
      // dropped rather than blindly spread into the stored style object.
      const NODE_STYLE_KEYS: ReadonlyArray<keyof NodeStyle> = [
        "backgroundColor", "strokeColor", "strokeWidth", "strokeStyle",
        "strokeDash", "fillStyle", "shape", "fontSize", "fontColor",
        "fontWeight", "opacity", "roughness", "fontFamily",
      ];
      const styleFields: Record<string, unknown> = {};
      for (const key of NODE_STYLE_KEYS) {
        if (styleOverrides[key] !== undefined) {
          styleFields[key] = styleOverrides[key];
        }
      }
      updatedNodes[nodeId] = {
        ...existing,
        ...(typeof x      === "number" ? { x } : {}),
        ...(typeof y      === "number" ? { y } : {}),
        ...(typeof width  === "number" ? { w: width  } : {}),
        ...(typeof height === "number" ? { h: height } : {}),
        style: { ...existing.style, ...(styleFields as Partial<NodeStyle>) },
      };
    }
    finalLayout = { ...finalLayout, nodes: updatedNodes };
  }

  // Apply clusterStyles overrides (x, y, w, h, and visual style fields).
  const rawClusterStyles = args.clusterStyles as Record<string, Record<string, unknown>> | undefined;
  if (rawClusterStyles !== undefined && typeof rawClusterStyles === "object") {
    const updatedClusters = { ...finalLayout.clusters };
    for (const [clusterId, overrides] of Object.entries(rawClusterStyles)) {
      if (updatedClusters[clusterId] === undefined) continue;
      const existing = updatedClusters[clusterId]!;
      const { x, y, width, height, ...styleOverrides } = overrides;
      const CLUSTER_STYLE_KEYS = ["backgroundColor", "strokeColor", "strokeWidth", "strokeDash"] as const;
      const styleFields: Record<string, unknown> = {};
      for (const key of CLUSTER_STYLE_KEYS) {
        if (styleOverrides[key] !== undefined) styleFields[key] = styleOverrides[key];
      }
      updatedClusters[clusterId] = {
        ...existing,
        ...(typeof x      === "number" ? { x } : {}),
        ...(typeof y      === "number" ? { y } : {}),
        ...(typeof width  === "number" ? { w: width  } : {}),
        ...(typeof height === "number" ? { h: height } : {}),
        style: { ...existing.style, ...styleFields },
      };
    }
    finalLayout = { ...finalLayout, clusters: updatedClusters };
  }

  await writeFile(resolved, reconcileResult.mermaidCleaned ?? newSource, "utf-8");
  await writeLayout(lPath, finalLayout);

  return ok({
    patched: true as const,
    path: relative(ctx.workspaceRoot, resolved),
    changes: reconcileResult.changes,
    mermaidCleaned: reconcileResult.mermaidCleaned,
  });
}

/**
 * accordo_diagram_render — Delegate to the active panel to export SVG/PNG.
 * args.path: string, args.format: "svg"|"png", args.output_path?: string
 *
 * Both path and output_path are validated with resolveGuarded.
 * panel.mmdPath must exactly match the resolved path.
 */
export async function renderHandler(
  args: Record<string, unknown>,
  ctx: DiagramToolContext,
): Promise<ToolResult<DiagramRenderResult>> {
  let resolvedPath: string;
  try {
    resolvedPath = resolveGuarded(ctx.workspaceRoot, args.path as string);
  } catch (e) {
    if (e instanceof DiagToolError) return err(e.errorCode, e.message);
    throw e;
  }

  const format = args.format as "svg" | "png";

  // Resolve output_path early (before panel check), so traversal is caught first
  const rawOutputPath = args.output_path as string | undefined;
  let resolvedOutputPath: string;
  if (rawOutputPath !== undefined) {
    try {
      resolvedOutputPath = resolveGuarded(ctx.workspaceRoot, rawOutputPath);
    } catch (e) {
      if (e instanceof DiagToolError) return err(e.errorCode, e.message);
      throw e;
    }
  } else {
    const stem = basename(resolvedPath, extname(resolvedPath));
    resolvedOutputPath = join(dirname(resolvedPath), `${stem}.${format}`);
  }

  const panel = ctx.getPanel();
  if (panel === undefined) {
    return err("PANEL_NOT_OPEN", "No diagram panel is currently open");
  }

  if (panel.mmdPath !== resolvedPath) {
    return err(
      "PANEL_MISMATCH",
      `Panel is open for '${panel.mmdPath}' but requested path is '${resolvedPath}'`,
    );
  }

  const buffer = await panel.requestExport(format);
  await writeFile(resolvedOutputPath, buffer);

  return ok({
    rendered: true as const,
    output_path: relative(ctx.workspaceRoot, resolvedOutputPath),
    format,
    bytes: buffer.length,
  });
}

/**
 * accordo_diagram_style_guide — Pure lookup; returns palette, template, conventions.
 * Synchronous — no I/O.
 */
export function styleGuideHandler(
  _args: Record<string, unknown>,
): ToolResult<DiagramStyleGuideResult> {
  return ok({
    palette: {
      primary: "#4A90D9",
      secondary: "#7B68EE",
      success: "#27AE60",
      warning: "#F39C12",
      danger: "#E74C3C",
      neutral: "#95A5A6",
      background: "#FAFAFA",
      border: "#BDC3C7",
    },
    starterTemplate: [
      "flowchart TD",
      "  A[Start] --> B{Decision}",
      "  B -- Yes --> C[Action]",
      "  B -- No --> D[End]",
    ].join("\n"),
    conventions: [
      "Use PascalCase node IDs for clarity (e.g. ServiceA, DbLayer)",
      "Prefer flowchart TD for top-down hierarchies, LR for pipelines",
      "Add %% @rename: old_id -> new_id comments to trigger layout migration",
      "Keep node labels concise — 3 words or fewer",
      "Use subgraphs to group related nodes into clusters",
      "Avoid duplicate node IDs across subgraph boundaries",
    ],
    stylingInstructions: [
      "IMPORTANT: Do NOT use Mermaid classDef or style directives — Accordo ignores them.",
      "To style or resize nodes, pass the 'nodeStyles' argument to accordo_diagram_patch alongside your content.",
      "nodeStyles is an object mapping node IDs to per-node overrides.",
      "",
      "VISUAL STYLE fields (stored in layout.json NodeStyle):",
      "  backgroundColor: hex string, e.g. '#4A90D9'",
      "  strokeColor: hex string for the border",
      "  strokeWidth: number in px, e.g. 2",
      "  strokeStyle: 'solid' | 'dashed' | 'dotted'",
      "  fillStyle: 'hachure' | 'cross-hatch' | 'solid' | 'zigzag' | 'dots' | 'dashed' | 'zigzag-line'",
      "  opacity: number 0–1, e.g. 0.8",
      "  roughness: number 0–3 (0=crisp, 1=hand-drawn default, higher=more rough)",
      "",
      "FONT fields:",
      "  fontColor: hex string for text color",
      "  fontSize: number in px, e.g. 18",
      "  fontFamily: 'Excalifont' | 'Nunito' | 'Comic Shanns'",
      "  fontWeight: 'normal' | 'bold'",
      "",
      "SIZE / POSITION fields (applied to NodeLayout dimensions/coordinates, not NodeStyle):",
      "  width: number in px — overrides the node width",
      "  height: number in px — overrides the node height",
      "  x: number in px — overrides the node X position (left edge)",
      "  y: number in px — overrides the node Y position (top edge)",
      "",
      "CLUSTER OVERRIDES (use the 'clusterStyles' argument, NOT nodeStyles):",
      "  clusterStyles: { MCP: { x: 50, y: 20, width: 600, height: 400, backgroundColor: '#f0f0f0' } }",
      "  Cluster IDs are the subgraph IDs from the Mermaid source (e.g. 'subgraph MCP' → ID is 'MCP').",
      "",
      "IMPORTANT: NEVER edit .layout.json or .excalidraw files directly.",
      "Always use accordo_diagram_patch to modify node/cluster positions, sizes, and styles.",
      "",
      "EXAMPLE — apply blue fill, white text, wider node:",
      "  nodeStyles: { A: { backgroundColor: '#4A90D9', fontColor: '#ffffff', width: 220 } }",
      "",
      "EXAMPLE — dashed border + solid fill + Nunito font:",
      "  nodeStyles: { B: { strokeStyle: 'dashed', fillStyle: 'solid', fontFamily: 'Nunito' } }",
      "",
      "nodeStyles merges into existing styles — update only what you need.",
      "nodeStyles only applies to nodes that already exist in the diagram.",
    ],
  });
}

// ── Tool definitions factory ──────────────────────────────────────────────────

/**
 * Build the six accordo_diagram_* ExtensionToolDefinition objects bound to `ctx`.
 * Called once during extension activation.
 */
export function createDiagramTools(ctx: DiagramToolContext): ExtensionToolDefinition[] {
  return [
    {
      name: "accordo_diagram_list",
      group: "diagram",
      description: "List all .mmd diagram files in the workspace with type and node count.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => listHandler(args, ctx),
    },
    {
      name: "accordo_diagram_get",
      group: "diagram",
      description: "Parse and return the semantic graph and layout of a .mmd diagram file.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the .mmd file, relative to workspace root",
          },
        },
        required: ["path"],
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => getHandler(args, ctx),
    },
    {
      name: "accordo_diagram_create",
      group: "diagram",
      description:
        "Create a new .mmd diagram file and write its computed initial layout alongside it.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Destination path for the .mmd file, relative to workspace root",
          },
          content: { type: "string", description: "Valid Mermaid diagram source" },
          force: {
            type: "boolean",
            description: "Overwrite existing file. Default: false",
          },
        },
        required: ["path", "content"],
      },
      dangerLevel: "moderate",
      idempotent: false,
      handler: (args) => createHandler(args, ctx),
    },
    {
      name: "accordo_diagram_patch",
      group: "diagram",
      description:
        "Update an existing .mmd file with new Mermaid source and reconcile the stored layout. " +
        "Use the optional 'nodeStyles' argument to set per-node colours, fonts, fill patterns, " +
        "roughness, and size overrides. This is the ONLY correct way to style nodes — " +
        "never use Mermaid classDef directives (Accordo ignores them).",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the .mmd file to update, relative to workspace root",
          },
          content: { type: "string", description: "New Mermaid diagram source" },
          nodeStyles: {
            type: "object",
            description:
              "Optional per-node style and size overrides. Keys are node IDs. " +
              "Visual fields: backgroundColor (hex), strokeColor (hex), strokeWidth (px), " +
              "strokeStyle ('solid'|'dashed'|'dotted'), fillStyle ('hachure'|'cross-hatch'|'solid'|'zigzag'|'dots'), " +
              "opacity (0-1), roughness (0-3, 0=crisp 1=hand-drawn), " +
              "fontColor (hex), fontSize (px), fontFamily ('Excalifont'|'Nunito'|'Comic Shanns'), fontWeight ('normal'|'bold'). " +
              "Size fields: width (px), height (px) — resize the node. " +
              "Use this instead of Mermaid classDef — Accordo renders from layout styles.",
            additionalProperties: {
              type: "object",
              properties: {
                backgroundColor: { type: "string" },
                strokeColor:     { type: "string" },
                strokeWidth:     { type: "number" },
                strokeStyle:     { type: "string", enum: ["solid", "dashed", "dotted"] },
                fillStyle:       { type: "string", enum: ["hachure", "cross-hatch", "solid", "zigzag", "dots", "dashed", "zigzag-line"] },
                opacity:         { type: "number", minimum: 0, maximum: 1 },
                roughness:       { type: "number", minimum: 0, maximum: 3 },
                fontColor:       { type: "string" },
                fontSize:        { type: "number" },
                fontFamily:      { type: "string", enum: ["Excalifont", "Nunito", "Comic Shanns"] },
                fontWeight:      { type: "string", enum: ["normal", "bold"] },
                width:           { type: "number", description: "Override node width in pixels" },
                height:          { type: "number", description: "Override node height in pixels" },
                x:               { type: "number", description: "Override node X position in pixels" },
                y:               { type: "number", description: "Override node Y position in pixels" },
              },
              additionalProperties: false,
            },
          },
          clusterStyles: {
            type: "object",
            description:
              "Optional per-cluster position, size, and visual overrides. Keys are cluster/subgraph IDs. " +
              "Position fields: x, y (top-left corner in px). Size fields: width, height (in px). " +
              "Visual fields: backgroundColor (hex), strokeColor (hex), strokeWidth (px), strokeDash (bool).",
            additionalProperties: {
              type: "object",
              properties: {
                x:               { type: "number", description: "Cluster top-left X in pixels" },
                y:               { type: "number", description: "Cluster top-left Y in pixels" },
                width:           { type: "number", description: "Cluster width in pixels" },
                height:          { type: "number", description: "Cluster height in pixels" },
                backgroundColor: { type: "string" },
                strokeColor:     { type: "string" },
                strokeWidth:     { type: "number" },
                strokeDash:      { type: "boolean" },
              },
              additionalProperties: false,
            },
          },
        },
        required: ["path", "content"],
      },
      dangerLevel: "moderate",
      idempotent: false,
      handler: (args) => patchHandler(args, ctx),
    },
    {
      name: "accordo_diagram_render",
      group: "diagram",
      description:
        "Export the currently open diagram panel to SVG or PNG and write it to disk.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Path to the .mmd file that must be open in a panel, relative to workspace root",
          },
          format: {
            type: "string",
            enum: ["svg", "png"],
            description: "Output format",
          },
          output_path: {
            type: "string",
            description:
              "Destination path for the exported file. Defaults to the same directory as the .mmd file with the format as extension.",
          },
        },
        required: ["path", "format"],
      },
      dangerLevel: "moderate",
      idempotent: true,
      handler: (args) => renderHandler(args, ctx),
    },
    {
      name: "accordo_diagram_style_guide",
      group: "diagram",
      description:
        "Return the diagram style guide: colour palette, starter template, and conventions list.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => Promise.resolve(styleGuideHandler(args)),
    },
  ];
}
