/**
 * Editor tool definitions — stub file for Phase B testing.
 * Exports editorTools array with all 11 tool definitions.
 *
 * Extracted from: editor.ts (Module 16 + Module 17)
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import {
  openHandler,
  closeHandler,
  scrollHandler,
  splitHandler,
  focusGroupHandler,
  revealHandler,
  highlightHandler,
  clearHighlightsHandler,
  saveHandler,
  saveAllHandler,
  formatHandler,
} from "./editor-handlers.js";
import { wrapHandler } from "../util.js";

/** All editor tool definitions for modules 16 and 17. */
export const editorTools: ExtensionToolDefinition[] = [
  {
    name: "accordo_editor_open",
    group: "editor",
    description: "Open a file in the editor, optionally scrolling to a line/column.",
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
    description: "Close a specific editor tab (text or webview), or the active editor if no path given. For .mmd diagram files, falls back to closing the active tab if the file is not found in open tabs.",
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
    name: "accordo_editor_scroll",
    group: "editor",
    description: "Scroll the active editor viewport up or down by line or page.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
        by: { type: "string", enum: ["line", "page"], description: "Scroll unit. Default: page" },
      },
      required: ["direction"],
    },
    dangerLevel: "safe",
    idempotent: false,
    handler: wrapHandler("accordo_editor_scroll", scrollHandler),
  },
  {
    name: "accordo_editor_split",
    group: "editor",
    description: "Split the editor pane right or down.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["right", "down"], description: "Direction to split" },
      },
      required: ["direction"],
    },
    dangerLevel: "safe",
    idempotent: false,
    handler: wrapHandler("accordo_editor_split", splitHandler),
  },
  {
    name: "accordo_editor_focus",
    group: "editor",
    description: "Focus a specific editor group by 1-based group number.",
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
    name: "accordo_editor_reveal",
    group: "editor",
    description: "Reveal a file in the Explorer sidebar without opening it.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to reveal in Explorer" },
      },
      required: ["path"],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_editor_reveal", revealHandler),
  },
  {
    name: "accordo_editor_highlight",
    group: "editor",
    description: "Apply a colored background highlight to a range of lines.",
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
    description: "Remove highlight decorations created by accordo_editor_highlight.",
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
  {
    name: "accordo_editor_save",
    group: "editor",
    description: "Save a specific file, or the active editor if no path given.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to save. If omitted, saves the active editor." },
      },
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_editor_save", saveHandler),
  },
  {
    name: "accordo_editor_saveAll",
    group: "editor",
    description: "Save all modified (unsaved) editors.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_editor_saveAll", saveAllHandler),
  },
  {
    name: "accordo_editor_format",
    group: "editor",
    description: "Format the active document or a specific file using the configured formatter.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to format. If omitted, formats the active editor." },
      },
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_editor_format", formatHandler),
  },
];
