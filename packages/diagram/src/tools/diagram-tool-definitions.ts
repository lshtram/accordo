/**
 * A14 — MCP tool definitions for the diagram package.
 *
 * The six ExtensionToolDefinition schema objects for the accordo_diagram_*
 * MCP tools. Each definition holds name, description, inputSchema,
 * dangerLevel, idempotent, and a handler that references the imported
 * handler functions from diagram-tool-handlers.ts.
 *
 * Public API
 * ──────────
 *   createDiagramTools(ctx) → ExtensionToolDefinition[]  (used by extension entry)
 *
 * Source: diag_workplan.md §4.14, diag_arch_v4.2.md §6
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import {
  listHandler,
  getHandler,
  createHandler,
  patchHandler,
  renderHandler,
  styleGuideHandler,
} from "./diagram-tool-handlers.js";
import type { DiagramToolContext } from "./diagram-tool-handlers.js";

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
        "roughness, and size overrides. Use 'edgeStyles' to set per-edge stroke colour, width, " +
        "style, and routing. This is the ONLY correct way to style nodes and edges — " +
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
          edgeStyles: {
            type: "object",
            description:
              "Optional per-edge style overrides. Keys are edge keys in 'source->target:index' format " +
              "(e.g. 'A->B:0'). Visual fields: strokeColor (hex), strokeWidth (px), " +
              "strokeStyle ('solid'|'dashed'|'dotted'), strokeDash (bool). " +
              "Routing field: routing ('auto'|'orthogonal'|'direct'|'curved'). " +
              "Note: waypoints is intentionally excluded — deferred to D-04.",
            additionalProperties: {
              type: "object",
              properties: {
                strokeColor:  { type: "string" },
                strokeWidth:  { type: "number" },
                strokeStyle:  { type: "string", enum: ["solid", "dashed", "dotted"] },
                strokeDash:   { type: "boolean" },
                routing:      { type: "string", enum: ["auto", "orthogonal", "direct", "curved"] },
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
