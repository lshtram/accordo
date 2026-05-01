/**
 * Editor tool definitions — stub file for Phase B testing.
 * Exports editorTools array with all 11 tool definitions.
 *
 * Extracted from: editor.ts (Module 16 + Module 17)
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import {
  openHandler,
  markdownSetSurfaceHandler,
  closeHandler,
  focusGroupHandler,
  highlightHandler,
  clearHighlightsHandler,
} from "./editor-handlers.js";
import { wrapHandler } from "../util.js";

const ACCORDO_SKILL = " Read accordo://skills/accordo for editor and layout workflows.";

/** All editor tool definitions for modules 16 and 17. */
export const editorTools: ExtensionToolDefinition[] = [
  {
    name: "accordo_editor_open",
    group: "editor",
    description: "Open a file in the editor, optionally scrolling to a line/column." + ACCORDO_SKILL,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, relative to workspace root or absolute" },
        line: { type: "number", description: "Line number to scroll to (1-based). Default: 1" },
        column: { type: "number", description: "Column number to place cursor (1-based). Default: 1" },
      },
      required: ["path"],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_editor_open", openHandler),
  },
  {
    name: "accordo_editor_close",
    group: "editor",
    description: "Close a specific editor tab (text or webview), or the active editor if no path given. For .mmd diagram files, falls back to closing the active tab if the file is not found in open tabs." + ACCORDO_SKILL,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to close. If omitted, closes the active editor." },
      },
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_editor_close", closeHandler),
  },
  {
    name: "accordo_markdown_setSurface",
    group: "editor",
    description: "Open a Markdown file in a deterministic target surface: text editor or Accordo Markdown Preview." + ACCORDO_SKILL,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Markdown file path, relative to workspace root or absolute" },
        surface: { type: "string", enum: ["text", "preview"], description: "Target Markdown surface to open" },
        line: { type: "number", description: "Line number to reveal (1-based). Default: 1" },
        column: { type: "number", description: "Column number for text editor placement (1-based). Default: 1" },
      },
      required: ["path", "surface"],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_markdown_setSurface", markdownSetSurfaceHandler),
  },
  {
    name: "accordo_editor_focus",
    group: "editor",
    description: "Focus a specific editor group by 1-based group number." + ACCORDO_SKILL,
    inputSchema: {
      type: "object",
      properties: {
        group: { type: "number", description: "Editor group number (1-based)" },
      },
      required: ["group"],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_editor_focus", focusGroupHandler),
  },
  {
    name: "accordo_editor_highlight",
    group: "editor",
    description: "Apply a colored background highlight to a range of lines in a text editor or an already-open Accordo Markdown Preview. Markdown preview highlights are block-granular and this tool does not auto-open previews." + ACCORDO_SKILL,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path containing the lines to highlight" },
        startLine: { type: "number", description: "First line to highlight (1-based, inclusive)" },
        endLine: { type: "number", description: "Last line to highlight (1-based, inclusive)" },
        color: { type: "string", description: "Highlight background color. Default: rgba(255,255,0,0.3)" },
      },
      required: ["path", "startLine", "endLine"],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_editor_highlight", highlightHandler),
  },
  {
    name: "accordo_editor_clearHighlights",
    group: "editor",
    description: "Remove highlight decorations created by accordo_editor_highlight across text editor and Accordo Markdown Preview surfaces." + ACCORDO_SKILL,
    inputSchema: {
      type: "object",
      properties: {
        decorationId: { type: "string", description: "Clear only this decoration. Omit to clear all." },
      },
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_editor_clearHighlights", clearHighlightsHandler),
  },
];
