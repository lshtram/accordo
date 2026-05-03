/**
 * DRW-B04, DRW-B05, DRW-B06 — MCP tool definitions for accordo-drawing.
 *
 * Returns the 5 accordo_drawing_* tools.
 *
 * Source: docs/20-requirements/requirements-drawing.md §6 (DRW-R17..R21)
 */

import type { DrawingToolContext } from "../core/types.js";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { createDrawing } from "../host/create-handler.js";
import { mergeDrawing } from "../host/merge-handler.js";
import { queryDrawing } from "../host/query-handler.js";
import { patchDrawing } from "../host/patch-handler.js";
import { renderDrawing } from "../host/render-handler.js";

/**
 * DRW-B04: createDrawingTools returns accordo_drawing_* names only.
 */
export function createDrawingTools(
  ctx: DrawingToolContext
): ExtensionToolDefinition[] {
  return [
    {
      name: "accordo_drawing_create",
      description:
        "Create a new flowchart drawing. Writes both .mmd and sibling .excalidraw file. " +
        "Validates that the Mermaid content is a flowchart diagram (flowchart TD/TB/BT/LR/RL). " +
        "The .mmd stores topology; .excalidraw stores positions and customData.accordo identity. " +
        "Bootstrap engine: 'mermaid-to-excalidraw' when creating from content, 'empty' for bare creation.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the .mmd file (must end with .mmd)",
          },
          content: {
            type: "string",
            description: "Mermaid flowchart source content",
          },
          force: {
            type: "boolean",
            description: "Overwrite if file already exists",
          },
          open: {
            type: "boolean",
            description: "Open the drawing panel after creation",
          },
        },
        required: ["path", "content"],
      },
      handler: (input: unknown) => createDrawing(input as Parameters<typeof createDrawing>[0], ctx),
    },
    {
      name: "accordo_drawing_merge",
      description:
        "Merge updated Mermaid source into an existing drawing pair. " +
        "Reads both .mmd and .excalidraw, computes a merge plan (preserve/update/remove/orphan), " +
        "applies Accordo placement for new nodes added to existing scenes. " +
        "Returns counts for each merge category.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the .mmd file",
          },
          content: {
            type: "string",
            description: "Updated Mermaid source (optional — file is read if omitted)",
          },
          open: {
            type: "boolean",
            description: "Open the drawing panel after merge",
          },
        },
        required: ["path"],
      },
      handler: (input: unknown) => mergeDrawing(input as Parameters<typeof mergeDrawing>[0], ctx),
    },
    {
      name: "accordo_drawing_query",
      description:
        "Query a drawing pair for sync status, element counts, and orphan details. " +
        "Non-mutating — safe to call multiple times. " +
        "Returns in-sync / needs-merge / source-invalid / scene-invalid status.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the .mmd file",
          },
          includeOrphans: {
            type: "boolean",
            description: "Include orphan details in response",
          },
          includeElements: {
            type: "boolean",
            description: "Include full element list",
          },
        },
        required: ["path"],
      },
      handler: (input: unknown) => queryDrawing(input as Parameters<typeof queryDrawing>[0], ctx),
    },
    {
      name: "accordo_drawing_patch",
      description:
        "Patch an existing drawing by replacing the .mmd source and re-merging. " +
        "Equivalent to calling merge with new content. " +
        "Returns patched: true and merge counts.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the .mmd file",
          },
          content: {
            type: "string",
            description: "New Mermaid source content",
          },
        },
        required: ["path", "content"],
      },
      handler: (input: unknown) => patchDrawing(input as Parameters<typeof patchDrawing>[0], ctx),
    },
    {
      name: "accordo_drawing_render",
      description:
        "Render a drawing to PNG or SVG. Requires the drawing panel to be open. " +
        "Uses the panel's requestExport method to capture the current view.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the .mmd file",
          },
          format: {
            type: "string",
            enum: ["png", "svg"],
            description: "Output format",
          },
          outputPath: {
            type: "string",
            description: "Optional output file path",
          },
        },
        required: ["path", "format"],
      },
      handler: (input: unknown) => renderDrawing(input as Parameters<typeof renderDrawing>[0], ctx),
    },
  ];
}