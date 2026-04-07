/**
 * Hub Disconnect Handler — Grace timer for reload survival
 *
 * Manages the Hub-side grace timer that starts when a Bridge sends
 * POST /bridge/disconnect. If no new WS connection arrives within the
 * grace window, the Hub self-terminates. If a Bridge reconnects, the
 * timer is cancelled.
 *
 * Requirements: adr-reload-reconnect.md §D1
 *
 * NOTE: This is a STUB file. All methods throw "not implemented".
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Configuration for the disconnect handler.
 */
export interface DisconnectHandlerConfig {
  /**
   * Grace period in milliseconds. After a disconnect request, the Hub waits
   * this long for a reconnecting Bridge before self-terminating.
   * Default: 10_000 (10 seconds).
   */
  graceWindowMs: number;

  /**
   * Callback invoked when the grace timer expires without reconnect.
   * The implementation should call `process.exit(0)` or equivalent.
   */
  onGraceExpired: () => void;

  /**
   * Logger for disconnect events.
   */
  log: (message: string) => void;
}

/**
 * Snapshot of the disconnect handler state (for diagnostics / testing).
 */
export interface DisconnectHandlerState {
  /** True when a grace timer is actively counting down. */
  graceTimerActive: boolean;
  /** Epoch ms when grace timer started, or null if inactive. */
  graceStartedAt: number | null;
  /** Remaining ms until grace expiry, or null if inactive. */
  graceRemainingMs: number | null;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * DisconnectHandler manages the grace timer lifecycle for Hub reload survival.
 *
 * Usage:
 *   - `startGraceTimer()` — called when Hub receives POST /bridge/disconnect
 *   - `cancelGraceTimer()` — called when a new WS connection is established
 *   - `getState()` — returns current timer state for diagnostics
 *
 * The handler is stateless across restarts — if the Hub process dies, the
 * timer dies with it. No persistence needed.
 */
export class DisconnectHandler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private graceStartedAt: number | null = null;

  constructor(private config: DisconnectHandlerConfig) {}

  startGraceTimer(): void {
    // Clear existing timer if running — effectively restarts
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.graceStartedAt = Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.graceStartedAt = null;
      this.config.onGraceExpired();
    }, this.config.graceWindowMs);
  }

  cancelGraceTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.graceStartedAt = null;
  }

  getState(): DisconnectHandlerState {
    const active = this.timer !== null;
    let remainingMs: number | null = null;
    if (active && this.graceStartedAt !== null) {
      remainingMs = Math.max(0, this.config.graceWindowMs - (Date.now() - this.graceStartedAt));
    }
    return {
      graceTimerActive: active,
      graceStartedAt: this.graceStartedAt,
      graceRemainingMs: remainingMs,
    };
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.graceStartedAt = null;
  }
}
