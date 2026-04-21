import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";

const loadThreads = vi.fn();

vi.mock("@accordo/comment-sdk", () => ({
  AccordoCommentSDK: class {
    init = vi.fn();
    destroy = vi.fn();
    loadThreads = loadThreads;
    openPopover = vi.fn();
  },
}));

import { destroySdk, loadAndRenderPins, wireSdkCallbacks } from "../src/content/comment-ui.js";

describe("comment-ui", () => {
  beforeEach(() => {
    resetChromeMocks();
    loadThreads.mockReset();
    document.body.innerHTML = "";
    destroySdk();
  });

  it("does not log an error when the SDK is destroyed while pins are loading", async () => {
    let resolveMessage: ((value: unknown) => void) | undefined;
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveMessage = resolve;
      })
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    wireSdkCallbacks({
      onCreate: async () => {},
      onReply: async () => {},
      onResolve: async () => {},
      onReopen: async () => {},
      onDelete: async () => {},
    });

    const pendingLoad = loadAndRenderPins();
    destroySdk();
    resolveMessage?.({
      success: true,
      data: [{
        id: "thread-1",
        anchorKey: "body:0:center",
        pageUrl: "https://example.com",
        status: "open",
        comments: [],
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      }],
    });

    await pendingLoad;

    expect(loadThreads).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("[Accordo CS ERROR] loadAndRenderPins: failed")
    );

    errorSpy.mockRestore();
  });
});
