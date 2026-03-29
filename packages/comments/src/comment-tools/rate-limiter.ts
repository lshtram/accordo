/**
 * Rate limiter for comment.create — 10 per minute per agent.
 *
 * Source: comments-architecture.md §6.1
 */

import { COMMENT_CREATE_RATE_LIMIT, COMMENT_CREATE_RATE_WINDOW_MS } from "@accordo/bridge-types";

/**
 * Rate limiter for comment.create — 10 per minute per agent.
 * Exported for testing.
 *
 * Source: comments-architecture.md §6.1
 */
export class CreateRateLimiter {
  /** Maps agentId → array of timestamps (ms) of recent creates */
  private readonly _windows = new Map<string, number[]>();

  /** Check if a create is allowed for the given agent. */
  isAllowed(agentId: string): boolean {
    this._purge(agentId);
    const count = this._windows.get(agentId)?.length ?? 0;
    return count < COMMENT_CREATE_RATE_LIMIT;
  }

  /** Record a create for the given agent. */
  record(agentId: string): void {
    this._purge(agentId);
    const times = this._windows.get(agentId) ?? [];
    times.push(Date.now());
    this._windows.set(agentId, times);
  }

  /** Reset all rate limit state. */
  reset(): void {
    this._windows.clear();
  }

  private _purge(agentId: string): void {
    const cutoff = Date.now() - COMMENT_CREATE_RATE_WINDOW_MS;
    const times = this._windows.get(agentId);
    if (!times) return;
    const fresh = times.filter(t => t > cutoff);
    if (fresh.length === 0) this._windows.delete(agentId);
    else this._windows.set(agentId, fresh);
  }
}
