import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";

const mockOpenSdkComposerAtAnchor = vi.fn();

vi.mock("../src/content/sdk-convergence.js", () => ({
  openSdkComposerAtAnchor: mockOpenSdkComposerAtAnchor,
}));

vi.mock("@accordo/comment-sdk", () => ({
  AccordoCommentSDK: class {
    init = vi.fn();
    loadThreads = vi.fn();
    destroy = vi.fn();
    openPopover = vi.fn();
  },
}));

describe("content-entry right-click anchor generation", () => {
  beforeEach(() => {
    vi.resetModules();
    resetChromeMocks();
    mockOpenSdkComposerAtAnchor.mockReset();
    document.body.innerHTML = "";
    document.title = "Test Page";

    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation((message: { type: string }) => {
      if (message.type === "GET_TAB_COMMENTS_MODE") {
        return Promise.resolve({ isOn: true });
      }
      if (message.type === "GET_THREADS") {
        return Promise.resolve({ success: true, data: [] });
      }
      return Promise.resolve({ success: true });
    });
  });

  it("uses enhanced anchor strategy for image-like element without stable identity", async () => {
    await import("../src/content/content-entry.js");
    await Promise.resolve();
    await Promise.resolve();

    const container = document.createElement("div");
    const image = document.createElement("img");
    container.appendChild(image);
    document.body.appendChild(container);

    image.getBoundingClientRect = () => ({
      x: 100,
      y: 160,
      width: 300,
      height: 200,
      top: 160,
      right: 400,
      bottom: 360,
      left: 100,
      toJSON: () => ({}),
    });

    image.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 142,
      clientY: 196,
    }));

    expect(mockOpenSdkComposerAtAnchor).toHaveBeenCalledTimes(1);
    const anchorKey = mockOpenSdkComposerAtAnchor.mock.calls[0][1] as string;
    expect(anchorKey).toMatch(/^body:\d+%x\d+%$/);
    expect(anchorKey).not.toMatch(/^img:\d+:/);
  });
});
