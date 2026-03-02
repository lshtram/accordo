/**
 * Typed error classes for the Hub.
 *
 * Prefer these over `Object.assign(new Error(...), { code })` so callers
 * can use `instanceof` checks and get type-safe error codes.
 */

/**
 * JSON-RPC 2.0 error with a numeric code.
 * Standard codes: -32600 Invalid request, -32601 Method not found,
 *                 -32602 Invalid params, -32603 Internal error.
 * Accordo extension codes: -32004 Queue full.
 */
export class JsonRpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}
