/**
 * accordo-drawing extension entry point.
 *
 * Stub — throws "not implemented" for all handlers.
 *
 * Phase B: this is the stub that will fail all runtime boundary tests
 * until proper tool registration is wired.
 *
 * Source: AGENTS.md §3 rule 3 (MCP tool naming convention)
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";

export function activate(_context: vscode.ExtensionContext): void {
  // Stub: no tools registered yet
  throw new Error("not implemented");
}

export function deactivate(): void {
  // Stub
}
