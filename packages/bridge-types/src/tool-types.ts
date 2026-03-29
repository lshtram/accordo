/**
 * Tool registration and schema types.
 *
 * Sources:
 *   - requirements-hub.md §3.4 (ToolRegistration)
 *   - requirements-bridge.md §3.1 (ExtensionToolDefinition)
 *   - requirements-bridge.md §3.2 (wire-format registration)
 */

// ─── Tool Definition ────────────────────────────────────────────────────────

/**
 * Tool definition as provided by extensions calling BridgeAPI.registerTools().
 * Includes the handler function, which is NEVER sent over the wire — it stays
 * in the extension host.
 *
 * Source: requirements-bridge.md §3.1, requirements-editor.md §4
 */
export interface ExtensionToolDefinition {
  /** Fully qualified tool name. Convention: "accordo_<category>_<action>" */
  name: string;
  /** One-line description. Appears in system prompt. Max 120 chars. */
  description: string;
  /** JSON Schema describing the input. Must be type: "object". */
  inputSchema: ToolInputSchema;
  /** How dangerous is this tool? Drives confirmation policy. */
  dangerLevel: DangerLevel;
  /** Whether to show confirmation dialog. Defaults by dangerLevel. */
  requiresConfirmation?: boolean;
  /** Whether this tool is safe to retry on timeout. Default: false */
  idempotent?: boolean;
  /**
   * Optional grouping key (e.g. "editor", "terminal", "voice").
   * Metadata only — all tools appear in MCP `tools/list` and the system prompt
   * regardless of whether `group` is set. The field is stripped from the MCP
   * wire format by Hub but forwarded in the Bridge → Hub registration payload.
   * Use it for categorisation / filtering in UI; it has no effect on tool visibility.
   */
  group?: string;
  /**
   * The actual handler function. Runs in the extension host.
   * NEVER serialized. NEVER sent to Hub.
   */
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

// ─── Tool Registration ──────────────────────────────────────────────────────

/** Tool danger classification. Drives confirmation policy. */
export type DangerLevel = "safe" | "moderate" | "destructive";

/**
 * Wire-format tool registration sent from Bridge to Hub.
 * This is the **flat** data-only shape — handler is NEVER included.
 * Handler stays in the extension host (Bridge); only this type crosses
 * the WebSocket boundary.
 *
 * Source: requirements-hub.md §3.4, requirements-bridge.md §3.2
 * Rule:  AGENTS.md §4.3 — "Only ToolRegistration (data) crosses the
 *        package boundary — never ExtensionToolDefinition (function)."
 */
export interface ToolRegistration {
  /** Fully qualified tool name. Convention: "accordo_<category>_<action>" */
  name: string;
  /** One-line description. Appears in system prompt. Max 120 chars. */
  description: string;
  /** JSON Schema describing the input. Must be type: "object". */
  inputSchema: ToolInputSchema;
  /** How dangerous is this tool? Drives confirmation policy. */
  dangerLevel: DangerLevel;
  /** Whether to show a confirmation dialog before execution */
  requiresConfirmation: boolean;
  /** Whether this tool is safe to retry on timeout. Default: false */
  idempotent: boolean;
  /**
   * Optional grouping key (e.g. "editor", "terminal", "voice").
   * Metadata only — stripped from MCP wire output by Hub but present in
   * the Bridge → Hub registration payload. No effect on tool visibility.
   */
  group?: string;
}

/**
 * JSON Schema for tool input. Always an object at the top level.
 */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
}

export interface ToolPropertySchema {
  type?: string;
  description?: string;
  enum?: string[];
  const?: unknown;
  default?: unknown;
  /** Nested property definitions for type:'object' properties */
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
  additionalProperties?: boolean | ToolPropertySchema;
  /** For type:'array' */
  items?: ToolPropertySchema | { oneOf: ToolPropertySchema[] };
  minItems?: number;
  maxItems?: number;
  /** Numeric range constraints */
  minimum?: number;
  maximum?: number;
  /** Discriminated union */
  oneOf?: ToolPropertySchema[];
}

/**
 * MCP-formatted tool for the tools/list response.
 * Subset of ToolRegistration — only what MCP clients need.
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}
