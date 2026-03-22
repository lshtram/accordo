import { describe, it, expect, vi } from "vitest";
import { forwardRelayAction } from "../relay-router.js";

describe("M82-RELAY request router", () => {
  it("BR-F-123: preserves relay response envelope", async () => {
    const relay = {
      request: vi.fn().mockResolvedValue({ requestId: "r1", success: true, data: { ok: true } }),
      isConnected: vi.fn(() => true),
    };

    const response = await forwardRelayAction(relay, "get_comments", { url: "https://example.com" }, 1000);
    expect(response).toEqual({ requestId: "r1", success: true, data: { ok: true } });
  });

  it("BR-F-125: maps thrown errors to action-failed", async () => {
    const relay = {
      request: vi.fn().mockRejectedValue(new Error("boom")),
      isConnected: vi.fn(() => true),
    };

    const response = await forwardRelayAction(relay, "get_comments", { url: "https://example.com" });
    expect(response.success).toBe(false);
    expect(response.error).toBe("action-failed");
  });
});
