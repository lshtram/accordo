import { beforeEach, describe, expect, it, vi } from "vitest";
import { forwardFrameAction } from "../src/relay-page-frame-runtime.js";
import { handleRemotePageUnderstandingAction } from "../src/relay-page-remote.js";
import { forwardToFrame, forwardToMainFrame, resolveTargetTabId } from "../src/relay-forwarder.js";

vi.mock("../src/relay-forwarder.js", () => ({
  resolveTargetTabId: vi.fn().mockResolvedValue(1),
  resolveRequestedUrl: vi.fn().mockResolvedValue("https://example.com"),
  forwardToMainFrame: vi.fn(),
  forwardToFrame: vi.fn(),
  reinjectAndForwardToFrame: vi.fn().mockResolvedValue(null),
  NO_CONTENT_SCRIPT: Symbol("no-content-script"),
}));

vi.mock("../src/relay-privacy.js", () => ({
  enrichWithAuditLog: vi.fn(),
  attachRedactionWarning: vi.fn(),
  isOriginBlockedByPolicy: vi.fn().mockReturnValue(false),
  parseOriginPolicy: vi.fn().mockReturnValue({}),
  applyRedaction: vi.fn().mockImplementation((data) => ({ data, redactionApplied: false })),
  mintAuditId: vi.fn().mockReturnValue("audit-001"),
}));

function inspectRequest(payload: Record<string, unknown>) {
  const frameHandler = vi.fn(async (req, _tabId, frameId) => ({
    requestId: req.requestId,
    success: true,
    data: { frameId },
  }));
  const promise = handleRemotePageUnderstandingAction(
    { requestId: "req-1", action: "inspect_element", payload },
    false,
    frameHandler,
  );
  return { promise, frameHandler };
}

describe("inspect_element relay routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveTargetTabId).mockResolvedValue(1);
    vi.mocked(forwardToMainFrame).mockResolvedValue({
      found: true,
      pageId: "page-001",
      pageUrl: "https://example.com",
    });
  });

  it("keeps main-frame uid targets on the main content-script path", async () => {
    vi.mocked(forwardToMainFrame).mockResolvedValue({ error: "snapshot-stale" });

    const { promise, frameHandler } = inspectRequest({ uid: "main:64", creationSnapshotId: "page-001:1" });
    const result = await promise;

    expect(frameHandler).not.toHaveBeenCalled();
    expect(forwardToMainFrame).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: false, error: "snapshot-stale", retryable: false });
  });

  it("keeps explicit frameId:'main' inspect requests on the main content-script path", async () => {
    vi.mocked(forwardToMainFrame).mockResolvedValue({ error: "snapshot-not-found" });

    const { promise, frameHandler } = inspectRequest({
      frameId: "main",
      ref: "ref-3",
      creationSnapshotId: "page-001:5",
    });
    const result = await promise;

    expect(frameHandler).not.toHaveBeenCalled();
    expect(forwardToMainFrame).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: false, error: "snapshot-not-found", retryable: false });
  });

  it("maps forwarded content-script inspect errors to relay failures", async () => {
    vi.mocked(forwardToMainFrame).mockResolvedValue({ error: "snapshot-not-found" });

    const { promise } = inspectRequest({ ref: "ref-123", creationSnapshotId: "page-001:999" });
    const result = await promise;

    expect(result).toMatchObject({ success: false, error: "snapshot-not-found", retryable: false });
  });

  it("maps iframe-routed content-script inspect errors to relay failures", async () => {
    vi.mocked(forwardToFrame).mockResolvedValue({ error: "snapshot-stale" });

    const result = await forwardFrameAction(
      { requestId: "req-2", action: "inspect_element", payload: { uid: "child-frame:64", creationSnapshotId: "page-001:1" } },
      1,
      7,
      "child-frame",
      false,
    );

    expect(result).toMatchObject({ success: false, error: "snapshot-stale", retryable: false });
  });
});
