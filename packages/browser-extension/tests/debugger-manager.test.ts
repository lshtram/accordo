/**
 * debugger-manager.test.ts
 *
 * Tests for M110-TC — DebuggerManager
 * (ensureAttached, detach, detachAll, isAttached, sendCommand)
 *
 * Uses the chrome-mock debugger mock from tests/setup/chrome-mock.ts.
 *
 * REQ-TC-003: Fails when user has not granted permission (PERMISSION_REQUIRED).
 * Note: DebuggerManager itself does not check permissions — that is the job of
 * the relay handlers. DebuggerManager only manages the chrome.debugger lifecycle.
 *
 * API checklist:
 * - ensureAttached(tabId) → calls chrome.debugger.attach, handles "already attached"
 * - detach(tabId) → calls chrome.debugger.detach
 * - detachAll() → detaches all tabs
 * - isAttached(tabId) → checks in-memory Set
 * - sendCommand(tabId, method, params?) → calls chrome.debugger.sendCommand
 * - onDetach listener → registered on attach, cleaned up on detach
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resetChromeMocks,
  debuggerAttachedTabs,
} from "./setup/chrome-mock.js";
import {
  ensureAttached,
  detach,
  detachAll,
  isAttached,
  sendCommand,
} from "../src/debugger-manager.js";

describe("DebuggerManager", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  // ── isAttached ────────────────────────────────────────────────────────────────

  describe("isAttached", () => {
    it("returns false for tab that has never been attached", () => {
      expect(isAttached(1)).toBe(false);
    });

    it("returns true after ensureAttached(tabId) succeeds", async () => {
      await ensureAttached(1);
      expect(isAttached(1)).toBe(true);
    });

    it("returns false after detach(tabId) is called", async () => {
      await ensureAttached(1);
      await detach(1);
      expect(isAttached(1)).toBe(false);
    });

    it("returns true for multiple attached tabs", async () => {
      await ensureAttached(1);
      await ensureAttached(2);
      await ensureAttached(99);
      expect(isAttached(1)).toBe(true);
      expect(isAttached(2)).toBe(true);
      expect(isAttached(99)).toBe(true);
    });

    it("returns false for detached tab while others remain attached", async () => {
      await ensureAttached(1);
      await ensureAttached(2);
      await detach(1);
      expect(isAttached(1)).toBe(false);
      expect(isAttached(2)).toBe(true);
    });
  });

  // ── ensureAttached ────────────────────────────────────────────────────────────

  describe("ensureAttached", () => {
    it("calls chrome.debugger.attach with tabId and protocol version 1.3", async () => {
      await ensureAttached(5);
      expect(globalThis.chrome.debugger.attach).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 5 }),
        "1.3"
      );
    });

    it("is a no-op if tab is already attached (does not call chrome.debugger.attach again)", async () => {
      await ensureAttached(1);
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockClear();
      await ensureAttached(1); // same tab, already attached
      expect(globalThis.chrome.debugger.attach).not.toHaveBeenCalled();
    });

    it("adds tabId to internal attachedTabs set on successful attach", async () => {
      await ensureAttached(10);
      expect(debuggerAttachedTabs.has(10)).toBe(true);
    });

    it("MV3 recovery: treats 'Another debugger is already attached' error as successful attach", async () => {
      // Simulate the error that occurs when service worker restarts but Chrome
      // still has the debugger session alive
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (target: chrome.debugger.Debuggee, _version: string) => {
          // Even though we reject, Chrome says debugger IS attached
          debuggerAttachedTabs.add(target.tabId as number);
          return Promise.reject(new Error("Another debugger is already attached to the tab with id: 7"));
        }
      );

      // Should not throw — recovery path
      await expect(ensureAttached(7)).resolves.not.toThrow();

      // Tab should be in attached set after recovery
      expect(isAttached(7)).toBe(true);
      expect(debuggerAttachedTabs.has(7)).toBe(true);
    });

    it("MV3 recovery: still registers onDetach listener after recovery", async () => {
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (target: chrome.debugger.Debuggee, _version: string) => {
          debuggerAttachedTabs.add(target.tabId as number);
          return Promise.reject(new Error("Another debugger is already attached to the tab with id: 8"));
        }
      );

      await ensureAttached(8);

      // onDetach listener should have been registered
      expect(globalThis.chrome.debugger.onDetach.addListener).toHaveBeenCalled();
    });

    it("throws 'unsupported-page' for chrome:// or devtools:// pages", async () => {
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_target: chrome.debugger.Debuggee, _version: string) => {
          return Promise.reject(new Error("Cannot attach to this target. Check if the tab is an extension page or a Chrome internal page."));
        }
      );

      await expect(ensureAttached(999)).rejects.toThrow("unsupported-page");
    });

    it("propagates unknown errors from chrome.debugger.attach", async () => {
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_target: chrome.debugger.Debuggee, _version: string) => {
          return Promise.reject(new Error("some unexpected error"));
        }
      );

      await expect(ensureAttached(6)).rejects.toThrow("some unexpected error");
    });

    it("registers chrome.debugger.onDetach listener on successful attach", async () => {
      await ensureAttached(3);
      expect(globalThis.chrome.debugger.onDetach.addListener).toHaveBeenCalled();
    });
  });

  // ── detach ───────────────────────────────────────────────────────────────────

  describe("detach", () => {
    it("calls chrome.debugger.detach with tabId", async () => {
      await ensureAttached(4);
      await detach(4);
      expect(globalThis.chrome.debugger.detach).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 4 })
      );
    });

    it("is a no-op if tab is not attached (does not throw)", async () => {
      // Should not throw — no-op
      await expect(detach(999)).resolves.not.toThrow();
    });

    it("removes tabId from internal attachedTabs set", async () => {
      await ensureAttached(11);
      expect(isAttached(11)).toBe(true);
      await detach(11);
      expect(isAttached(11)).toBe(false);
    });

    it("detaching one tab does not affect other attached tabs", async () => {
      await ensureAttached(1);
      await ensureAttached(2);
      await detach(1);
      expect(isAttached(1)).toBe(false);
      expect(isAttached(2)).toBe(true);
    });

    it("chrome.debugger.onDetach listener is cleaned up after detach", async () => {
      await ensureAttached(12);
      // The listener should have been registered
      expect(globalThis.chrome.debugger.onDetach.addListener).toHaveBeenCalled();
      // After detach, the listener should be removed
      await detach(12);
      expect(globalThis.chrome.debugger.onDetach.removeListener).toHaveBeenCalled();
    });
  });

  // ── detachAll ───────────────────────────────────────────────────────────────

  describe("detachAll", () => {
    it("detaches all tabs that are currently attached", async () => {
      await ensureAttached(1);
      await ensureAttached(2);
      await ensureAttached(3);
      await detachAll();
      expect(isAttached(1)).toBe(false);
      expect(isAttached(2)).toBe(false);
      expect(isAttached(3)).toBe(false);
    });

    it("calls chrome.debugger.detach for each attached tab", async () => {
      await ensureAttached(10);
      await ensureAttached(20);
      await detachAll();
      expect(globalThis.chrome.debugger.detach).toHaveBeenCalledTimes(2);
    });

    it("is a no-op when no tabs are attached", async () => {
      await detachAll(); // should not throw
      expect(globalThis.chrome.debugger.detach).not.toHaveBeenCalled();
    });
  });

  // ── sendCommand ─────────────────────────────────────────────────────────────

  describe("sendCommand", () => {
    it("calls chrome.debugger.sendCommand with tabId, method, and params", async () => {
      await ensureAttached(1);
      await sendCommand(1, "Page.navigate", { url: "https://example.com" });
      expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 1 }),
        "Page.navigate",
        { url: "https://example.com" }
      );
    });

    it("calls chrome.debugger.sendCommand without params when params omitted", async () => {
      await ensureAttached(2);
      await sendCommand(2, "Page.reload");
      expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 2 }),
        "Page.reload",
        undefined
      );
    });

    it("returns the CDP response from chrome.debugger.sendCommand", async () => {
      (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ frameId: "main" });
      await ensureAttached(3);
      const result = await sendCommand(3, "Page.getFrameTree");
      expect(result).toEqual({ frameId: "main" });
    });

    it("throws if debugger is not attached to the tab", async () => {
      // Tab 99 never attached
      await expect(sendCommand(99, "Page.navigate")).rejects.toThrow("Debugger not attached");
    });

    it("throws Error with message 'Debugger not attached' when tab not attached", async () => {
      try {
        await sendCommand(77, "Page.navigate");
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as Error).message).toBe("Debugger not attached");
      }
    });

    it("forwards CDP errors from chrome.debugger.sendCommand", async () => {
      (globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Protocol error: Target closed")
      );
      await ensureAttached(5);
      await expect(sendCommand(5, "Page.navigate")).rejects.toThrow("Protocol error: Target closed");
    });
  });

  // ── onDetach event listener ─────────────────────────────────────────────────

  describe("chrome.debugger.onDetach event", () => {
    it("ensureAttached registers onDetach listener for the tab", async () => {
      await ensureAttached(15);
      expect(globalThis.chrome.debugger.onDetach.addListener).toHaveBeenCalled();
    });

    it("detach removes onDetach listener for that tab", async () => {
      await ensureAttached(16);
      await detach(16);
      expect(globalThis.chrome.debugger.onDetach.removeListener).toHaveBeenCalled();
    });

    it("when chrome auto-detaches (tab closed), tab is removed from isAttached", async () => {
      await ensureAttached(20);

      // Simulate Chrome auto-detaching when tab is closed
      // The debugger mock's detach() calls all registered onDetach listeners
      const detachCalls = (globalThis.chrome.debugger.onDetach.addListener as ReturnType<typeof vi.fn>).mock.calls;
      expect(detachCalls.length).toBeGreaterThan(0);

      // Manually trigger detach to simulate tab close
      await globalThis.chrome.debugger.detach({ tabId: 20 });

      expect(isAttached(20)).toBe(false);
    });
  });
});
