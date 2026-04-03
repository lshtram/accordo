/**
 * debugger-manager-attach.test.ts
 *
 * Tests for M110-TC — debugger-manager ensureAttached() MV3 recovery
 *
 * Tests the ensureAttached() function in debugger-manager.ts with
 * specific focus on the MV3 service worker restart recovery logic.
 *
 * Recovery strategy (§5.2 of architecture):
 * 1. Tab already in Set → no-op (fast path)
 * 2. "Another debugger is already attached" error → treat as success, add to Set
 * 3. "Cannot attach to this target" error → throw "unsupported-page"
 * 4. Other errors → rethrow
 *
 * NC-NEW-1 note: The exact Chrome error message is "Another debugger is already
 * attached to the tab with id: N". The includes() check handles partial matching.
 *
 * API checklist (ensureAttached):
 * - already-attached (in Set) → no-op, no chrome.debugger.attach call
 * - fresh attach → calls chrome.debugger.attach, adds to Set
 * - MV3 recovery "already attached" → treats as success, adds to Set
 * - MV3 recovery → still registers onDetach listener after recovery
 * - "Cannot attach to this target" → throws Error("unsupported-page")
 * - other error → rethrows the error
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks, debuggerAttachedTabs } from "./setup/chrome-mock.js";
import { ensureAttached, isAttached } from "../src/debugger-manager.js";

describe("ensureAttached — MV3 service worker restart recovery", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  describe("already-attached fast path", () => {
    it("already-attached: is a no-op if tab is already in internal Set", async () => {
      // First attach
      await ensureAttached(1);
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockClear();

      // Second attach attempt — should be no-op
      await ensureAttached(1);

      expect(globalThis.chrome.debugger.attach).not.toHaveBeenCalled();
    });

    it("already-attached: tab is already attached → isAttached returns true", async () => {
      await ensureAttached(1);
      expect(isAttached(1)).toBe(true);

      // Try again
      await ensureAttached(1);
      expect(isAttached(1)).toBe(true);
    });
  });

  describe("MV3 recovery — 'Another debugger is already attached'", () => {
    it("MV3 recovery: 'Another debugger is already attached' error → treats as successful attach", async () => {
      // Chrome returns this error when SW restarts but debugger session persists
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (target: chrome.debugger.Debuggee, _version: string) => {
          // Even though we reject, Chrome says debugger IS attached
          debuggerAttachedTabs.add(target.tabId as number);
          return Promise.reject(
            new Error("Another debugger is already attached to the tab with id: 7")
          );
        }
      );

      // Should NOT throw — recovery path
      await expect(ensureAttached(7)).resolves.not.toThrow();
    });

    it("MV3 recovery: tab is added to internal Set after recovery", async () => {
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (target: chrome.debugger.Debuggee, _version: string) => {
          debuggerAttachedTabs.add(target.tabId as number);
          return Promise.reject(
            new Error("Another debugger is already attached to the tab with id: 8")
          );
        }
      );

      await ensureAttached(8);
      expect(isAttached(8)).toBe(true);
      expect(debuggerAttachedTabs.has(8)).toBe(true);
    });

    it("MV3 recovery: still registers onDetach listener after recovery", async () => {
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (target: chrome.debugger.Debuggee, _version: string) => {
          debuggerAttachedTabs.add(target.tabId as number);
          return Promise.reject(
            new Error("Another debugger is already attached to the tab with id: 9")
          );
        }
      );

      await ensureAttached(9);

      // onDetach listener should have been registered
      expect(globalThis.chrome.debugger.onDetach.addListener).toHaveBeenCalled();
    });

    it("MV3 recovery: after recovery, subsequent attach is a no-op", async () => {
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (target: chrome.debugger.Debuggee, _version: string) => {
          debuggerAttachedTabs.add(target.tabId as number);
          return Promise.reject(
            new Error("Another debugger is already attached to the tab with id: 10")
          );
        }
      );

      // First call triggers recovery
      await ensureAttached(10);
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockClear();

      // Second call should be no-op since now in Set
      await ensureAttached(10);
      expect(globalThis.chrome.debugger.attach).not.toHaveBeenCalled();
    });

    it("MV3 recovery: partial match on error message still works (includes check)", async () => {
      // The error message contains "to the tab" — using includes() handles partial matching
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (target: chrome.debugger.Debuggee, _version: string) => {
          debuggerAttachedTabs.add(target.tabId as number);
          return Promise.reject(
            new Error("Another debugger is already attached to the tab with id: 11")
          );
        }
      );

      await expect(ensureAttached(11)).resolves.not.toThrow();
      expect(isAttached(11)).toBe(true);
    });
  });

  describe("MV3 recovery — 'Cannot attach to this target'", () => {
    it("'Cannot attach to this target' error → throws Error('unsupported-page')", async () => {
      // Chrome returns this for chrome://, devtools:// pages
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_target: chrome.debugger.Debuggee, _version: string) => {
          return Promise.reject(
            new Error("Cannot attach to this target. Check if the tab is an extension page or a Chrome internal page.")
          );
        }
      );

      await expect(ensureAttached(999)).rejects.toThrow("unsupported-page");
    });

    it("'Cannot attach to this target' → tab is NOT added to internal Set", async () => {
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_target: chrome.debugger.Debuggee, _version: string) => {
          return Promise.reject(
            new Error("Cannot attach to this target. Check if the tab is an extension page or a Chrome internal page.")
          );
        }
      );

      try {
        await ensureAttached(999);
      } catch {
        // Expected to throw
      }

      expect(isAttached(999)).toBe(false);
    });
  });

  describe("MV3 recovery — unknown errors", () => {
    it("unknown error → rethrows the original error", async () => {
      const originalError = new Error("some unexpected error message");
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_target: chrome.debugger.Debuggee, _version: string) => {
          return Promise.reject(originalError);
        }
      );

      await expect(ensureAttached(6)).rejects.toThrow("some unexpected error message");
    });

    it("unknown error → tab is NOT added to internal Set", async () => {
      (globalThis.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_target: chrome.debugger.Debuggee, _version: string) => {
          return Promise.reject(new Error("connection refused"));
        }
      );

      try {
        await ensureAttached(12);
      } catch {
        // Expected to throw
      }

      expect(isAttached(12)).toBe(false);
    });
  });

  describe("fresh attach (no recovery needed)", () => {
    it("fresh attach → calls chrome.debugger.attach with protocol version 1.3", async () => {
      await ensureAttached(5);

      expect(globalThis.chrome.debugger.attach).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 5 }),
        "1.3"
      );
    });

    it("fresh attach → adds tabId to internal Set", async () => {
      await ensureAttached(20);

      expect(isAttached(20)).toBe(true);
      expect(debuggerAttachedTabs.has(20)).toBe(true);
    });

    it("fresh attach → registers onDetach listener", async () => {
      await ensureAttached(3);

      expect(globalThis.chrome.debugger.onDetach.addListener).toHaveBeenCalled();
    });
  });
});
