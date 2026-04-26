import { beforeEach, describe, expect, it, vi } from "vitest";
import * as captureBounds from "../src/relay-capture-bounds.js";
import * as forwarder from "../src/relay-forwarder.js";
import { executeCaptureRegion } from "../src/relay-capture-execution.js";
import { resetChromeMocks } from "./setup/chrome-mock.js";

describe("capture error normalization", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it("maps internal resolve errors to public capture codes", async () => {
    vi.spyOn(captureBounds, "resolvePaddedBounds").mockRejectedValue(new Error("missing"));
    vi.spyOn(captureBounds, "getResolveBoundsErrorCode").mockReturnValue("not-found");
    vi.spyOn(forwarder, "requestContentScriptEnvelope").mockResolvedValue({
      pageId: "p1",
      frameId: "main",
      snapshotId: "p1:1",
      capturedAt: "2025-01-01T00:00:00Z",
      viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "visual",
    });

    const result = await executeCaptureRegion({ anchorKey: "id:missing" } as never);

    expect(result.error).toBe("element-not-found");
    expect(result.error).not.toBe("not-found");
  });
});
