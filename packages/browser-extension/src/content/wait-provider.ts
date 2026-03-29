/**
 * M109-WAIT — Wait Provider (Content Script)
 *
 * Implements the polling-based wait logic that runs inside the content
 * script context (where the DOM is available). The service worker delegates
 * `wait_for` requests to this module via `chrome.tabs.sendMessage`.
 *
 * **Polling strategy (from architecture §8.2):**
 * - Polls at 100ms intervals (not MutationObserver — simpler and more
 *   predictable for cross-frame scenarios).
 * - For `stableLayoutMs`, compares `document.documentElement.scrollHeight`
 *   + `getBoundingClientRect()` of body across intervals.
 *
 * **Interruption handling:**
 * - B2-WA-006: Navigation events cancel the polling loop and return
 *   `{ met: false, error: "navigation-interrupted" }`.
 * - B2-WA-007: Tab close events cancel the polling loop and return
 *   `{ met: false, error: "page-closed" }`.
 *
 * Implements requirements B2-WA-001 through B2-WA-007.
 *
 * @module
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Polling interval in ms. Architecture §8.2 specifies 100ms. */
export const POLL_INTERVAL_MS = 100;

/** Default timeout in ms. B2-WA-004. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Maximum allowed timeout in ms. B2-WA-004. */
export const MAX_TIMEOUT_MS = 30_000;

// ── Internal Types ───────────────────────────────────────────────────────────

/**
 * Internal options for the wait polling loop.
 * Derived from `WaitForArgs` after validation and clamping.
 */
export interface WaitOptions {
  /** Timeout in ms (already clamped to [0, MAX_TIMEOUT_MS]). */
  timeoutMs: number;
  /**
   * Optional AbortSignal — when aborted, the polling loop terminates
   * immediately. Used by handleWaitForAction to cancel losing branches.
   */
  signal?: AbortSignal;
}

/**
 * Result from the wait polling loop.
 * Maps directly to the MCP tool's `WaitForResult`.
 */
export interface WaitResult {
  met: boolean;
  matchedCondition?: string;
  elapsedMs: number;
  error?: "timeout" | "navigation-interrupted" | "page-closed";
}

// ── WaitProvider Interface (Architecture §3.2) ───────────────────────────────

/**
 * Detachable interface for wait operations.
 *
 * Each method polls the DOM at POLL_INTERVAL_MS intervals until the
 * condition is met or timeout/interruption occurs.
 *
 * This interface exists so the wait logic can be tested independently
 * and swapped (e.g., for a standalone MCP server outside Accordo).
 */
export interface WaitProvider {
  /**
   * B2-WA-001: Wait for any of the given text strings to appear on the page.
   * Checks `document.body.innerText` (case-sensitive) at each poll interval.
   */
  waitForText(texts: string[], options: WaitOptions): Promise<WaitResult>;

  /**
   * B2-WA-002: Wait for a CSS selector to match at least one element.
   * Checks `document.querySelector(selector)` at each poll interval.
   */
  waitForSelector(selector: string, options: WaitOptions): Promise<WaitResult>;

  /**
   * B2-WA-003: Wait until no layout changes for `stableMs` milliseconds.
   * Compares `scrollHeight` + `getBoundingClientRect()` of body across intervals.
   */
  waitForStableLayout(stableMs: number, options: WaitOptions): Promise<WaitResult>;
}

// ── Interruption Helpers ─────────────────────────────────────────────────────

/**
 * Returns a Promise that resolves with the interruption error code when
 * the current page is about to navigate (`beforeunload`) or be hidden
 * (`pagehide`). The caller is responsible for racing this against the
 * polling loop.
 *
 * B2-WA-006: `beforeunload` signals navigation-interrupted.
 * B2-WA-007: `pagehide` with `persisted === false` signals page-closed.
 *
 * The cleanup function returned must be called when the race is resolved
 * to prevent memory leaks on successful waits.
 */
