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
});
