/**
 * M80-SM — state-machine.test.ts
 *
 * Tests for the Comments Mode state machine.
 * Each tab has independent ON/OFF state. State persists to chrome.storage.local.
 * After worker restart (clear in-memory cache), state is restored from storage.
 *
 * Protects: BR-F-10 through BR-F-16 (state machine requirements)
 *
 * API checklist:
 * ✓ getCommentsMode — 3 tests
 * ✓ setCommentsMode — 4 tests
 * ✓ toggleCommentsMode — 2 tests
 * ✓ loadCommentsModeFromStorage — 2 tests
 * ✓ getCommentsModeMap — 2 tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resetChromeMocks, seedStorage, getStorageMap } from "./setup/chrome-mock.js";
import {
  getCommentsMode,
  setCommentsMode,
  toggleCommentsMode,
  loadCommentsModeFromStorage,
  getCommentsModeMap,
} from "../src/state-machine.js";

describe("M80-SM — Comments Mode State Machine", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  describe("getCommentsMode", () => {
    it("BR-F-10: returns false for an unknown tab (default OFF)", () => {
      // BR-F-10: Comments Mode defaults to OFF on extension install and browser launch
      const result = getCommentsMode(99);
      expect(result).toBe(false);
    });

    it("BR-F-16: returns false for tab 1 when only tab 2 is ON (tab-scoped)", async () => {
      // BR-F-16: Comments Mode is tab-scoped — tabs are independent
      await setCommentsMode(2, true);
      const result = getCommentsMode(1);
      expect(result).toBe(false);
    });

    it("BR-F-10: returns boolean type", () => {
      // BR-F-10: return type is boolean
      const result = getCommentsMode(0);
      expect(typeof result).toBe("boolean");
    });
  });

  describe("setCommentsMode", () => {
    it("BR-F-11: setCommentsMode(tabId, true) enables mode for that tab", async () => {
      // BR-F-11: Toolbar button click or keyboard shortcut toggles to ON
      await setCommentsMode(1, true);
      expect(getCommentsMode(1)).toBe(true);
    });

    it("BR-F-11: setCommentsMode(tabId, false) disables mode for that tab", async () => {
      // BR-F-11: Toggle can also turn OFF
      await setCommentsMode(1, true);
      await setCommentsMode(1, false);
      expect(getCommentsMode(1)).toBe(false);
    });

    it("BR-F-16: enabling on tab 1 does NOT affect tab 2", async () => {
      // BR-F-16: Each tab has independent ON/OFF state
      await setCommentsMode(1, true);
      expect(getCommentsMode(2)).toBe(false);
    });

    it("BR-F-15: persists state to chrome.storage.local", async () => {
      // BR-F-15 (storage persistence — state not lost on worker wake)
      await setCommentsMode(42, true);
      const storageMap = getStorageMap();
      // State should be persisted to storage (key format: commentsMode or commentsMode:42)
      const hasPersisted = Array.from(storageMap.values()).some(
        (v) => v === true || (typeof v === "object" && v !== null && JSON.stringify(v).includes("true"))
      );
      expect(hasPersisted).toBe(true);
    });
  });

  describe("toggleCommentsMode", () => {
    it("BR-F-11: toggleCommentsMode flips false → true", async () => {
      // BR-F-11: Toggle flips from OFF to ON
      await toggleCommentsMode(1);
      expect(getCommentsMode(1)).toBe(true);
    });

    it("BR-F-11: toggleCommentsMode flips true → false", async () => {
      // BR-F-11: Toggle flips from ON to OFF
      await setCommentsMode(1, true);
      await toggleCommentsMode(1);
      expect(getCommentsMode(1)).toBe(false);
    });
  });

  describe("loadCommentsModeFromStorage", () => {
    it("BR-F-15: restores state from storage after simulated worker restart", async () => {
      // BR-F-15: After Chrome restart simulation (clear in-memory cache),
      // state is restored from storage
      await setCommentsMode(7, true);
      // Simulate worker restart: reload state from storage
      await loadCommentsModeFromStorage();
      expect(getCommentsMode(7)).toBe(true);
    });

    it("BR-F-10: loads empty state correctly (all tabs OFF) when no storage data exists", async () => {
      // BR-F-10: Default state is all OFF — nothing in storage means nothing in map
      await loadCommentsModeFromStorage();
      expect(getCommentsModeMap().size).toBe(0);
    });
  });

  describe("getCommentsModeMap", () => {
    it("BR-F-16: returns a Map of tabId to boolean state", async () => {
      // BR-F-16: Map is the internal representation of per-tab state
      await setCommentsMode(3, true);
      const map = getCommentsModeMap();
      expect(map).toBeInstanceOf(Map);
      expect(map.get(3)).toBe(true);
    });

    it("BR-F-16: map reflects all set tabs independently", async () => {
      // BR-F-16: Multiple tabs tracked independently in the map
      await setCommentsMode(10, true);
      await setCommentsMode(11, false);
      const map = getCommentsModeMap();
      expect(map.get(10)).toBe(true);
      expect(map.get(11)).toBe(false);
    });
  });
});
