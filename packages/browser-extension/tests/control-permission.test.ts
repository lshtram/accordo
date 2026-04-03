/**
 * control-permission.test.ts
 *
 * Tests for M110-TC — ControlPermission API
 * (hasPermission, grant, revoke, getGrantedTabs)
 *
 * Uses the chrome-mock from tests/setup/chrome-mock.ts which provides
 * an in-memory chrome.storage.session implementation.
 *
 * REQ-TC-016: PERMISSION_REQUIRED when hasPermission(tabId) returns false.
 * REQ-TC-017: TAB_NOT_FOUND when tabId refers to non-existent tab.
 *
 * API checklist:
 * - hasPermission(tabId) → true when granted, false when not granted
 * - grant(tabId) → stores tabId in chrome.storage.session
 * - revoke(tabId) → removes tabId from storage
 * - getGrantedTabs() → returns all currently granted tab IDs
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks, seedStorage } from "./setup/chrome-mock.js";
import {
  hasPermission,
  grant,
  revoke,
  getGrantedTabs,
} from "../src/control-permission.js";

describe("ControlPermission", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  // ── hasPermission ────────────────────────────────────────────────────────────

  describe("hasPermission", () => {
    it("REQ-TC-016: returns false when no permission granted (default state)", async () => {
      // Start with clean state — no permissions granted
      const result = await hasPermission(1);
      expect(result).toBe(false);
    });

    it("REQ-TC-016: returns true after grant() is called for that tab", async () => {
      await grant(1);
      const result = await hasPermission(1);
      expect(result).toBe(true);
    });

    it("REQ-TC-016: returns false after revoke() is called for that tab", async () => {
      await grant(1);
      await revoke(1);
      const result = await hasPermission(1);
      expect(result).toBe(false);
    });

    it("REQ-TC-016: returns false for tab that was never granted", async () => {
      await grant(1);
      const result = await hasPermission(2); // tab 2 never granted
      expect(result).toBe(false);
    });

    it("REQ-TC-016: tab-specific: granting tab 1 does not affect tab 2", async () => {
      await grant(1);
      expect(await hasPermission(1)).toBe(true);
      expect(await hasPermission(2)).toBe(false);
    });

    it("REQ-TC-016: multiple tabs can be granted independently", async () => {
      await grant(1);
      await grant(42);
      await grant(99);
      expect(await hasPermission(1)).toBe(true);
      expect(await hasPermission(42)).toBe(true);
      expect(await hasPermission(99)).toBe(true);
    });
  });

  // ── grant ───────────────────────────────────────────────────────────────────

  describe("grant", () => {
    it("REQ-TC-016: grant(tabId) stores the tabId in chrome.storage.session", async () => {
      await grant(7);
      const tabs = await getGrantedTabs();
      expect(tabs).toContain(7);
    });

    it("REQ-TC-016: calling grant twice for same tab is idempotent (no duplicate)", async () => {
      await grant(5);
      await grant(5);
      const tabs = await getGrantedTabs();
      expect(tabs.filter((t) => t === 5)).toHaveLength(1);
    });

    it("REQ-TC-016: grant sets badge text to 'CTL' on the granted tab", async () => {
      await grant(10);
      // Badge text is set via chrome.action.setBadgeText
      // We verify this via the chrome mock's call history
      const setBadgeTextCalls = (globalThis.chrome.action.setBadgeText as ReturnType<typeof vi.fn>).mock.calls;
      expect(setBadgeTextCalls[0][0]).toMatchObject({ text: "CTL", tabId: 10 });
    });

    it("REQ-TC-016: grant sets badge background color to #FF6600 (orange)", async () => {
      await grant(10);
      const setBadgeColorCalls = (globalThis.chrome.action.setBadgeBackgroundColor as ReturnType<typeof vi.fn>).mock.calls;
      expect(setBadgeColorCalls[0][0]).toMatchObject({ color: "#FF6600", tabId: 10 });
    });
  });

  // ── revoke ──────────────────────────────────────────────────────────────────

  describe("revoke", () => {
    it("REQ-TC-016: revoke(tabId) removes the tabId from chrome.storage.session", async () => {
      await grant(3);
      await revoke(3);
      const tabs = await getGrantedTabs();
      expect(tabs).not.toContain(3);
    });

    it("REQ-TC-016: revoke is idempotent — calling on un-granted tab is a no-op", async () => {
      // Should not throw
      await revoke(999);
      const tabs = await getGrantedTabs();
      expect(tabs).not.toContain(999);
    });

    it("REQ-TC-016: revoke clears the badge text (sets to empty string)", async () => {
      await grant(11);
      (globalThis.chrome.action.setBadgeText as ReturnType<typeof vi.fn>).mockClear();
      await revoke(11);
      const setBadgeTextCalls = (globalThis.chrome.action.setBadgeText as ReturnType<typeof vi.fn>).mock.calls;
      expect(setBadgeTextCalls[0][0]).toMatchObject({ text: "", tabId: 11 });
    });

    it("REQ-TC-016: revoking one tab does not affect other granted tabs", async () => {
      await grant(1);
      await grant(2);
      await revoke(1);
      expect(await hasPermission(1)).toBe(false);
      expect(await hasPermission(2)).toBe(true);
    });
  });

  // ── getGrantedTabs ───────────────────────────────────────────────────────────

  describe("getGrantedTabs", () => {
    it("REQ-TC-016: returns empty array when no permissions granted", async () => {
      const tabs = await getGrantedTabs();
      expect(tabs).toEqual([]);
    });

    it("REQ-TC-016: returns all granted tab IDs", async () => {
      await grant(10);
      await grant(20);
      await grant(30);
      const tabs = await getGrantedTabs();
      expect(tabs).toEqual(expect.arrayContaining([10, 20, 30]));
      expect(tabs).toHaveLength(3);
    });

    it("REQ-TC-016: returns empty array after all tabs are revoked", async () => {
      await grant(1);
      await grant(2);
      await revoke(1);
      await revoke(2);
      const tabs = await getGrantedTabs();
      expect(tabs).toEqual([]);
    });
  });

  // ── Persistence ───────────────────────────────────────────────────────────────

  describe("chrome.storage.session persistence", () => {
    it("grant persists across getGrantedTabs calls within same session", async () => {
      await grant(55);
      const tabs1 = await getGrantedTabs();
      const tabs2 = await getGrantedTabs();
      expect(tabs1).toEqual(tabs2);
      expect(tabs1).toContain(55);
    });

    it("getGrantedTabs reads from chrome.storage.session (not in-memory only)", async () => {
      // Seed storage directly to simulate a previously granted tab
      seedStorage({ controlGrantedTabs: [77, 88] });
      const tabs = await getGrantedTabs();
      expect(tabs).toContain(77);
      expect(tabs).toContain(88);
    });
  });
});
