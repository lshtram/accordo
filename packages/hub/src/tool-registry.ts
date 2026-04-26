/**
 * Hub Tool Registry
 *
 * Runtime registry for tools from two sources:
 * 1. **Bridge tools** — registered by extensions via WebSocket. Replaced in
 *    bulk when Bridge sends a toolRegistry message.
 * 2. **Hub-native tools** — registered once at startup.
 *    Survive Bridge registry updates. Use `registerHubTool()`.
 *
 * Both pools are merged in `list()`, `get()`, and `toMcpTools()`.
 * Hub-native tools take precedence if a name collision occurs.
 *
 * Requirements: requirements-hub.md §5.1
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

  private toAliasName(name: string): string | null {
    if (!name.startsWith("comment_")) {
      return null;
    }

    return `accordo_${name}`;
  }

  private fromAliasName(name: string): string | null {
    if (!name.startsWith("accordo_comment_")) {
      return null;
    }

    return name.slice("accordo_".length);
  }

  private aliasTool(tool: ToolRegistration): ToolRegistration | null {
    const aliasName = this.toAliasName(tool.name);
    if (aliasName === null) {
      return null;
    }

    return {
      ...tool,
      name: aliasName,
    };
  }

  private withAliases(tools: ToolRegistration[]): ToolRegistration[] {
    const expanded = [...tools];
    for (const tool of tools) {
      const alias = this.aliasTool(tool);
      if (alias !== null) {
        expanded.push(alias);
      }
    }
    return expanded;
  }

  /**
   * Look up a single tool by its fully qualified name.
   * Hub-native tools take precedence over Bridge tools.
   *
   * Supports both canonical names (e.g. "comment_list") and the
   * legacy alias form (e.g. "accordo_comment_list").
   *
   * @param name - Tool name, e.g. "comment_list" or "accordo_comment_list"
   * @returns The tool registration, or undefined if not found
   */
  get(name: string): ToolRegistration | undefined {
    const direct = this.hubTools.get(name) ?? this.bridgeTools.get(name);
    if (direct !== undefined) {
      return direct;
    }

    const canonicalName = this.fromAliasName(name);
    if (canonicalName === null) {
      return undefined;
    }

    return this.hubTools.get(canonicalName) ?? this.bridgeTools.get(canonicalName);
  }

  /**
   * Return all registered tools (Hub-native + Bridge), using canonical names.
   *
   * Aliases (e.g. "accordo_comment_*") are NOT included in the returned list —
   * they exist only for backward-compatible tools/call resolution via get().
   * list() and toMcpTools() expose only the canonical names.
   *
   * Merge semantics:
   * - Bridge tools are loaded first.
   * - Hub-native tools overwrite same-name Bridge tools on collision.
   */
  list(): ToolRegistration[] {
    const merged = new Map<string, ToolRegistration>();
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
