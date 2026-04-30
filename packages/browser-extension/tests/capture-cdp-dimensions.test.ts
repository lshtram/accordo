import { describe, expect, it, vi } from "vitest";
import { executeCaptureFullPage, executeCaptureViewport } from "../src/relay-capture-cdp-modes.js";

describe("CDP capture dimensions", () => {
  it("derives viewport capture dimensions from the snapshot envelope when CDP omits them", async () => {
    const sendCommand = globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>;
    sendCommand.mockImplementation(async (_target, method) => {
      if (method === "Page.captureScreenshot") return { data: "AAAA" };
      return {};
    });

    const result = await executeCaptureViewport({ mode: "viewport", tabId: 1 });

    expect(result.success).toBe(true);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.originalBounds).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it("derives full-page capture dimensions from Page.getLayoutMetrics when CDP screenshot omits them", async () => {
    const sendCommand = globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>;
    sendCommand.mockImplementation(async (_target, method) => {
      if (method === "Page.captureScreenshot") return { data: "AAAA" };
      if (method === "Page.getLayoutMetrics") return { contentSize: { width: 1440, height: 3200 } };
      return {};
    });

    const result = await executeCaptureFullPage({ mode: "fullPage", tabId: 1 });

    expect(result.success).toBe(true);
    expect(result.width).toBe(1440);
    expect(result.height).toBe(3200);
    expect(result.originalBounds).toEqual({ x: 0, y: 0, width: 1440, height: 3200 });
  });
});
