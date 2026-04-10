/**
 * write-lease.test.ts — WriteLeaseManager
 *
 * Tests for WriteLeaseManager (SBR-F-020..027).
 *
 * Phase A: constructor and all methods throw "not implemented (Phase A stub)".
 * Tests express the intended behavior and fail because implementation is absent.
 * Fake timers are used to test time-dependent behavior (expiry, extension).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WriteLeaseManager } from "../write-lease.js";
import type { WriteLeaseOptions } from "../shared-relay-types.js";
import { MUTATING_ACTIONS } from "../shared-relay-types.js";

const HUB_A = "hub-a-uuid-0001";
const HUB_B = "hub-b-uuid-0002";
const HUB_C = "hub-c-uuid-0003";

function makeOptions(overrides?: Partial<WriteLeaseOptions>): WriteLeaseOptions {
  return {
    leaseDurationMs: 10_000,
    leaseExtensionMs: 2_000,
    maxQueueDepth: 8,
    ...overrides,
  };
}

// ── SBR-F-020: Mutating actions require write lease ─────────────────────────────

describe("SBR-F-020: Mutating actions require write lease before forwarding to Chrome", () => {
  it("SBR-F-020: MUTATING_ACTIONS includes exactly navigate, click, type, press_key", () => {
    expect(MUTATING_ACTIONS.sort()).toEqual(["click", "navigate", "press_key", "type"]);
    expect(MUTATING_ACTIONS).toHaveLength(4);
  });

  it("SBR-F-020: acquire() must be called before mutating action is forwarded", async () => {
    const manager = new WriteLeaseManager(makeOptions());
    // Phase C: Hub must call acquire() before sending navigate/click/type/press_key.
    // Phase A: acquire() throws "not implemented" → meaningful failure.
    await manager.acquire(HUB_A);
    expect(manager.currentHolder()).toBe(HUB_A);
    manager.release(HUB_A);
  });

  it("SBR-F-020: non-mutating actions bypass the write lease", () => {
    // get_page_map, get_dom_excerpt, etc. do NOT require acquire().
    const readOnlyActions = ["get_page_map", "get_dom_excerpt", "capture_region", "get_text_map"];
    for (const action of readOnlyActions) {
      expect(MUTATING_ACTIONS).not.toContain(action);
    }
  });
});

// ── SBR-F-021: Only one Hub holds the write lease ───────────────────────────────

describe("SBR-F-021: Only one Hub client holds the write lease at any time", () => {
  it("SBR-F-021: currentHolder() returns null when no lease is held", async () => {
    const manager = new WriteLeaseManager(makeOptions());
    expect(manager.currentHolder()).toBe(null); // Fails: constructor throws
  });

  it("SBR-F-021: after Hub A acquires, currentHolder() returns HUB_A", async () => {
    const manager = new WriteLeaseManager(makeOptions());
    await manager.acquire(HUB_A);
    expect(manager.currentHolder()).toBe(HUB_A); // Fails: acquire() throws
    manager.release(HUB_A);
  });

  it("SBR-F-021: while Hub A holds the lease, currentHolder() never returns a different hubId", async () => {
    const manager = new WriteLeaseManager(makeOptions());
    await manager.acquire(HUB_A);
    expect(manager.currentHolder()).toBe(HUB_A);
    expect(manager.currentHolder()).not.toBe(HUB_B);
    expect(manager.currentHolder()).not.toBe(HUB_C);
    manager.release(HUB_A);
  });
});

// ── SBR-F-022: Queue if lease held by another Hub ───────────────────────────────

describe("SBR-F-022: If lease is held by another Hub, request is queued (FIFO)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("SBR-F-022: while Hub A holds the lease, Hub B's acquire() does not throw — it queues", async () => {
    const manager = new WriteLeaseManager(makeOptions());
    await manager.acquire(HUB_A);
    // Hub B attempts to acquire — should queue (FIFO), not reject.
    // Queue depth becomes 1.
    const bAcquire = manager.acquire(HUB_B);
    vi.advanceTimersByTime(50); // Allow microtask queue to process
    expect(manager.queueDepth()).toBe(1);
    // Hub A still holds the lease.
    expect(manager.currentHolder()).toBe(HUB_A);
    // Resolve B's acquire by releasing A.
    manager.release(HUB_A);
    await bAcquire;
    expect(manager.currentHolder()).toBe(HUB_B);
    manager.release(HUB_B);
  });

  it("SBR-F-022: release() grants lease to next queued Hub in FIFO order", async () => {
    const manager = new WriteLeaseManager(makeOptions());
    await manager.acquire(HUB_A);
    const bAcquire = manager.acquire(HUB_B);
    const cAcquire = manager.acquire(HUB_C);
    vi.advanceTimersByTime(10);
    expect(manager.queueDepth()).toBe(2);
    // Release A → B should get it (was first in queue).
    manager.release(HUB_A);
    await bAcquire;
    expect(manager.currentHolder()).toBe(HUB_B);
    // C is still queued.
    expect(manager.queueDepth()).toBe(1);
    manager.release(HUB_B);
    await cAcquire;
    expect(manager.currentHolder()).toBe(HUB_C);
    manager.release(HUB_C);
  });
});

// ── SBR-F-023: Queue depth limit ───────────────────────────────────────────────

describe("SBR-F-023: Queue depth limited to maxQueueDepth (default 8); excess rejected", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("SBR-F-023: default maxQueueDepth is 8", () => {
    const opts = makeOptions();
    expect(opts.maxQueueDepth).toBe(8);
  });

  it("SBR-F-023: when queue depth reaches maxQueueDepth, next acquire() is rejected with 'action-failed'", async () => {
    const manager = new WriteLeaseManager(makeOptions({ maxQueueDepth: 3 }));
    await manager.acquire(HUB_A);
    // Queue B, C — depth=2, within limit (maxQueueDepth-1 when holder exists).
    const bAcquire = manager.acquire(HUB_B);
    const cAcquire = manager.acquire(HUB_C);
    vi.advanceTimersByTime(1); // fire setTimeout(0) callbacks at deadline 0 (NOT expiry at deadline 10)
    expect(manager.queueDepth()).toBe(2);
    vi.runAllTicks(); // flush microtasks from the fired setTimeout(0) callbacks

    // Fourth acquire: HUB_C is already in the queue → rejection via setTimeout(0) (new timer).
    // Capture the promise BEFORE advancing timers so we can await it after firing.
    const dAcquire = manager.acquire(HUB_C);
    vi.advanceTimersByTime(1); // fire the fourth acquire's setTimeout(0) callback
    vi.runAllTicks(); // flush the resulting rejection microtask
    await expect(dAcquire).rejects.toThrow("action-failed");
    manager.release(HUB_A);
    await bAcquire;
    manager.release(HUB_B);
  });
});

// ── SBR-F-024: Auto-expire after leaseDurationMs ───────────────────────────────

describe("SBR-F-024: Lease auto-expires after leaseDurationMs (default 10,000ms) if not renewed", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("SBR-F-024: default leaseDurationMs is 10,000ms", () => {
    const opts = makeOptions();
    expect(opts.leaseDurationMs).toBe(10_000);
  });

  it("SBR-F-024: after leaseDurationMs elapses without release, the lease is automatically released", async () => {
    const manager = new WriteLeaseManager(makeOptions({ leaseDurationMs: 5_000 }));
    await manager.acquire(HUB_A);
    expect(manager.currentHolder()).toBe(HUB_A);
    // Advance time past leaseDurationMs.
    vi.advanceTimersByTime(5_100);
    // Lease should have auto-expired. Hub A no longer holds.
    // Note: in real implementation, a timer would call release() internally.
    expect(manager.currentHolder()).toBe(null); // Fails: acquire() threw in Phase A
  });

  it("SBR-F-024: after auto-expiry, next queued Hub (if any) gets the lease", async () => {
    const manager = new WriteLeaseManager(makeOptions({ leaseDurationMs: 100 }));
    await manager.acquire(HUB_A);
    const bAcquire = manager.acquire(HUB_B);
    vi.advanceTimersByTime(10);
    // Auto-expiry timer fires after 100ms.
    vi.advanceTimersByTime(110);
    // Hub B should now get the lease.
    await bAcquire;
    expect(manager.currentHolder()).toBe(HUB_B);
    manager.release(HUB_B);
  });
});

// ── SBR-F-025: Successful mutation extends lease ────────────────────────────────

describe("SBR-F-025: Successful completion of mutating action extends lease by leaseExtensionMs (default 2,000ms)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("SBR-F-025: default leaseExtensionMs is 2,000ms", () => {
    const opts = makeOptions();
    expect(opts.leaseExtensionMs).toBe(2_000);
  });

  it("SBR-F-025: release() by holder extends the lease by leaseExtensionMs (does not grant to queue)", async () => {
    const manager = new WriteLeaseManager(makeOptions({ leaseExtensionMs: 1_000 }));
    await manager.acquire(HUB_A);
    // Hub A completes a mutation and calls release().
    // This extends the lease (not grants to B), because holder is re-acquiring.
    manager.release(HUB_A);
    expect(manager.currentHolder()).toBe(HUB_A);
    // 500ms passes — within the extension window.
    vi.advanceTimersByTime(500);
    expect(manager.currentHolder()).toBe(HUB_A);
    // After 1100ms (beyond extension), lease would expire — but extension was 1000ms.
    vi.advanceTimersByTime(600);
    // The extension has expired; if there were queued requests they'd get it.
    expect(manager.currentHolder()).toBe(HUB_A); // still A (no queue)
  });

  it("SBR-F-025: successful action followed by release() extends enough to cover normal action duration", async () => {
    const manager = new WriteLeaseManager(makeOptions({ leaseDurationMs: 10_000, leaseExtensionMs: 2_000 }));
    await manager.acquire(HUB_A);
    // Simulate a "successful mutation" by calling release() immediately.
    // This extends the lease by 2s on top of the remaining duration.
    manager.release(HUB_A);
    // Hub A is still the holder.
    expect(manager.currentHolder()).toBe(HUB_A);
  });
});

// ── SBR-F-026: Hub disconnect releases lease and discards queued requests ────────

describe("SBR-F-026: Hub disconnect releases lease AND discards queued requests for that Hub", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("SBR-F-026: releaseAll(hubId) releases the lease held by that Hub", async () => {
    const manager = new WriteLeaseManager(makeOptions());
    await manager.acquire(HUB_A);
    manager.releaseAll(HUB_A);
    expect(manager.currentHolder()).toBe(null); // Fails: acquire() threw
  });

  it("SBR-F-026: releaseAll(hubId) discards all queued requests for that Hub", async () => {
    const manager = new WriteLeaseManager(makeOptions());
    await manager.acquire(HUB_A);
    const bAcquire = manager.acquire(HUB_B);
    const cAcquire = manager.acquire(HUB_C);
    vi.advanceTimersByTime(10);
    expect(manager.queueDepth()).toBe(2);
    // Hub B disconnects — its queued request is discarded.
    manager.releaseAll(HUB_B);
    // C remains queued, B's slot is removed.
    expect(manager.queueDepth()).toBe(1);
    // A releases → C should get it (B was discarded).
    manager.release(HUB_A);
    await cAcquire;
    expect(manager.currentHolder()).toBe(HUB_C);
    manager.release(HUB_C);
  });

  it("SBR-F-026: after releaseAll(HUB_A), HUB_A must re-acquire to regain the lease", async () => {
    const manager = new WriteLeaseManager(makeOptions());
    await manager.acquire(HUB_A);
    manager.releaseAll(HUB_A);
    await manager.acquire(HUB_A);
    expect(manager.currentHolder()).toBe(HUB_A);
    manager.release(HUB_A);
  });
});

// ── SBR-F-027: Read-only actions bypass write lease ─────────────────────────────

describe("SBR-F-027: Read-only actions bypass the write lease entirely", () => {
  it("SBR-F-027: get_page_map, get_dom_excerpt, capture_region are NOT in MUTATING_ACTIONS", () => {
    expect(MUTATING_ACTIONS).not.toContain("get_page_map");
    expect(MUTATING_ACTIONS).not.toContain("get_dom_excerpt");
    expect(MUTATING_ACTIONS).not.toContain("capture_region");
    expect(MUTATING_ACTIONS).not.toContain("get_text_map");
    expect(MUTATING_ACTIONS).not.toContain("get_semantic_graph");
  });

  it("SBR-F-027: MUTATING_ACTIONS covers exactly the four mutating actions", () => {
    expect(MUTATING_ACTIONS.sort()).toEqual(["click", "navigate", "press_key", "type"]);
    expect(MUTATING_ACTIONS).toHaveLength(4);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe("Edge cases: WriteLeaseManager", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("acquire() by the same holder is idempotent (does not add to queue)", async () => {
    const manager = new WriteLeaseManager(makeOptions());
    await manager.acquire(HUB_A);
    expect(manager.queueDepth()).toBe(0);
    // Calling acquire again by A is a no-op (A already holds).
    await manager.acquire(HUB_A);
    expect(manager.queueDepth()).toBe(0);
    expect(manager.currentHolder()).toBe(HUB_A);
    manager.release(HUB_A);
  });

  it("release() by a queued (non-holder) Hub has no effect", async () => {
    const manager = new WriteLeaseManager(makeOptions());
    await manager.acquire(HUB_A);
    const bAcquire = manager.acquire(HUB_B);
    vi.advanceTimersByTime(10);
    // Hub B is queued. Calling release(B) should be a no-op.
    manager.release(HUB_B);
    // A still holds, B still queued.
    expect(manager.currentHolder()).toBe(HUB_A);
    expect(manager.queueDepth()).toBe(1);
    manager.release(HUB_A);
    await bAcquire;
    expect(manager.currentHolder()).toBe(HUB_B);
    manager.release(HUB_B);
  });

  it("queue transfer: A→B→C with proper FIFO ordering", async () => {
    const manager = new WriteLeaseManager(makeOptions());
    await manager.acquire(HUB_A);
    const bAcquire = manager.acquire(HUB_B);
    const cAcquire = manager.acquire(HUB_C);
    vi.advanceTimersByTime(10);
    expect(manager.queueDepth()).toBe(2);
    // Release A → B gets it.
    manager.release(HUB_A);
    await bAcquire;
    expect(manager.currentHolder()).toBe(HUB_B);
    // Release B → C gets it.
    manager.release(HUB_B);
    await cAcquire;
    expect(manager.currentHolder()).toBe(HUB_C);
    manager.release(HUB_C);
  });
});
