/**
 * Tests for Session idle timeout + TTL reaping (MS-06)
 * Requirements: multi-session-architecture.md §MS-06
 *
 * Sessions have idleTimeoutMs and sessionTTLMs. Idle sessions move to Idle state.
 * Sessions not updated within sessionTTLMs are reaped.
 *
 * API checklist:
 *   McpSessionRegistry — 9 tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpSessionRegistry } from "../mcp-session.js";
import type { Session } from "../mcp-session.js";

describe("McpSessionRegistry — Session TTL & Idle Timeout (MS-06)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // MS-06.1: Session has lastActivity updated on every activity (touchSession)
  it("MS-06.1: touchSession updates lastActivity on the session", () => {
    const registry = new McpSessionRegistry();
    const session = registry.createSession();

    const before = session.lastActivity;

    // Advance fake time
    vi.advanceTimersByTime(5_000);

    // Touch the session
    const touched = registry.touchSession(session.id);
    expect(touched).toBeDefined();
    expect(touched!.lastActivity).toBeGreaterThan(before);
  });

  // MS-06.2: getActiveSessions() excludes sessions beyond sessionTTLMs (reaping)
  it("MS-06.2: getActiveSessions excludes sessions beyond TTL", () => {
    const registry = new McpSessionRegistry();
    const session = registry.createSession();

    // TTL = 30 seconds
    const ttl = 30_000;

    // Session is fresh — should be active
    const active1 = registry.getActiveSessions(ttl);
    expect(active1.map((s) => s.id)).toContain(session.id);

    // Advance time beyond TTL
    vi.advanceTimersByTime(ttl + 1);

    // Session should now be reaped — not returned as active
    const active2 = registry.getActiveSessions(ttl);
    expect(active2.map((s) => s.id)).not.toContain(session.id);
  });

  // MS-06.3: Sessions beyond idleTimeoutMs are marked Idle (getIdleSessions())
  it("MS-06.3: getIdleSessions returns sessions idle beyond the timeout", () => {
    const registry = new McpSessionRegistry();
    const session = registry.createSession();

    const idleTimeout = 10_000; // 10 seconds

    // Session is fresh — not idle
    const idle1 = registry.getIdleSessions(idleTimeout);
    expect(idle1.map((s) => s.id)).not.toContain(session.id);

    // Advance time beyond idle timeout without touching
    vi.advanceTimersByTime(idleTimeout + 1);

    // Session should now be idle
    const idle2 = registry.getIdleSessions(idleTimeout);
    expect(idle2.map((s) => s.id)).toContain(session.id);
  });

  // MS-06.4: Session touched after going Idle returns to Active
  it("MS-06.4: session touched after going idle returns to active state", () => {
    const registry = new McpSessionRegistry();
    const session = registry.createSession();

    const idleTimeout = 5_000;

    // Advance beyond idle timeout
    vi.advanceTimersByTime(idleTimeout + 1);

    // Verify session is idle
    expect(registry.getIdleSessions(idleTimeout).map((s) => s.id)).toContain(session.id);

    // Touch it — should return to active
    const touched = registry.touchSession(session.id);
    expect(touched).toBeDefined();

    // No longer idle
    expect(registry.getIdleSessions(idleTimeout).map((s) => s.id)).not.toContain(session.id);
  });

  // MS-06.5: reapStaleSessions() removes sessions beyond TTL and returns count
  it("MS-06.5: reapStaleSessions removes expired sessions and returns the count", () => {
    const registry = new McpSessionRegistry();
    const session = registry.createSession();

    const ttl = 20_000;

    // Advance beyond TTL
    vi.advanceTimersByTime(ttl + 1);

    // Reap stale sessions
    const count = registry.reapStaleSessions(ttl);
    expect(count).toBe(1);

    // Session should no longer exist
    expect(registry.getSession(session.id)).toBeUndefined();
  });

  // MS-06.6: touchSession(id) updates lastActivity and returns session
  it("MS-06.6: touchSession returns the updated session", () => {
    const registry = new McpSessionRegistry();
    const session = registry.createSession();

    vi.advanceTimersByTime(1_000);

    const updated = registry.touchSession(session.id);
    expect(updated).toBeDefined();
    expect(updated!.id).toBe(session.id);
    expect(updated!.lastActivity).toBe(session.createdAt + 1_000);
  });

  // MS-06.7: touchSession on unknown ID returns undefined (no-op, not error)
  it("MS-06.7: touchSession on unknown ID returns undefined without throwing", () => {
    const registry = new McpSessionRegistry();

    const result = registry.touchSession("non-existent-id");
    expect(result).toBeUndefined();
  });

  // MS-06.6b: reapStaleSessions(0) returns 0 when nothing is stale (cleanup edge case)
  it("MS-06.6b: reapStaleSessions(0) returns 0 when no sessions are stale", () => {
    const registry = new McpSessionRegistry();
    registry.createSession();

    // No time advanced — nothing is stale
    const count = registry.reapStaleSessions(0);
    expect(count).toBe(0);
  });

  // MS-06.8: Session not touched within TTL is removed from registry on getActiveSessions call
  it("MS-06.8: session not touched within TTL is removed from registry", () => {
    const registry = new McpSessionRegistry();
    const session = registry.createSession();

    const ttl = 15_000;

    // Advance time beyond TTL without touching
    vi.advanceTimersByTime(ttl + 1);

    // getActiveSessions should not return the expired session
    const active = registry.getActiveSessions(ttl);
    expect(active.map((s) => s.id)).not.toContain(session.id);

    // And the session should be gone from the registry entirely
    expect(registry.getSession(session.id)).toBeUndefined();
  });
});