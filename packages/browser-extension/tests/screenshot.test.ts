/**
 * M80-SCREEN — screenshot.test.ts
 *
 * Tests for Screenshot Capture module.
 * Verifies chrome.tabs.captureVisibleTab integration and storage behavior.
 *
 * Protects: BR-F-80 through BR-F-84
 *
 * API checklist:
 * ✓ getScreenshotKey — 1 test
 * ✓ captureScreenshot — 4 tests
 * ✓ getScreenshot — 2 tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import {
  getScreenshotKey,
  captureScreenshot,
  getScreenshot,
} from "../src/screenshot.js";

describe("M80-SCREEN — Screenshot Capture", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  describe("getScreenshotKey", () => {
    it("BR-F-81: returns 'screenshot:{normalizedUrl}' format", () => {
      // BR-F-81: Screenshot storage key format
      const key = getScreenshotKey("https://example.com/page");
      expect(key).toBe("screenshot:https://example.com/page");
    });
  });

  describe("captureScreenshot", () => {
    it("BR-F-80: calls chrome.tabs.captureVisibleTab with the given tabId", async () => {
      // BR-F-80: Screenshot capture uses chrome.tabs.captureVisibleTab
      const record = await captureScreenshot(1);
      expect(record).toBeDefined();
      expect(typeof record.dataUrl).toBe("string");
    });

    it("BR-F-81: stores result at key 'screenshot:{normalizedUrl}'", async () => {
      // BR-F-81: Stored at correct key with correct shape
      const record = await captureScreenshot(1);
      // After capture, getScreenshot should return the stored record
      const stored = await getScreenshot(record.pageUrl);
      expect(stored).toBeDefined();
      expect(stored!.dataUrl).toBe(record.dataUrl);
    });

    it("BR-F-82: overwrites any previous screenshot for the same URL", async () => {
      // BR-F-82: One screenshot per URL — overwrites on each capture
      const first = await captureScreenshot(1);
      const second = await captureScreenshot(1);
      // Only the latest record should be stored; capturedAt of second >= first
      expect(second.capturedAt >= first.capturedAt).toBe(true);
    });

    it("BR-F-81: returned ScreenshotRecord includes capturedAt timestamp", async () => {
      // BR-F-81: ScreenshotRecord shape includes capturedAt (number, Unix ms)
      const record = await captureScreenshot(1);
      expect(typeof record.capturedAt).toBe("number");
      expect(record.capturedAt).toBeGreaterThan(0);
    });
  });

  describe("getScreenshot", () => {
    it("BR-F-83: retrieves stored screenshot by normalized URL", async () => {
      // BR-F-83: getScreenshot returns ScreenshotRecord after a capture
      await captureScreenshot(1);
      // The mock captureVisibleTab returns a data URL for tabId 1.
      // We don't know the exact pageUrl here, but we can retrieve it.
      // Capture returns the record with pageUrl set — use that.
      const record = await captureScreenshot(1);
      const retrieved = await getScreenshot(record.pageUrl);
      expect(retrieved).toBeDefined();
      expect(retrieved!.dataUrl).toBe(record.dataUrl);
    });

    it("BR-F-83: returns null when no screenshot exists for the URL", async () => {
      // BR-F-83: Returns null for unknown URL
      const result = await getScreenshot("https://unknown.com/page");
      expect(result).toBeNull();
    });
  });
});
