/**
 * relay-actions-notify.test.ts — notify_comments_updated relay action
 *
 * Verifies:
 * - handleRelayAction with notify_comments_updated returns { success: true, data: { url } }
 * - handleRelayActionWithBroadcast with notify_comments_updated calls broadcastCommentsUpdated
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import { handleRelayAction } from "../src/relay-actions.js";

describe("relay-actions — notify_comments_updated", () => {
  beforeEach(() => {
    resetChromeMocks();
    vi.clearAllMocks();
  });

  /**
   * REQ-NOTIFY-01: handleRelayAction returns success:true with { url } data
   * when action is notify_comments_updated with a url.
   */
  it("REQ-NOTIFY-01: notify_comments_updated returns { success: true, data: { url } } when url provided", async () => {
    const response = await handleRelayAction({
      requestId: "req-notify-1",
      action: "notify_comments_updated",
      payload: { url: "https://example.com/page" },
    });

    expect(response).toHaveProperty("requestId", "req-notify-1");
    expect(response).toHaveProperty("success", true);
    expect(response).toHaveProperty("data");
    expect((response.data as { url?: string }).url).toBe("https://example.com/page");
  });

  /**
   * REQ-NOTIFY-02: handleRelayAction returns success:true with { url: undefined }
   * when notify_comments_updated has no url in payload.
   */
  it("REQ-NOTIFY-02: notify_comments_updated returns { success: true, data: { url: undefined } } when no url", async () => {
    const response = await handleRelayAction({
      requestId: "req-notify-2",
      action: "notify_comments_updated",
      payload: {},
    });

    expect(response).toHaveProperty("requestId", "req-notify-2");
    expect(response).toHaveProperty("success", true);
    expect(response).toHaveProperty("data");
    // url is undefined when not in payload
    expect((response.data as Record<string, unknown>)["url"]).toBeUndefined();
  });

  /**
   * REQ-NOTIFY-03: handleRelayActionWithBroadcast calls broadcastCommentsUpdated
   * (via chrome.runtime.sendMessage) when action is notify_comments_updated.
   *
   * We verify the broadcast by checking that chrome.runtime.sendMessage was called
   * with a COMMENTS_UPDATED message — this is what broadcastCommentsUpdated does.
   */
  it("REQ-NOTIFY-03: handleRelayActionWithBroadcast triggers broadcastCommentsUpdated for notify_comments_updated", async () => {
    // Import the service-worker to test handleRelayActionWithBroadcast indirectly
    // through the BROWSER_RELAY_ACTION message handler.
    const { handleMessage, MESSAGE_TYPES } = await import("../src/service-worker.js");

    const response = await handleMessage(
      {
        type: MESSAGE_TYPES.BROWSER_RELAY_ACTION,
        payload: {
          requestId: "req-notify-relay",
          action: "notify_comments_updated",
          payload: { url: "https://example.com/notify-test" },
        },
      },
      {} as chrome.runtime.MessageSender,
    );

    expect(response).toHaveProperty("success", true);

    // broadcastCommentsUpdated calls chrome.runtime.sendMessage with COMMENTS_UPDATED
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MESSAGE_TYPES.COMMENTS_UPDATED }),
    );
  });

  /**
   * REQ-NOTIFY-04: handleRelayActionWithBroadcast extracts url from data.url
   * (not data.pageUrl) for notify_comments_updated, and passes it to broadcast.
   */
  it("REQ-NOTIFY-04: broadcast uses url from data.url for notify_comments_updated", async () => {
    const { handleMessage, MESSAGE_TYPES } = await import("../src/service-worker.js");

    await handleMessage(
      {
        type: MESSAGE_TYPES.BROWSER_RELAY_ACTION,
        payload: {
          requestId: "req-notify-url",
          action: "notify_comments_updated",
          payload: { url: "https://specific.com/page" },
        },
      },
      {} as chrome.runtime.MessageSender,
    );

    // The broadcast should include the normalized url
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MESSAGE_TYPES.COMMENTS_UPDATED,
        payload: expect.objectContaining({ url: "https://specific.com/page" }),
      }),
    );
  });

  /**
   * BR-F-102: focus_thread matches tabs by normalized URL (origin + pathname),
   * activates the correct tab, focuses its window, and sends scroll-to-thread.
   */
  it("BR-F-102: focus_thread activates exact normalized-URL match and skips same-origin wrong path", async () => {
    const { createThread } = await import("../src/store.js");

    // Create a thread on a specific page path
    const thread = await createThread("https://example.com/products/widgets", "body:center", {
      body: "focus test",
      author: { kind: "user", name: "Alice" },
    });

    const correctTabId = 42;
    const wrongPathTabId = 77;

    // Mock chrome.tabs.query: one tab matches exact normalized URL, another has same origin but different path
    chrome.tabs.query = vi.fn().mockResolvedValue([
      { id: wrongPathTabId, url: "https://example.com/blog/post-123", windowId: 1, active: false },
      { id: correctTabId, url: "https://example.com/products/widgets", windowId: 2, active: false },
      { id: 99, url: "https://other.com/page", windowId: 3, active: true },
    ]);
    chrome.windows.update = vi.fn().mockResolvedValue({ id: 2 });
    chrome.tabs.update = vi.fn().mockResolvedValue({ id: correctTabId });
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue(undefined);

    const { handleRelayAction } = await import("../src/relay-actions.js");
    const response = await handleRelayAction({
      requestId: "req-focus-exact",
      action: "focus_thread",
      payload: { threadId: thread.id },
    });

    expect(response).toHaveProperty("success", true);
    expect(response).toHaveProperty("requestId", "req-focus-exact");

    // Window should be focused first (using correctTab's windowId = 2)
    expect(chrome.windows.update).toHaveBeenCalledWith(2, { focused: true });
    // Tab should then be activated
    expect(chrome.tabs.update).toHaveBeenCalledWith(correctTabId, { active: true });
    // scroll-to-thread should be sent to the correct tab (not wrongPathTabId)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(correctTabId, {
      type: "scroll-to-thread",
      payload: { threadId: thread.id },
    });
    // Wrong-path tab must NOT have been activated
    expect(chrome.tabs.update).not.toHaveBeenCalledWith(wrongPathTabId, expect.anything());
  });

  /**
   * BR-F-102: focus_thread activates tab and sends scroll-to-thread when windowId is unavailable
   * (chrome.windows.update is skipped gracefully).
   */
  it("BR-F-102: focus_thread works when tab has no windowId (window focus skipped)", async () => {
    const { createThread } = await import("../src/store.js");

    const thread = await createThread("https://example.com/only-tab", "body:center", {
      body: "focus no windowId",
      author: { kind: "user", name: "Bob" },
    });

    const tabId = 5;
    // Tab has no windowId
    chrome.tabs.query = vi.fn().mockResolvedValue([
      { id: tabId, url: "https://example.com/only-tab", windowId: undefined, active: false },
    ]);
    chrome.tabs.update = vi.fn().mockResolvedValue({ id: tabId });
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue(undefined);

    const { handleRelayAction } = await import("../src/relay-actions.js");
    const response = await handleRelayAction({
      requestId: "req-focus-no-window",
      action: "focus_thread",
      payload: { threadId: thread.id },
    });

    expect(response).toHaveProperty("success", true);
    // windows.update should NOT be called (no windowId)
    expect(chrome.windows.update).not.toHaveBeenCalled();
    // Tab should still be activated
    expect(chrome.tabs.update).toHaveBeenCalledWith(tabId, { active: true });
    // scroll-to-thread should be sent
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(tabId, {
      type: "scroll-to-thread",
      payload: { threadId: thread.id },
    });
  });

  /**
   * BR-F-102: focus_thread returns action-failed when no tab matches the normalized URL.
   */
  it("BR-F-102: focus_thread returns error when no tab matches normalized URL", async () => {
    const { createThread } = await import("../src/store.js");

    const thread = await createThread("https://example.com/unique-page-xyz", "body:center", {
      body: "unmatched",
      author: { kind: "user", name: "Carol" },
    });

    chrome.tabs.query = vi.fn().mockResolvedValue([
      { id: 1, url: "https://example.com/completely/different/path", windowId: 1, active: false },
    ]);

    const { handleRelayAction } = await import("../src/relay-actions.js");
    const response = await handleRelayAction({
      requestId: "req-focus-no-match",
      action: "focus_thread",
      payload: { threadId: thread.id },
    });

    expect(response).toHaveProperty("success", false);
    expect(response).toHaveProperty("error", "action-failed");
  });

  /**
   * BR-F-102: focus_thread returns action-failed when thread does not exist.
   */
  it("BR-F-102: focus_thread returns error when thread not found", async () => {
    const { handleRelayAction } = await import("../src/relay-actions.js");
    const response = await handleRelayAction({
      requestId: "req-focus-missing",
      action: "focus_thread",
      payload: { threadId: "non-existent-thread-id" },
    });

    expect(response).toHaveProperty("success", false);
    expect(response).toHaveProperty("error", "action-failed");
  });
});
