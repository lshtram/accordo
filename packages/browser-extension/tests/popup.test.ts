/**
 * M80-POP — popup.test.ts
 *
 * Tests for the Extension Popup UI.
 * Runs in jsdom environment. Uses mock chrome.runtime.sendMessage.
 *
 * Protects: BR-F-100 through BR-F-108
 *
 * API checklist:
 * ✓ renderThreadList — 4 tests
 * ✓ sendExportMessage — 1 test
 * ✓ sendToggleMessage — 1 test
 * ✓ updateBadgeCount — 2 tests
 * ✓ initPopup — 2 tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks, setPendingSendMessageRejection } from "./setup/chrome-mock.js";
import type { BrowserCommentThread } from "../src/types.js";
import {
  renderThreadList,
  sendExportMessage,
  sendExportJsonMessage,
  sendToggleMessage,
  updateBadgeCount,
  initPopup,
  setCommentsModeState,
} from "../src/popup.js";

/** Factory for a minimal thread */
function makeThread(id: string): BrowserCommentThread {
  return {
    id,
    anchorKey: `div:0:${id}`,
    pageUrl: "https://example.com/page",
    status: "open",
    comments: [
      {
        id: `${id}-c0`,
        threadId: id,
        createdAt: new Date().toISOString(),
        author: { kind: "user", name: "Alice" },
        body: "First comment",
        anchorKey: `div:0:${id}`,
        pageUrl: "https://example.com/page",
        status: "open",
      },
    ],
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
}

function makeThreadWithReplies(id: string): BrowserCommentThread {
  const thread = makeThread(id);
  thread.comments.push({
    id: `${id}-c1`,
    threadId: id,
    createdAt: new Date().toISOString(),
    author: { kind: "user", name: "Bob" },
    body: "Reply message",
    anchorKey: `div:0:${id}`,
    pageUrl: "https://example.com/page",
    status: "open",
  });
  return thread;
}

describe("M80-POP — Popup UI", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetChromeMocks();
    document.body.innerHTML = "";
    container = document.createElement("div");
    container.id = "accordo-popup-root";
    document.body.appendChild(container);
  });

  describe("renderThreadList", () => {
    it("BR-F-100: renders thread items for each active thread", () => {
      // BR-F-100: Popup displays active threads list
      const threads = [makeThread("t001"), makeThread("t002")];
      renderThreadList(container, threads);
      const items = container.querySelectorAll("[data-thread-id]");
      expect(items.length).toBe(2);
    });

    it("BR-F-108: shows 'No comments' message when threads array is empty", () => {
      // BR-F-108: Empty state message when no threads exist
      renderThreadList(container, []);
      expect(container.textContent?.toLowerCase()).toContain("no comment");
    });

    it("BR-F-100: each thread item shows thread id or anchor info", () => {
      // BR-F-100: Thread items are individually identifiable
      const threads = [makeThread("t003")];
      renderThreadList(container, threads);
      const item = container.querySelector('[data-thread-id="t003"]');
      expect(item).not.toBeNull();
    });

    it("BR-F-100: each thread item shows latest comment text preview", () => {
      const threads = [makeThread("t004")];
      renderThreadList(container, threads);
      expect(container.textContent).toContain("First comment");
    });

    it("BR-F-100: each thread item shows reply count when replies exist", () => {
      const threads = [makeThreadWithReplies("t005")];
      renderThreadList(container, threads);
      expect((container.textContent ?? "").toLowerCase()).toContain("1 reply");
    });

    it("BR-F-106: popup header shows Comments Mode state after init", async () => {
      // BR-F-106: State label appears in popup header after init
      await initPopup(container);
      const stateLabel = container.querySelector("#accordo-state-label");
      expect(stateLabel).not.toBeNull();
      // State label should say "Comments Mode: ON" or "Comments Mode: OFF"
      expect(stateLabel!.textContent).toMatch(/Comments Mode: (ON|OFF)/);
    });
  });

  describe("sendExportMessage", () => {
    it("BR-F-103: sends EXPORT message to service worker via chrome.runtime.sendMessage", async () => {
      // BR-F-103: Export button click triggers EXPORT message
      await sendExportMessage();
      expect(chrome.runtime.sendMessage).toHaveBeenCalled();
      const sentMessage = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as { type: string };
      expect(typeof sentMessage.type).toBe("string");
      expect(sentMessage.type).toContain("EXPORT");
    });
  });

  describe("sendExportJsonMessage (BR-F-104)", () => {
    it("BR-F-104: sends EXPORT message with JSON format to service worker", async () => {
      // BR-F-104: JSON export button click triggers EXPORT message with format: "json"
      await sendExportJsonMessage();
      expect(chrome.runtime.sendMessage).toHaveBeenCalled();
      const sentMessage = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as { type: string; payload: { format: string } };
      expect(sentMessage.type).toContain("EXPORT");
      expect(sentMessage.payload?.format).toBe("json");
    });

    it("BR-F-104: JSON export button is present in the popup", async () => {
      // BR-F-104: Popup has a distinct 'Copy as JSON' button
      // When initPopup renders, the JSON export button should be in the DOM
      await initPopup(container);
      const jsonBtn = container.querySelector("#accordo-export-json");
      expect(jsonBtn).not.toBeNull();
    });
  });

  describe("sendToggleMessage", () => {
    it("BR-F-105: sends TOGGLE_COMMENTS_MODE message to service worker", async () => {
      // BR-F-105: Comments Mode toggle sends message to SW
      await sendToggleMessage();
      expect(chrome.runtime.sendMessage).toHaveBeenCalled();
      const sentMessage = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as { type: string };
      expect(sentMessage.type).toContain("TOGGLE");
    });
  });

  describe("updateBadgeCount", () => {
    it("BR-F-106: updates badge element with correct thread count", () => {
      // BR-F-106: Popup badge reflects off-screen comment count
      updateBadgeCount(container, 5);
      const badge = container.querySelector("[data-accordo-badge]");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe("5");
    });

    it("BR-F-106: badge shows 0 when count is 0", () => {
      // BR-F-106: Off-screen count of 0 means no badge
      updateBadgeCount(container, 0);
      const badge = container.querySelector("[data-accordo-badge]");
      expect(badge?.textContent).toBe("0");
    });
  });

  describe("initPopup", () => {
    it("BR-F-100: renders the thread list or empty state after loading", async () => {
      // BR-F-100: initPopup fetches and renders threads
      await initPopup(container);
      // After init, container must have rendered content:
      // either thread items (data-thread-id) OR the empty state message
      const hasThreadItems = container.querySelectorAll("[data-thread-id]").length > 0;
      const hasEmptyState = (container.textContent ?? "").toLowerCase().includes("no comment");
      expect(hasThreadItems || hasEmptyState).toBe(true);
    });

    it("BR-F-105: wires up export and toggle buttons", async () => {
      // BR-F-105: Popup initializes both export and toggle button handlers
      await initPopup(container);
      const exportBtn = container.querySelector("#accordo-export-md");
      const toggleBtn = container.querySelector("#accordo-toggle");
      expect(exportBtn).not.toBeNull();
      expect(toggleBtn).not.toBeNull();
    });
  });

  describe("setCommentsModeState — content script injection fallback", () => {
    it("when first tabs.sendMessage rejects with no receiver, attempts injection and retries", async () => {
      // Arrange: simulate "no receiver" on first sendMessage call, then succeed on retry
      setPendingSendMessageRejection(new Error("Receiving end does not exist"));

      // Act: call setCommentsModeState with the mock rejecting once then succeeding
      await setCommentsModeState(1, true);

      // Assert: scripting.executeScript was called to inject content script
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 1 },
          files: ["content-script.js"],
        })
      );
      // Assert: scripting.insertCSS was called to inject styles
      expect(chrome.scripting.insertCSS).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 1 },
          files: ["content-styles.css"],
        })
      );
      // Assert: tabs.sendMessage was called twice (initial + retry)
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
      // Assert: storage was updated
      const storageResult = await chrome.storage.local.get("commentsMode");
      expect((storageResult["commentsMode"] as Record<number, boolean>)[1]).toBe(true);
      // Assert: badge was updated
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "ON", tabId: 1 });
    });

    it("when injection throws (restricted tab), popup does not crash and keeps graceful behavior", async () => {
      // Arrange: first sendMessage rejects, and injection also rejects (restricted tab)
      setPendingSendMessageRejection(new Error("Receiving end does not exist"));
      (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Cannot access tab with id 999")
      );

      // Act & Assert: should not throw — recovery failure is silent
      await expect(setCommentsModeState(999, true)).resolves.toBeUndefined();

      // Assert: tabs.sendMessage was called only once (initial, not retried after injection failure)
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
      // Assert: storage was still updated (graceful degradation — state is saved)
      const storageResult = await chrome.storage.local.get("commentsMode");
      expect((storageResult["commentsMode"] as Record<number, boolean>)[999]).toBe(true);
    });
  });
});
