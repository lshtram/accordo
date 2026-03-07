/**
 * Hub Tool Registry
 *
 * Runtime registry for tools registered by Bridge extensions.
 * No hardcoded tools — all tools come from Bridge via WebSocket.
 *
 * Requirements: requirements-hub.md §5.1
 */

import type { ToolRegistration, McpTool } from "@accordo/bridge-types";

export class ToolRegistry {
  private tools: Map<string, ToolRegistration> = new Map();

  /**
   * Replace the entire registry with the provided tool list.
   * Called when Bridge sends a toolRegistry message.
   *
   * @param tools - Complete list of tools (replaces previous)
   */
  register(tools: ToolRegistration[]): void {
    this.tools.clear();
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Look up a single tool by its fully qualified name.
   *
   * @param name - Tool name, e.g. "accordo_editor_open"
   * @returns The tool registration, or undefined if not found
   */
  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name);
  }

  /**
   * Return all registered tools.
   */
  list(): ToolRegistration[] {
    return Array.from(this.tools.values());
  }

  /**
   * Convert the registry to MCP tools/list response format.
   * Only includes name, description, and inputSchema.
   * Internal fields (dangerLevel, group, etc.) are stripped.
   */
  toMcpTools(): McpTool[] {
    return this.list().map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  /**
   * Return the number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }
}
