import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareCaptureTab } from "../src/relay-capture-tab-target.js";
import { resetChromeMocks } from "./setup/chrome-mock.js";

describe("capture implicit target resolution", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it("uses the active tab in the last focused window when tabId is omitted", async () => {
    chrome.tabs.query = vi.fn().mockResolvedValue([
      { id: 22, url: "https://focused.example", active: true, windowId: 7 },
    ] as chrome.tabs.Tab[]);

    const context = await prepareCaptureTab();

    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(context).toEqual({ originalTabId: 22, targetTabId: 22, swapped: false });
  });
});
