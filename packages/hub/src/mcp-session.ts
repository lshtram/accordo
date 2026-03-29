/**
 * MCP Session Registry
 *
 * MCP session state: session registry and session lifecycle.
 * Extracted from mcp-handler.ts to keep each module focused.
 *
 * Requirements: requirements-hub.md §2.1
 */

import type { McpDebugLogger } from "./debug-log.js";

/** Represents an active MCP session */
export interface Session {
  id: string;
  createdAt: number;
  lastActivity: number;
  initialized: boolean;
}

/** Dependencies for McpSessionRegistry */
export interface McpSessionRegistryDeps {
  debugLogger?: McpDebugLogger;
}

/**
 * Manages MCP session lifecycle: create, look up, and store sessions.
 */
export class McpSessionRegistry {
  private readonly sessions = new Map<string, Session>();
  private readonly debugLogger: McpDebugLogger | undefined;

  constructor(deps: McpSessionRegistryDeps = {}) {
    this.debugLogger = deps.debugLogger;
  }

  /**
   * Create a new MCP session. Called on each `initialize` request.
   *
   * @returns A new Session with a unique UUID
   */
  createSession(agentHint?: string): Session {
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      createdAt: now,
      lastActivity: now,
      initialized: false,
    };
    this.sessions.set(session.id, session);
    this.debugLogger?.logSessionCreated(session.id, agentHint);
    return session;
  }

  /**
   * Look up an existing session by its Mcp-Session-Id.
   *
   * @param id - Session ID string
   * @returns The session, or undefined if not found
   */
  getSession(id: string): Session | undefined {
    if (!id) return undefined;
    return this.sessions.get(id);
  }

  /**
   * Mark an existing session as initialized (called on "initialized" notification).
   */
  markInitialized(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.initialized = true;
  }
}
