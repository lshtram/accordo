/**
 * layout-debug — Gated structured debug logging for layout pipeline.
 *
 * SUP-S06: Development instrumentation for upstream placement diagnostics.
 * All logging is disabled by default. Enable via `setLayoutDebug(true)`.
 *
 * Design:
 * - Uses `console.warn` (allowed by ESLint `no-console` rule)
 * - Structured JSON payloads for machine-parseable output
 * - Gated behind a boolean flag — zero overhead when disabled
 * - Permanent gated instrumentation (SUP-S06): ships with the extension
 *   Grep for `layout-debug` to find all call sites.
 */

// ── Gate ──────────────────────────────────────────────────────────────────────

const envDebugEnabled =
  typeof process !== "undefined" &&
  typeof process.env !== "undefined" &&
  process.env.ACCORDO_LAYOUT_DEBUG === "1";

let debugEnabled = envDebugEnabled;

/**
 * Enable or disable layout debug logging.
 * @param enabled - true to enable, false to disable (default: false)
 */
export function setLayoutDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

/** Returns true if layout debug logging is currently enabled. */
export function isLayoutDebugEnabled(): boolean {
  return debugEnabled;
}

// ── Logging ───────────────────────────────────────────────────────────────────

/** Structured debug event for layout pipeline diagnostics. */
export interface LayoutDebugEvent {
  /** Event category (e.g. "upstream-parse", "identity-match", "fallback"). */
  category: string;
  /** Human-readable message. */
  message: string;
  /** Arbitrary structured data for the event. */
  data?: Record<string, unknown>;
}

/**
 * Emit a structured debug event if debug logging is enabled.
 * No-op when disabled. Uses `console.warn` (ESLint-safe).
 *
 * @param event - Structured debug event
 */
export function layoutDebug(event: LayoutDebugEvent): void {
  // Gated layout pipeline instrumentation (permanent — SUP-S06)
  if (!debugEnabled) return;
  // eslint-disable-next-line no-console
  console.warn("[layout-debug]", JSON.stringify(event));
}
