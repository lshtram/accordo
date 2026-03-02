/**
 * Hub MCP Handler
 *
 * Dispatches JSON-RPC requests from MCP clients (agents).
 * Manages MCP sessions.
 *
 * Requirements: requirements-hub.md §2.1, §5.5
 */

import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";

/** Represents an active MCP session */
export interface Session {
  id: string;
  createdAt: number;
  lastActivity: number;
  initialized: boolean;
}

/** JSON-RPC 2.0 request */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class McpHandler {
  private sessions = new Map<string, Session>();

  async handleRequest(
    request: JsonRpcRequest,
    session: Session,
  ): Promise<JsonRpcResponse | null> {
    // Type-narrow here: `?? null` eliminates `undefined`, so id is never undefined
    const id: string | number | null = request.id ?? null;

    // Empty method string → Invalid request
    if (!request.method) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid request" },
      };
    }

    switch (request.method) {
      case "initialize": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: ACCORDO_PROTOCOL_VERSION,
            serverInfo: { name: "accordo-hub", version: "0.1.0" },
            capabilities: { tools: {} },
          },
        };
      }

      case "initialized": {
        // Notification — mark session initialized, no response
        const s = this.sessions.get(session.id);
        if (s) s.initialized = true;
        return null;
      }

      case "tools/list": {
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: [] },
        };
      }

      // tools/call is wired in Week 2 (requires BridgeServer connection)

      case "ping": {
        return {
          jsonrpc: "2.0",
          id,
          result: {},
        };
      }

      default: {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        };
      }
    }
  }

  createSession(): Session {
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      createdAt: now,
      lastActivity: now,
      initialized: false,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): Session | undefined {
    if (!id) return undefined;
    return this.sessions.get(id);
  }
}

