/**
 * M52-SUB — ScriptSubtitleBar tests (Phase B — must FAIL before implementation)
 * Coverage: M52-SUB-01 through M52-SUB-07
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScriptSubtitleBar } from "../subtitle-bar.js";
import { window, StatusBarAlignment } from "./mocks/vscode.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── M52-SUB-01: construction ──────────────────────────────────────────────────

describe("M52-SUB-01 construction", () => {
  it("calls createStatusBarItem with Left alignment and priority 500", () => {
    new ScriptSubtitleBar();
    expect(window.createStatusBarItem).toHaveBeenCalledWith(StatusBarAlignment.Left, 500);
  });

  it("M52-SUB-07: sets tooltip to 'Accordo Script — subtitle'", () => {
    new ScriptSubtitleBar();
    const item = window._getLastStatusBarItem();
    expect(item.tooltip).toBe("Accordo Script \u2014 subtitle");
  });
});

// ── M52-SUB-02: show() ───────────────────────────────────────────────────────

describe("M52-SUB-02 show()", () => {
  it("sets item.text to '$(comment) ' + text", () => {
    const bar = new ScriptSubtitleBar();
    bar.show("hello world", 3000);
    const item = window._getLastStatusBarItem();
    expect(item.text).toBe("$(comment) hello world");
  });

  it("calls item.show()", () => {
    const bar = new ScriptSubtitleBar();
    bar.show("hello", 3000);
    const item = window._getLastStatusBarItem();
    expect(item.show).toHaveBeenCalled();
  });
});

// ── M52-SUB-03: auto-hide ────────────────────────────────────────────────────

describe("M52-SUB-03 auto-hide after durationMs", () => {
  it("item is NOT hidden before durationMs elapses", () => {
    const bar = new ScriptSubtitleBar();
    bar.show("hello", 2000);
    const item = window._getLastStatusBarItem();

    vi.advanceTimersByTime(1999);
    expect(item.hide).not.toHaveBeenCalled();
  });

  it("item IS hidden after durationMs elapses", () => {
    const bar = new ScriptSubtitleBar();
    bar.show("hello", 2000);
    const item = window._getLastStatusBarItem();

    vi.advanceTimersByTime(2000);
    expect(item.hide).toHaveBeenCalled();
  });
});

// ── M52-SUB-04: show() resets timer ──────────────────────────────────────────

describe("M52-SUB-04 show() resets the auto-hide timer", () => {
  it("calling show() again resets the timer", () => {
    const bar = new ScriptSubtitleBar();
    bar.show("first", 2000);
    const item = window._getLastStatusBarItem();

    vi.advanceTimersByTime(1500);
    bar.show("second", 2000); // reset

    vi.advanceTimersByTime(1500); // 3000ms total — but timer was reset at 1500
    expect(item.hide).not.toHaveBeenCalled(); // new 2000ms hasn't elapsed yet

    vi.advanceTimersByTime(500); // now 2000ms since reset
    expect(item.hide).toHaveBeenCalledTimes(1);
  });
});

// ── M52-SUB-05: clear() ──────────────────────────────────────────────────────

describe("M52-SUB-05 clear()", () => {
  it("hides the item immediately", () => {
    const bar = new ScriptSubtitleBar();
    bar.show("hello", 5000);
    const item = window._getLastStatusBarItem();

    bar.clear();
    expect(item.hide).toHaveBeenCalled();
  });

  it("cancels the pending auto-hide timer", () => {
    const bar = new ScriptSubtitleBar();
    bar.show("hello", 2000);
    const item = window._getLastStatusBarItem();

    bar.clear();
    vi.advanceTimersByTime(2000); // original timer fires — but should be cancelled
    expect(item.hide).toHaveBeenCalledTimes(1); // only once (from clear), not twice
  });
});

// ── M52-SUB-06: dispose() ────────────────────────────────────────────────────

describe("M52-SUB-06 dispose()", () => {
  it("calls item.dispose()", () => {
    const bar = new ScriptSubtitleBar();
    const item = window._getLastStatusBarItem();
    bar.dispose();
    expect(item.dispose).toHaveBeenCalled();
  });

  it("hides the item before disposing (calls clear first)", () => {
    const bar = new ScriptSubtitleBar();
    bar.show("hello", 5000);
    const item = window._getLastStatusBarItem();

    bar.dispose();
    expect(item.hide).toHaveBeenCalled();
    expect(item.dispose).toHaveBeenCalled();
  });
});
