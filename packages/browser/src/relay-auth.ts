import { randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Generate a cryptographically random relay token.
 *
 * Uses `crypto.randomUUID()` — 128 bits of entropy, sufficient for a
 * loopback-only auth token.
 *
 * @returns A new random token string (UUID v4 format)
 */
export function generateRelayToken(): string {
  return randomUUID();
}

/**
 * AUTH-01: Timing-safe token comparison for relay authentication.
 *
 * Uses `timingSafeEqual` to prevent timing side-channel attacks.
 * Length mismatch short-circuits (token length is not secret — the
 * `Bearer` / UUID format is public knowledge).
 *
 * SAFETY: `timingSafeEqual` throws ERR_INVALID_BUFFER_SIZE when the two
 * Buffers have different byte lengths.  This cannot happen for valid
 * ASCII UUID tokens (both candidate and expected are byte-identical to
 * their UTF-8 encoding).  The try-catch is a hardening belt-and-suspenders
 * guard against hostile Unicode input that could otherwise make the server
 * unreachable by causing an unhandled throw during auth.
 *
 * @param candidate - The token provided by the connecting client
 * @param expected  - The server's stored token
 * @returns true if the candidate matches the expected token
 */
export function isAuthorizedToken(candidate: string | null | undefined, expected: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  if (candidate.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
  } catch {
    // Candidate and expected had equal JS-string lengths but unequal byte lengths
    // (multi-byte Unicode).  Reject rather than crash.
    return false;
  }
}

