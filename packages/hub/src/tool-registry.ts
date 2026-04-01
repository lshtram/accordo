/**
 * Hub Tool Registry
 *
 * Runtime registry for tools from two sources:
 * 1. **Bridge tools** — registered by extensions via WebSocket. Replaced in
 *    bulk when Bridge sends a toolRegistry message.
 * 2. **Hub-native tools** — registered once at startup (e.g. script tools).
 *    Survive Bridge registry updates. Use `registerHubTool()`.
 *
 * Both pools are merged in `list()`, `get()`, and `toMcpTools()`.
 * Hub-native tools take precedence if a name collision occurs (should not
 * happen in practice — Hub tools use the `accordo_script_*` namespace).
 *
 * Requirements: requirements-hub.md §5.1
 * DEC-005 — Hub-native tool local handler pattern
 */

import type { ToolRegistration, McpTool } from "@accordo/bridge-types";
import type { HubToolRegistration } from "./hub-tool-types.js";

export class ToolRegistry {
  /** Tools registered by Bridge extensions — replaced in bulk. */
  private bridgeTools: Map<string, ToolRegistration> = new Map();

  /** Tools that live in the Hub process — persist across Bridge updates. */
  private hubTools: Map<string, HubToolRegistration> = new Map();

  /**
   * Replace all Bridge-registered tools with the provided list.
   * Hub-native tools are NOT affected.
   * Called when Bridge sends a toolRegistry message.
   *
   * @param tools - Complete list of Bridge tools (replaces previous Bridge tools)
   */
  register(tools: ToolRegistration[]): void {
    this.bridgeTools.clear();
    for (const tool of tools) {
      this.bridgeTools.set(tool.name, tool);
    }
  }

  /**
   * Register a single Hub-native tool.
   * Hub-native tools persist across Bridge registry updates.
   * Replaces any existing Hub tool with the same name.
   *
   * @param tool - A HubToolRegistration with a localHandler
   */
  registerHubTool(tool: HubToolRegistration): void {
    this.hubTools.set(tool.name, tool);
  }

  /**
   * Look up a single tool by its fully qualified name.
   * Hub-native tools take precedence over Bridge tools.
   *
   * @param name - Tool name, e.g. "accordo_editor_open"
   * @returns The tool registration, or undefined if not found
   */
  get(name: string): ToolRegistration | undefined {
    return this.hubTools.get(name) ?? this.bridgeTools.get(name);
  }

  /**
   * Return all registered tools (Hub-native + Bridge).
   * Hub-native tools appear first.
   */
  list(): ToolRegistration[] {
    const merged = new Map<string, ToolRegistration>();
    // Bridge tools first, then Hub tools overwrite on collision
    for (const [name, tool] of this.bridgeTools) {
      merged.set(name, tool);
    }
    for (const [name, tool] of this.hubTools) {
      merged.set(name, tool);
    }
    return Array.from(merged.values());
  }

  /**
   * Convert the registry to MCP tools/list response format.
   * Only includes name, description, and inputSchema.
   * Internal fields (dangerLevel, group, localHandler, etc.) are stripped.
   */
  toMcpTools(): McpTool[] {
    return this.list().map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  /**
   * Return the number of registered tools (Hub-native + Bridge, deduplicated).
   */
  get size(): number {
    const names = new Set<string>();
    for (const name of this.bridgeTools.keys()) names.add(name);
    for (const name of this.hubTools.keys()) names.add(name);
    return names.size;
  }
}
