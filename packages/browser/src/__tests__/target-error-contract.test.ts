import { describe, expect, it } from "vitest";
import { handleClick, handleType } from "../control-tools.js";
import { handleGetDomExcerpt, handleInspectElement } from "../page-understanding-tools.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";

function relay(error?: string) {
  return {
    request: async () => ({ success: false, error }),
    isConnected: () => true,
  } as any;
}

describe("target error contract", () => {
  it("query tools reject missing or malformed targets before relay", async () => {
    const store = new SnapshotRetentionStore();
    await expect(handleInspectElement(relay(), {}, store)).resolves.toMatchObject({ success: false, error: "no-target" });
    await expect(handleGetDomExcerpt(relay(), { selector: "div[" }, store)).resolves.toMatchObject({ success: false, error: "invalid-request" });
  });

  it("control tools add actionable guidance for known target failures", async () => {
    await expect(handleClick(relay("element-not-found"), { uid: "main:1" })).resolves.toMatchObject({ success: false, error: "element-not-found", agentAction: expect.any(String) });
    await expect(handleType(relay("iframe-cross-origin"), { text: "hi", uid: "child:7" })).resolves.toMatchObject({ success: false, error: "iframe-cross-origin", agentAction: expect.any(String) });
  });

  it("click ignores a malformed lower-priority selector when coordinates are present", async () => {
    const recorded: unknown[] = [];
    const relay = {
      request: async (...args: unknown[]) => {
        recorded.push(args);
        return { success: true, data: {} };
      },
      isConnected: () => true,
    } as any;

    const result = await handleClick(relay, { selector: "div[", coordinates: { x: 1, y: 2 } });

    expect(result).toMatchObject({ success: true, target: "1,2" });
    expect(recorded[0]).toEqual(["click", { coordinates: { x: 1, y: 2 } }, 5000]);
  });

  it("malformed framed uid is invalid-request, not no-target or action-failed", async () => {
    await expect(handleClick(relay(), { uid: "main:notnum" })).resolves.toMatchObject({ success: false, error: "invalid-request" });
    await expect(handleType(relay(), { text: "hi", uid: "main:notnum" })).resolves.toMatchObject({ success: false, error: "invalid-request" });
  });
});
