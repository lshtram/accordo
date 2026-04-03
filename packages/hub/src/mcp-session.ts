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
  /** Agent hint string (e.g. "copilot", "opencode", "claude") — MS-01 */
  agentHint?: string | null;
  /** Human-readable label for the session — MS-01 */
  label?: string | null;
  /** Group identifier for the session — MS-01 */
  group?: string | null;
  /** Arbitrary key-value metadata — MS-01 */
  metadata?: Record<string, string>;
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
   * @param agentHint - Optional agent hint (e.g. "copilot", "opencode")
   * @param label - Optional human-readable label
   * @param group - Optional group identifier
   * @param metadata - Optional key-value metadata
   * @returns A new Session with a unique UUID
   */
  createSession(
    agentHint?: string,
    label?: string,
    group?: string,
    metadata?: Record<string, string>,
  ): Session {
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      createdAt: now,
      lastActivity: now,
      initialized: false,
      agentHint: agentHint ?? null,
      label: label ?? null,
      group: group ?? null,
      metadata: metadata ?? {},
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

  /**
   * Touch a session to update its lastActivity timestamp.
   * Returns the updated session, or undefined if not found.
   *
   * @param id - Session ID
   * @returns The updated session, or undefined
   */
  touchSession(id: string): Session | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.lastActivity = Date.now();
    return s;
  }

  /**
   * Return active (non-expired) sessions, reaping stale ones as a side effect.
   *
   * @param sessionTTLMs - TTL in milliseconds (default: 24 hours)
   * @returns Array of active sessions
   */
  getActiveSessions(sessionTTLMs = 86_400_000): Session[] {
    const now = Date.now();
    // Reap stale sessions as a side effect
    for (const [id, s] of this.sessions) {
      if (now - s.lastActivity > sessionTTLMs) {
        this.sessions.delete(id);
      }
    }
    return Array.from(this.sessions.values());
  }

  /**
   * Return sessions that have been idle beyond the given timeout.
   *
   * @param idleTimeoutMs - Idle timeout in milliseconds
   * @returns Array of idle sessions
   */
  getIdleSessions(idleTimeoutMs: number): Session[] {
    const now = Date.now();
    return Array.from(this.sessions.values()).filter(
      (s) => now - s.lastActivity > idleTimeoutMs,
    );
  }

  /**
   * Remove all sessions that have been inactive beyond the TTL.
   *
   * @param sessionTTLMs - TTL in milliseconds
   * @returns Number of sessions reaped
   */
  reapStaleSessions(sessionTTLMs: number): number {
    const now = Date.now();
    let count = 0;
    for (const [id, s] of this.sessions) {
      if (now - s.lastActivity > sessionTTLMs) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }
}
