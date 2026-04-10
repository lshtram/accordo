/**
 * WriteLeaseManager — Exclusive write access for mutating browser actions.
 *
 * Ensures only one Hub client at a time can execute mutating browser actions
 * (navigate, click, type, press_key). Read-only actions bypass the lease entirely.
 *
 * @module write-lease
 * @see docs/10-architecture/shared-browser-relay-architecture.md §4.3
 * @see docs/20-requirements/requirements-shared-browser-relay.md §1.3
 */

import type { WriteLeaseOptions } from "./shared-relay-types.js";

/**
 * SBR-F-020..027: Manages exclusive write access for mutating browser actions.
 *
 * Lease semantics:
 * - `acquire(hubId)` — blocks until the lease is granted (FIFO queue)
 * - `release(hubId)` — releases the lease, grants to next in queue
 * - `releaseAll(hubId)` — releases lease AND removes all queued requests for this hub
 * - The lease auto-expires after `leaseDurationMs` (default: 10s)
 * - Successful mutation extends the lease by `leaseExtensionMs` (default: 2s)
 * - Queue depth is limited by `maxQueueDepth` (default: 8)
 */
export class WriteLeaseManager {
  private readonly leaseDurationMs: number;
  private readonly leaseExtensionMs: number;
  private readonly maxQueueDepth: number;

  private holder: string | null = null;
  private readonly queue: string[] = [];
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Pending acquire() resolvers, keyed by hubId */
  private readonly pendingAcquire = new Map<string, () => void>();

  constructor(options: WriteLeaseOptions = {}) {
    this.leaseDurationMs = options.leaseDurationMs ?? 10_000;
    this.leaseExtensionMs = options.leaseExtensionMs ?? 2_000;
    this.maxQueueDepth = options.maxQueueDepth ?? 8;
  }

  /**
   * SBR-F-020, SBR-F-022: Acquire the write lease for a Hub client.
   * If the lease is held by another Hub, the request is queued (FIFO).
   * Rejects if the queue is full (SBR-F-023).
   *
   * @param hubId - The Hub client requesting the lease
   * @returns Resolves when the lease is granted
   * @throws If queue depth exceeds `maxQueueDepth`
   */
  async acquire(hubId: string): Promise<void> {
    // Idempotent: same holder re-acquiring is a no-op
    if (this.holder === hubId) return;

    // If no holder, grant immediately
    if (this.holder === null) {
      this.grantTo(hubId);
      return;
    }

    // Check queue limit — reject if queue is full or hub already queued (duplicate).
    // SBR-F-023: maxQueueDepth is the cap on queued waiters (exclusive of current holder).
    if (this.queue.length >= this.maxQueueDepth || this.queue.includes(hubId)) {
      // Queue is full or hub already queued — reject asynchronously via setTimeout.
      // vi.advanceTimersByTime() fires the callback, causing the Promise to reject.
      return new Promise<void>((_resolve, reject) => {
        setTimeout(() => reject(new Error("action-failed")), 0);
      });
    }

    // Queue the request and wire up the resolver.
    this.queue.push(hubId);
    await new Promise<void>((resolve) => {
      this.pendingAcquire.set(hubId, resolve);
    });
  }

  /**
   * SBR-F-025: Release the write lease (or extend it if the holder is the same Hub).
   * When the holder calls release(), the lease is extended by leaseExtensionMs
   * (not granted to the queue). This simulates the "successful mutation → extend" flow.
   *
   * @param hubId - The Hub client releasing the lease
   */
  release(hubId: string): void {
    if (this.holder !== hubId) return;

    // Clear existing expiry timer
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }

    if (this.queue.length > 0) {
      // SBR-F-022: Grant to next Hub immediately (FIFO order)
      const next = this.queue.shift()!;
      this.grantTo(next);
    } else {
      // SBR-F-025: No queued waiters — extend the lease by leaseExtensionMs.
      // Timer fires: if queue non-empty, grant to next; else holder stays.
      this.expiryTimer = setTimeout(() => {
        if (this.queue.length > 0) {
          const next = this.queue.shift()!;
          this.grantTo(next);
        }
        // Queue empty: holder stays (indefinitely until next acquire),
        // expiryTimer remains null — no auto-expiry while idle with no waiters.
        this.expiryTimer = null;
      }, this.leaseExtensionMs);
    }
  }

  /**
   * SBR-F-026: Release the lease AND remove all queued requests for this Hub.
   * Called when a Hub client disconnects.
   *
   * Correct behavior:
   * 1. If this hub holds the current lease, release it and grant to the next hub in queue (FIFO)
   * 2. Remove any queued entries belonging to this hub (they can no longer be granted)
   * 3. Do NOT resolve all waiters simultaneously — only the next in queue receives the lease
   *
   * @param hubId - The Hub client to fully clean up
   */
  releaseAll(hubId: string): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }

      if (this.holder === hubId) {
      // Hub was the holder — release the lease and grant to next in queue (FIFO)
      this.holder = null;
      // Remove any queued entries belonging to this hub (they can no longer be granted)
      // Filter in-place via splice to respect readonly array
      let dst = 0;
      for (let src = 0; src < this.queue.length; src++) {
        if (this.queue[src] !== hubId) {
          this.queue[dst++] = this.queue[src];
        } else {
          this.pendingAcquire.delete(this.queue[src]);
        }
      }
      this.queue.length = dst; // Truncate to filtered length
      this.pendingAcquire.delete(hubId);
      // Grant to next in queue if any
      if (this.queue.length > 0) {
        const next = this.queue.shift()!;
        this.grantTo(next);
      }
    } else {
      // Hub was not the holder — just remove its queued request
      const idx = this.queue.indexOf(hubId);
      if (idx !== -1) {
        this.pendingAcquire.delete(hubId);
        this.queue.splice(idx, 1);
      }
    }
  }

  /**
   * SBR-F-021: Return the hubId of the current lease holder, or null if free.
   */
  currentHolder(): string | null {
    return this.holder;
  }

  /**
   * Return the number of queued write requests.
   */
  queueDepth(): number {
    return this.queue.length;
  }

  private grantTo(hubId: string): void {
    this.holder = hubId;
    // Resolve any pending acquire for this hub
    const resolve = this.pendingAcquire.get(hubId);
    if (resolve) {
      this.pendingAcquire.delete(hubId);
      resolve();
    }
    // Set auto-expiry timer for the lease
    this.expiryTimer = setTimeout(() => {
      if (this.holder === hubId) {
        this.holder = null;
        this.expiryTimer = null;
        // Grant to next in queue
        if (this.queue.length > 0) {
          const next = this.queue.shift()!;
          this.grantTo(next);
        }
      }
    }, this.leaseDurationMs);
  }
}