function makeInterruptionPromise(): {
  promise: Promise<"navigation-interrupted" | "page-closed">;
  cleanup: () => void;
} {
  let resolve: (code: "navigation-interrupted" | "page-closed") => void;
  const promise = new Promise<"navigation-interrupted" | "page-closed">((res) => {
    resolve = res;
  });

  const onBeforeUnload = (): void => {
    resolve("navigation-interrupted");
  };

  const onPageHide = (e: PageTransitionEvent): void => {
    // `persisted` is true when the page enters bfcache — not a true close.
    if (!e.persisted) {
      resolve("page-closed");
    } else {
      resolve("navigation-interrupted");
    }
  };

  window.addEventListener("beforeunload", onBeforeUnload, { once: true });
  window.addEventListener("pagehide", onPageHide, { once: true });

  const cleanup = (): void => {
    window.removeEventListener("beforeunload", onBeforeUnload);
    window.removeEventListener("pagehide", onPageHide);
  };

  return { promise, cleanup };
}

/** Returns a Promise that resolves after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Wait Implementations ─────────────────────────────────────────────────────

/**
 * B2-WA-001: Wait for text appearance.
 *
 * Polls `document.body.innerText` at POLL_INTERVAL_MS intervals, checking
 * if any of the provided text strings are present.
 *
 * @param texts — Array of text strings to search for (any match wins)
 * @param options — Wait options with clamped timeout
 * @returns WaitResult indicating success or failure
 */
export async function waitForText(
  texts: string[],
  options: WaitOptions,
): Promise<WaitResult> {
  const { timeoutMs, signal } = options;
  const start = Date.now();
  const { promise: interruptPromise, cleanup } = makeInterruptionPromise();

  try {
    while (true) {
      // Check abort signal from multi-condition race cancellation
      if (signal?.aborted === true) {
        return { met: false, error: "timeout", elapsedMs: timeoutMs };
      }

      const elapsed = Date.now() - start;

      // Check condition first
      const bodyText = document.body.innerText;
      for (const text of texts) {
        if (bodyText.includes(text)) {
          return { met: true, matchedCondition: text, elapsedMs: elapsed };
        }
      }

      // Check timeout — B2-WA-005: return exactly timeoutMs, not measured elapsed
      if (elapsed >= timeoutMs) {
        return { met: false, error: "timeout", elapsedMs: timeoutMs };
      }

      // Race the next poll tick against an interruption signal
      const raceResult = await Promise.race([
        delay(POLL_INTERVAL_MS).then(() => "tick" as const),
        interruptPromise,
      ]);

      if (raceResult === "navigation-interrupted" || raceResult === "page-closed") {
        return { met: false, error: raceResult, elapsedMs: Date.now() - start };
      }
    }
  } finally {
    cleanup();
  }
}

/**
 * B2-WA-002: Wait for CSS selector match.
 *
 * Polls `document.querySelector(selector)` at POLL_INTERVAL_MS intervals.
 *
 * @param selector — CSS selector that must match at least one element
 * @param options — Wait options with clamped timeout
 * @returns WaitResult indicating success or failure
 */
export async function waitForSelector(
  selector: string,
  options: WaitOptions,
): Promise<WaitResult> {
  const { timeoutMs, signal } = options;
  const start = Date.now();
  const { promise: interruptPromise, cleanup } = makeInterruptionPromise();

  try {
    while (true) {
      // Check abort signal from multi-condition race cancellation
      if (signal?.aborted === true) {
        return { met: false, error: "timeout", elapsedMs: timeoutMs };
      }

      const elapsed = Date.now() - start;

      // Check condition first
      if (document.querySelector(selector) !== null) {
        return { met: true, matchedCondition: selector, elapsedMs: elapsed };
      }

      // Check timeout — B2-WA-005: return exactly timeoutMs, not measured elapsed
      if (elapsed >= timeoutMs) {
        return { met: false, error: "timeout", elapsedMs: timeoutMs };
      }

      // Race the next poll tick against an interruption signal
      const raceResult = await Promise.race([
        delay(POLL_INTERVAL_MS).then(() => "tick" as const),
        interruptPromise,
      ]);

      if (raceResult === "navigation-interrupted" || raceResult === "page-closed") {
        return { met: false, error: raceResult, elapsedMs: Date.now() - start };
      }
    }
  } finally {
    cleanup();
  }
}

/**
 * B2-WA-003: Wait for layout stability.
 *
 * Polls layout metrics (`scrollHeight`, `getBoundingClientRect()` of body)
 * at POLL_INTERVAL_MS intervals. The condition is met when the metrics
 * remain unchanged for at least `stableMs` consecutive milliseconds.
 *
 * @param stableMs — Required stability duration in ms
 * @param options — Wait options with clamped timeout
 * @returns WaitResult indicating success or failure
 */
