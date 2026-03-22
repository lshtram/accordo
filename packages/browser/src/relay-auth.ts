import { randomUUID } from "node:crypto";

export function generateRelayToken(): string {
  return randomUUID();
}

export function isAuthorizedToken(candidate: string | null | undefined, expected: string): boolean {
  return typeof candidate === "string" && candidate.length > 0 && candidate === expected;
}
