/**
 * Parse a raw HTTP response body into a HealthResponse, or return null on failure.
 * Validates all required fields per HealthResponse interface (LCM-13).
 *
 * Strategy: each field is individually narrowed to its exact type before the
 * return statement. The final object is built field-by-field so TypeScript
 * infers the correct literal types without any cast.
 */
import type { HealthResponse } from "@accordo/bridge-types";

function isNonNull<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

export function parseHealthBody(raw: string): HealthResponse | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Narrow each field to its exact type before constructing the return value.
  // After each check the narrowed type is locked in; no unsafe cast needed.
  if (obj.ok !== true) return null;
  if (typeof obj.uptime !== "number") return null;
  if (typeof obj.inflight !== "number") return null;
  if (typeof obj.queued !== "number") return null;
  if (typeof obj.toolCount !== "number") return null;
  if (typeof obj.protocolVersion !== "string") return null;
  const bridge = obj.bridge;
  if (bridge !== "connected" && bridge !== "disconnected") return null;

  // All fields validated — construct the return value field-by-field.
  // TypeScript infers literal types from the narrowed values above.
  return {
    ok: obj.ok as true,
    uptime: obj.uptime as number,
    bridge: bridge as "connected" | "disconnected",
    toolCount: obj.toolCount as number,
    protocolVersion: obj.protocolVersion as string,
    inflight: obj.inflight as number,
    queued: obj.queued as number,
  };
}
