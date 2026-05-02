import { describe, expect, it, vi } from "vitest";

vi.mock("../relay-discovery.js", () => ({
  readSharedRelayInfo: vi.fn(() => ({
    port: 40111,
    pid: 12345,
    token: "shared-token-from-previous-relay",
    startedAt: "2026-05-01T20:00:00.000Z",
    ownerHubId: "owner-1",
  })),
}));

const { resolveRelayToken } = await import("../relay-lifecycle-primitives.js");

describe("relay token continuity", () => {
  it("reuses the previous shared relay token before generating a fresh token", async () => {
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
        store: vi.fn(async () => undefined),
      },
      globalState: {
        get: vi.fn(() => undefined),
        update: vi.fn(async () => undefined),
      },
    };

    await expect(resolveRelayToken(context as never)).resolves.toBe("shared-token-from-previous-relay");
    expect(context.secrets.store).toHaveBeenCalledWith("browserRelayToken", "shared-token-from-previous-relay");
  });
});
