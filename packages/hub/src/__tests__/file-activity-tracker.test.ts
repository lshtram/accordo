/**
 * Tests for FileActivityTracker (MS-04)
 * Requirements: multi-session-architecture.md §MS-04
 *
 * Advisory conflict detection: when a tool call involves writing to a URI
 * that another session is currently editing, log a warning.
 *
 * API checklist:
 *   FileActivityTracker — 8 tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { FileActivityTracker } from "../file-activity-tracker.js";

describe("FileActivityTracker (MS-04)", () => {

  let tracker: FileActivityTracker;

  beforeEach(() => {
    tracker = new FileActivityTracker();
  });

  // MS-04.1: trackEdit(sessionId, uri) records the edit
  it("MS-04.1: trackEdit records the session editing a URI", () => {
    tracker.trackEdit("session-1", "agent-1", "/path/to/file.ts");
    const edit = tracker.getActiveEdit("/path/to/file.ts");
    expect(edit).toBeDefined();
    expect(edit!.sessionId).toBe("session-1");
    expect(edit!.agentHint).toBe("agent-1");
  });

  // MS-04.2: getActiveEdit(uri) returns the session editing a URI, or undefined
  it("MS-04.2: getActiveEdit returns the active editor for a URI", () => {
    tracker.trackEdit("session-x", "opencode", "/foo/bar.txt");
    const edit = tracker.getActiveEdit("/foo/bar.txt");
    expect(edit).toEqual({ sessionId: "session-x", agentHint: "opencode" });
  });

  it("MS-04.2: getActiveEdit returns undefined for untracked URI", () => {
    const edit = tracker.getActiveEdit("/nonexistent/file.txt");
    expect(edit).toBeUndefined();
  });

  // MS-04.3: releaseEdit(uri) removes the tracking entry
  it("MS-04.3: releaseEdit removes the tracking entry for a URI", () => {
    tracker.trackEdit("session-1", "copilot", "/path/to/file.ts");
    tracker.releaseEdit("/path/to/file.ts");
    const edit = tracker.getActiveEdit("/path/to/file.ts");
    expect(edit).toBeUndefined();
  });

  // MS-04.4: Same session can call trackEdit twice (idempotent — just updates timestamp)
  it("MS-04.4: same session calling trackEdit twice updates timestamp without warning", () => {
    const warning1 = tracker.trackEdit("session-1", "opencode", "/path/to/file.ts");
    expect(warning1).toBeUndefined(); // no conflict on first edit

    const warning2 = tracker.trackEdit("session-1", "opencode", "/path/to/file.ts");
    expect(warning2).toBeUndefined(); // same session — no warning

    // Still only one active edit
    const edit = tracker.getActiveEdit("/path/to/file.ts");
    expect(edit?.sessionId).toBe("session-1");
  });

  // MS-04.5: Two different sessions editing same URI: second call returns warning
  it("MS-04.5: second session editing same URI returns warning message", () => {
    tracker.trackEdit("session-A", "copilot", "/path/to/file.ts");

    const warning = tracker.trackEdit("session-B", "opencode", "/path/to/file.ts");

    expect(warning).toBeDefined();
    expect(warning!.warning).toMatch(/session-A/);
    expect(warning!.warning).toMatch(/copilot/);
  });

  // MS-04.6: Warning does NOT block — caller proceeds and must handle the warning
  it("MS-04.6: warning is returned but does not prevent the trackEdit from succeeding", () => {
    tracker.trackEdit("session-A", "copilot", "/path/to/file.ts");

    const warning = tracker.trackEdit("session-B", "opencode", "/path/to/file.ts");

    // The second session's edit IS recorded (caller proceeds)
    const edit = tracker.getActiveEdit("/path/to/file.ts");
    expect(edit?.sessionId).toBe("session-B");
    expect(edit?.agentHint).toBe("opencode");

    // But a warning was returned so the caller can decide what to do
    expect(warning).toBeDefined();
    expect(warning!.warning).toContain("session-A");
  });

  // MS-04.7: After releaseEdit, a new session can edit the same URI without warning
  it("MS-04.7: after releaseEdit, new session editing same URI does not trigger warning", () => {
    tracker.trackEdit("session-A", "copilot", "/path/to/file.ts");
    tracker.releaseEdit("/path/to/file.ts");

    const warning = tracker.trackEdit("session-B", "opencode", "/path/to/file.ts");

    expect(warning).toBeUndefined(); // no conflict after release

    const edit = tracker.getActiveEdit("/path/to/file.ts");
    expect(edit?.sessionId).toBe("session-B");
  });

  // MS-04.8: trackEdit accepts agentHint for the warning message
  it("MS-04.8: warning message includes agentHint of the conflicting session", () => {
    tracker.trackEdit("session-1", "claude", "/path/to/file.ts");

    const warning = tracker.trackEdit("session-2", "opencode", "/path/to/file.ts");

    expect(warning).toBeDefined();
    expect(warning!.warning).toMatch(/session-1/);
    expect(warning!.warning).toMatch(/claude/);
    // The warning should reference the ORIGINAL session's agentHint
    expect(warning!.warning).toContain("claude");
  });
});