/**
 * Workspace tool handlers for accordo-editor.
 *
 * Implements the following tools from requirements-editor.md §4:
 *   Module 19: §4.12 workspace.getTree, §4.13 workspace.search,
 *              §4.20 diagnostics.list
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";

// ── §4.12 accordo.workspace.getTree ──────────────────────────────────────────

export interface TreeNode {
  name: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

export async function workspaceGetTreeHandler(
  args: Record<string, unknown>,
): Promise<{ tree: TreeNode[] }> {
  throw new Error("not implemented");
}

// ── §4.13 accordo.workspace.search ───────────────────────────────────────────

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export async function workspaceSearchHandler(
  args: Record<string, unknown>,
): Promise<{ results: SearchMatch[] }> {
  throw new Error("not implemented");
}

// ── §4.20 accordo.diagnostics.list ───────────────────────────────────────────

export interface DiagnosticItem {
  path: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "information" | "hint";
  message: string;
  source?: string;
  code?: string;
}

export async function diagnosticsListHandler(
  args: Record<string, unknown>,
): Promise<{ diagnostics: DiagnosticItem[] }> {
  throw new Error("not implemented");
}

// ── Tool definitions (Module 19) ─────────────────────────────────────────────

/** All workspace + diagnostics tool definitions for module 19. */
export const workspaceTools: ExtensionToolDefinition[] = [
  {
    name: "accordo.workspace.getTree",
    description: "Return the workspace file tree as a structured object. Respects .gitignore and files.exclude.",
    inputSchema: {
      type: "object",
      properties: {
        depth: { type: "number", description: "Max directory depth to traverse. Default: 3" },
        path: { type: "string", description: "Subdirectory to start from. Default: workspace root" },
      },
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: workspaceGetTreeHandler,
  },
  {
    name: "accordo.workspace.search",
    description: "Full-text search across workspace files. Returns matching lines with file path and location.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text or regex pattern" },
        include: { type: "string", description: "Glob pattern for files to include. Default: '**/*'" },
        maxResults: { type: "number", description: "Maximum results to return. Default: 50" },
      },
      required: ["query"],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: workspaceSearchHandler,
  },
  {
    name: "accordo.diagnostics.list",
    description: "Return current diagnostics (errors, warnings, hints) from the Language Server.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Limit diagnostics to this file. If omitted, returns all." },
        severity: { type: "string", enum: ["error", "warning", "information", "hint"], description: "Filter by minimum severity. Default: all." },
      },
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: diagnosticsListHandler,
  },
];
