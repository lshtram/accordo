import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRemotePageUnderstandingAction } from "../src/relay-page-remote.js";
import { forwardToMainFrame, resolveTargetTabId } from "../src/relay-forwarder.js";

vi.mock("../src/relay-forwarder.js", () => ({
  resolveTargetTabId: vi.fn().mockResolvedValue(1),
  resolveRequestedUrl: vi.fn().mockResolvedValue("https://example.com"),
  forwardToMainFrame: vi.fn(),
  reinjectAndForwardToFrame: vi.fn().mockResolvedValue(null),
  NO_CONTENT_SCRIPT: Symbol("no-content-script"),
}));

vi.mock("../src/relay-privacy.js", () => ({
  resolveRequestedUrl: vi.fn().mockReturnValue("https://example.com"),
  enrichWithAuditLog: vi.fn(),
  attachRedactionWarning: vi.fn(),
  isOriginBlockedByPolicy: vi.fn().mockReturnValue(false),
  parseOriginPolicy: vi.fn().mockReturnValue({}),
  applyRedaction: vi.fn().mockImplementation((data) => ({ data, redactionApplied: false })),
  mintAuditId: vi.fn().mockReturnValue("audit-001"),
}));

function request(payload: Record<string, unknown>) {
  const frameHandler = vi.fn(async (req, _tabId, frameId) => ({
    requestId: req.requestId,
    success: true,
    data: { frameId },
  }));
  const promise = handleRemotePageUnderstandingAction(
    { requestId: "req-1", action: "get_spatial_relations", payload },
    false,
    frameHandler,
  );
  return { promise, frameHandler };
}

describe("get_spatial_relations relay integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveTargetTabId).mockResolvedValue(1);
    vi.mocked(forwardToMainFrame).mockResolvedValue({ pageId: "page-001", pageUrl: "https://example.com" });
  });

  it("routes same-frame iframe uids[] through iframe handler", async () => {
    const { promise, frameHandler } = request({ snapshotId: "page-001:1", uids: ["iframe-embedded-0:1"] });
    const result = await promise;
    expect(frameHandler).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect((result.data as { frameId: string }).frameId).toBe("iframe-embedded-0");
  });

  it("keeps nodeIds[] on the main-frame path", async () => {
    const { promise, frameHandler } = request({ snapshotId: "page-001:1", nodeIds: [1, 2], frameId: "iframe-embedded-0", uid: "iframe-embedded-0:9" });
    const result = await promise;
    expect(frameHandler).not.toHaveBeenCalled();
    expect(forwardToMainFrame).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
  });

  it("preserves invalid-request for malformed and mixed spatial inputs", async () => {
    vi.mocked(forwardToMainFrame).mockResolvedValue({ error: "invalid-request" });

    const malformed = request({ snapshotId: "page-001:1", uids: ["invalid-no-colon"] });
    const mixedFrame = request({ snapshotId: "page-001:1", uids: ["main:1", "iframe-embedded-0:2"] });
    const mixedInput = request({ snapshotId: "page-001:1", nodeIds: [1], uids: ["main:2"] });

    const malformedResult = await malformed.promise;
    const mixedFrameResult = await mixedFrame.promise;
    const mixedInputResult = await mixedInput.promise;

    expect(malformed.frameHandler).not.toHaveBeenCalled();
    expect(mixedFrame.frameHandler).not.toHaveBeenCalled();
    expect(mixedInput.frameHandler).not.toHaveBeenCalled();
    expect(malformedResult).toMatchObject({ success: false, error: "invalid-request", retryable: false });
    expect(mixedFrameResult).toMatchObject({ success: false, error: "invalid-request", retryable: false });
    expect(mixedInputResult).toMatchObject({ success: false, error: "invalid-request", retryable: false });
  });
});