export async function waitForStableLayout(
  stableMs: number,
  options: WaitOptions,
): Promise<WaitResult> {
  const { timeoutMs, signal } = options;
  const start = Date.now();
  const { promise: interruptPromise, cleanup } = makeInterruptionPromise();

  /** Capture current layout fingerprint. */
  function captureLayoutFingerprint(): string {
    const scrollHeight = document.documentElement.scrollHeight;
    const rect = document.body.getBoundingClientRect();
    return `${scrollHeight}:${rect.width}:${rect.height}`;
  }

  let lastFingerprint = captureLayoutFingerprint();
  let stableStart = Date.now();

  try {
    while (true) {
      // Check abort signal from multi-condition race cancellation
      if (signal?.aborted === true) {
        return { met: false, error: "timeout", elapsedMs: timeoutMs };
      }

      const elapsed = Date.now() - start;

      // Check timeout first — B2-WA-005: return exactly timeoutMs, not measured elapsed
      if (elapsed >= timeoutMs) {
        return { met: false, error: "timeout", elapsedMs: timeoutMs };
      }

      // Race the next poll tick against an interruption signal
      const raceResult = await Promise.race([
        delay(POLL_INTERVAL_MS).then(() => "tick" as const),
        interruptPromise,
      ]);

      if (raceResult === "navigation-interrupted" || raceResult === "page-closed") {
        return { met: false, error: raceResult, elapsedMs: Date.now() - start };
      }

      const currentFingerprint = captureLayoutFingerprint();
      if (currentFingerprint !== lastFingerprint) {
        // Layout changed — reset the stability clock
        lastFingerprint = currentFingerprint;
        stableStart = Date.now();
      } else if (Date.now() - stableStart >= stableMs) {
        // Layout has been stable for at least stableMs
        return { met: true, matchedCondition: "stable-layout", elapsedMs: Date.now() - start };
      }
    }
  } finally {
    cleanup();
  }
}

// ── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Entry point for the wait_for relay action.
 *
 * Dispatches to the appropriate wait function based on the provided
 * condition parameters. Validates that at least one condition is specified.
 * Clamps timeout to [0, MAX_TIMEOUT_MS] and defaults to DEFAULT_TIMEOUT_MS.
 *
 * When multiple conditions are provided, they race: the first one met wins.
 *
 * B2-WA-004: Timeout validation and clamping.
 * B2-WA-006/007: Navigation and page-close interruption are handled
 * inside each individual wait function.
 *
 * @param payload — Raw payload from the relay action request
 * @returns WaitResult or error
 */
export async function handleWaitForAction(
  payload: Record<string, unknown>,
): Promise<WaitResult | { error: string }> {
  const texts = Array.isArray(payload.texts) ? (payload.texts as string[]) : undefined;
  const selector = typeof payload.selector === "string" ? payload.selector : undefined;
  const stableLayoutMs = typeof payload.stableLayoutMs === "number" ? payload.stableLayoutMs : undefined;
  const rawTimeout = typeof payload.timeout === "number" ? payload.timeout : DEFAULT_TIMEOUT_MS;

  // Validate that at least one condition is present
  const hasCondition =
    (texts !== undefined && texts.length > 0) ||
    selector !== undefined ||
    stableLayoutMs !== undefined;

  if (!hasCondition) {
    return { error: "invalid-request" };
  }

  // Clamp timeout to [0, MAX_TIMEOUT_MS]
  const timeoutMs = Math.min(Math.max(0, rawTimeout), MAX_TIMEOUT_MS);

  // Shared AbortController — aborted when the first condition wins so all
  // losing branches terminate immediately instead of polling until timeout.
  const controller = new AbortController();
  const options: WaitOptions = { timeoutMs, signal: controller.signal };

  // Build list of pending condition promises
  const pending: Promise<WaitResult>[] = [];

  if (texts !== undefined && texts.length > 0) {
    pending.push(waitForText(texts, options));
  }
  if (selector !== undefined) {
    pending.push(waitForSelector(selector, options));
  }
  if (stableLayoutMs !== undefined) {
    pending.push(waitForStableLayout(stableLayoutMs, options));
  }

  // Race all conditions — first one to resolve wins; abort the rest
  const winner = await Promise.race(pending);
  controller.abort();
  return winner;
}
