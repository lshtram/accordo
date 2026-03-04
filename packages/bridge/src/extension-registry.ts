/**
 * Bridge Extension Registry
 *
 * Manages tool registrations from multiple VSCode extensions.
 * Maintains a handler map and sends debounced toolRegistry messages to Hub.
 *
 * Requirements: requirements-bridge.md §7 (REG-01 to REG-06)
 */

import type { ToolRegistration, ExtensionToolDefinition } from "@accordo/bridge-types";
export type { ExtensionToolDefinition };

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A disposable that unregisters tools when disposed.
 * Matches the essential subset of vscode.Disposable.
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Callback for sending toolRegistry messages to Hub via WsClient.
 */
export type SendToolRegistryFn = (tools: ToolRegistration[]) => void;

// ── ExtensionRegistry ────────────────────────────────────────────────────────

/**
 * Manages tool registrations from multiple extensions.
 *
 * REG-01: Supports multiple extensions registering tools concurrently.
 * REG-02: Tool names must be globally unique. Duplicate → throw.
 * REG-03: 100ms debounce on toolRegistry sends after register/unregister.
 * REG-04: Handler map keyed by tool name → handler function.
 * REG-05: dispose() removes that extension's tools.
 * REG-06: Validates inputSchema has type: "object" on registration.
 */
export class ExtensionRegistry {
  /** tools by name — wire-format registration (no handler) */
  private tools = new Map<string, ToolRegistration>();
  /** handlers by tool name */
  private handlers = new Map<string, ExtensionToolDefinition["handler"]>();
  /** tracks which extension owns which tool names */
  private extensionTools = new Map<string, string[]>();
  /** debounce timer for sending registry updates */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** callback to send registry to Hub */
  private sendFn: SendToolRegistryFn | null = null;

  /**
   * Set the function used to send toolRegistry messages to Hub.
   * Called by WsClient setup.
   *
   * @param fn - Function that sends tools to Hub over WS
   */
  setSendFunction(fn: SendToolRegistryFn): void {
    this.sendFn = fn;
  }

  /**
   * REG-01 + REG-02 + REG-06: Register tools from an extension.
   *
   * @param extensionId - Reverse-domain extension ID
   * @param tools - Array of tool definitions including handlers
   * @returns Disposable that unregisters these tools on dispose()
   * @throws Error if any tool name is duplicate or inputSchema invalid
   */
  registerTools(
    extensionId: string,
    tools: ExtensionToolDefinition[],
  ): Disposable {
    // REG-06: validate inputSchema
    for (const tool of tools) {
      if (!tool.inputSchema || tool.inputSchema.type !== "object") {
        throw new Error(
          `Tool "${tool.name}" inputSchema must have type: object`,
        );
      }
    }

    // REG-02: check duplicates within this batch and against existing registry
    const newNames = tools.map((t) => t.name);
    for (let i = 0; i < newNames.length; i++) {
      if (newNames.indexOf(newNames[i]) !== i) {
        throw new Error(`Duplicate tool name: ${newNames[i]}`);
      }
      if (this.tools.has(newNames[i])) {
        throw new Error(`Duplicate tool name: ${newNames[i]}`);
      }
    }

    // REG-01 + REG-04: store wire-format registration and handler separately
    const toolNames: string[] = [];
    for (const tool of tools) {
      const { handler, ...rest } = tool;
      const wireReg: ToolRegistration = {
        name: rest.name,
        description: rest.description,
        inputSchema: rest.inputSchema,
        dangerLevel: rest.dangerLevel,
        requiresConfirmation: rest.requiresConfirmation ?? false,
        idempotent: rest.idempotent ?? false,
        ...(rest.group !== undefined && { group: rest.group }),
      };
      this.tools.set(tool.name, wireReg);
      this.handlers.set(tool.name, handler);
      toolNames.push(tool.name);
    }

    // Track ownership for dispose
    const existing = this.extensionTools.get(extensionId) ?? [];
    this.extensionTools.set(extensionId, [...existing, ...toolNames]);

    // REG-03: schedule debounced send
    this.scheduleRegistrySend();

    // REG-05: return disposable
    return {
      dispose: () => {
        for (const name of toolNames) {
          this.tools.delete(name);
          this.handlers.delete(name);
        }
        const extTools = this.extensionTools.get(extensionId) ?? [];
        this.extensionTools.set(
          extensionId,
          extTools.filter((n) => !toolNames.includes(n)),
        );
        this.scheduleRegistrySend();
      },
    };
  }

  /**
   * Look up a handler by tool name.
   * Used by CommandRouter to dispatch invoke messages.
   *
   * @param toolName - Fully qualified tool name
   * @returns The handler function, or undefined if not found
   */
  getHandler(
    toolName: string,
  ): ((args: Record<string, unknown>) => Promise<unknown>) | undefined {
    return this.handlers.get(toolName);
  }

  /**
   * Look up a tool registration by name.
   *
   * @param toolName - Fully qualified tool name
   * @returns Wire-format tool registration, or undefined
   */
  getTool(toolName: string): ToolRegistration | undefined {
    return this.tools.get(toolName);
  }

  /**
   * Get all registered tools in wire format (no handlers).
   */
  getAllTools(): ToolRegistration[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get the total number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * REG-03: Schedule a debounced registry send.
   * Resets timer on each call — coalesces rapid registrations.
   */
  private scheduleRegistrySend(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.sendFn) {
        this.sendFn(this.getAllTools());
      }
    }, 100);
  }

  /**
   * Remove all tools and cancel pending sends.
   * Used during shutdown.
   */
  dispose(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.tools.clear();
    this.handlers.clear();
    this.extensionTools.clear();
  }
}
