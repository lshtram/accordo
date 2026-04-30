import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveControlFrameTarget } from "../src/relay-control-frame-target.js";
import { resetChromeMocks } from "./setup/chrome-mock.js";

describe("control frame target classification", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it("returns iframe-cross-origin for cross-origin frame uids", async () => {
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue({ data: { iframes: [{ frameId: "child", sameOrigin: false, bounds: { x: 0, y: 0, width: 10, height: 10 } }] } });
    const result = await resolveControlFrameTarget(1, "child:7");
    expect(result).toEqual({ ok: false, error: "iframe-cross-origin" });
  });

  it("returns element-not-found when frame mapping is missing", async () => {
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue({ data: { iframes: [] } });
    const result = await resolveControlFrameTarget(1, "missing:7");
    expect(result).toEqual({ ok: false, error: "element-not-found" });
  });

  it("returns no-content-script when same-origin iframe metadata exists but frame path cannot be queried", async () => {
    chrome.tabs.sendMessage = vi.fn().mockImplementation(async (_tabId, message, options) => {
      if (!options?.frameId && (message as { action?: string }).action === "get_page_map") {
        return { data: { iframes: [{ frameId: "child", sameOrigin: true, bounds: { x: 0, y: 0, width: 10, height: 10 } }] } };
      }
      return undefined;
    });
    chrome.webNavigation.getAllFrames = vi.fn().mockResolvedValue([{ frameId: 0 }, { frameId: 7 }] as chrome.webNavigation.GetAllFrameResultDetails[]);
    const result = await resolveControlFrameTarget(1, "child:7");
    expect(result).toEqual({ ok: false, error: "no-content-script" });
  });

  it("does not route malformed framed uid suffixes to the main frame", async () => {
    const result = await resolveControlFrameTarget(1, "https://example.test/frame:12junk");
    expect(result).toEqual({ ok: false, error: "element-not-found" });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
