import { beforeEach, describe, expect, it, vi } from "vitest";
import { forwardToFrame } from "../src/relay-forwarder-messaging.js";
import { resetChromeMocks } from "./setup/chrome-mock.js";

describe("relay forwarder error envelopes", () => {
  beforeEach(() => {
    resetChromeMocks();
    vi.clearAllMocks();
  });

  it("preserves content-script error envelopes for relay remapping", async () => {
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValueOnce({ error: "snapshot-stale" });

    const result = await forwardToFrame(1, 0, "inspect_element", { uid: "main:64", creationSnapshotId: "page-001:1" });

    expect(result).toEqual({ error: "snapshot-stale" });
  });
});
