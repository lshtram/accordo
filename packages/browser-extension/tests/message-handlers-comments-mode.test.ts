import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchRuntimeMessage, resetChromeMocks } from "./setup/chrome-mock.js";

vi.mock("@accordo/comment-sdk", () => ({
  AccordoCommentSDK: class {
    init = vi.fn();
    destroy = vi.fn();
    loadThreads = vi.fn();
    openPopover = vi.fn();
  },
}));

describe("message-handlers comments mode", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resetChromeMocks();
    document.body.innerHTML = "";
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ isOn: false });
  });

  it("does not log a require-is-not-defined error from the runtime message path", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await import("../src/content/message-handlers.js");

    void dispatchRuntimeMessage({ type: "comments-mode-off" });
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("require is not defined"));
    errorSpy.mockRestore();
  });

  it("does not log a require-is-not-defined error during bootstrap storage sync", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { runBootstrap } = await import("../src/content/message-handlers.js");

    runBootstrap();
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "GET_TAB_COMMENTS_MODE" });
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("require is not defined"));
    errorSpy.mockRestore();
  });
});
