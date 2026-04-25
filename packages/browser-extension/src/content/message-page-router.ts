import { getLogicalFrameId, toInspectPayload } from "./message-action-helpers.js";

export async function handlePageUnderstandingActionMessage(
  action: string,
  payload: Record<string, unknown>,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    let data: unknown;
    if (action === "get_page_map") {
      const { collectPageMap } = await import("./page-map-collector.js");
      data = collectPageMap(payload as Parameters<typeof collectPageMap>[0]);
      const { defaultStore, isVersionedSnapshot } = await import("../relay-definitions.js");
      if (isVersionedSnapshot(data)) {
        await defaultStore.save((data as { pageId: string }).pageId, data as Parameters<typeof defaultStore.save>[1]);
      }
    } else if (action === "inspect_element") {
      const { inspectElement } = await import("./element-inspector.js");
      data = inspectElement(toInspectPayload(payload));
    } else if (action === "get_dom_excerpt") {
      const { getDomExcerpt } = await import("./element-inspector.js");
      const { selector, anchorKey, creationSnapshotId, maxDepth, maxLength } = payload as {
        selector?: string;
        anchorKey?: string;
        creationSnapshotId?: string;
        maxDepth?: number;
        maxLength?: number;
      };
      data = getDomExcerpt({ selector, anchorKey, creationSnapshotId }, maxDepth, maxLength);
    } else if (action === "wait_for") {
      const { handleWaitForAction } = await import("./wait-provider.js");
      data = await handleWaitForAction(payload);
    } else if (action === "get_text_map") {
      const { collectTextMap } = await import("./text-map-collector.js");
      data = collectTextMap(payload as Parameters<typeof collectTextMap>[0]);
    } else if (action === "get_semantic_graph") {
      const { collectSemanticGraph } = await import("./semantic-graph-collector.js");
      data = collectSemanticGraph(payload as Parameters<typeof collectSemanticGraph>[0]);
    } else if (action === "get_frame_path") {
      data = { frameId: getLogicalFrameId() };
    } else if (action === "get_spatial_relations") {
      const { handleGetSpatialRelationsAction } = await import("./spatial-relations-handler.js");
      const result = handleGetSpatialRelationsAction(payload);
      if ("error" in result) {
        sendResponse({ error: result.error });
        return;
      }
      data = result.data;
    } else if (action === "diff_snapshots") {
      const { defaultStore } = await import("../relay-definitions.js");
      const { computeDiff } = await import("../diff-engine.js");
      const fromId = typeof payload.fromSnapshotId === "string" ? payload.fromSnapshotId : undefined;
      const toId = typeof payload.toSnapshotId === "string" ? payload.toSnapshotId : undefined;
      if (!fromId || !toId) {
        sendResponse({ error: "invalid-request" });
        return;
      }
      const fromResult = await defaultStore.get(fromId);
      if ("error" in fromResult) {
        sendResponse({ error: defaultStore.isStale(fromId) ? "snapshot-stale" : "snapshot-not-found" });
        return;
      }
      const toResult = await defaultStore.get(toId);
      if ("error" in toResult) {
        sendResponse({ error: defaultStore.isStale(toId) ? "snapshot-stale" : "snapshot-not-found" });
        return;
      }
      data = computeDiff(fromResult, toResult);
    } else {
      sendResponse({ error: "unsupported-action" });
      return;
    }
    sendResponse({ data });
  } catch {
    sendResponse({ error: "action-failed" });
  }
}

export async function handleCaptureSnapshotEnvelopeMessage(
  source: "dom" | "visual" | undefined,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    const { captureSnapshotEnvelope } = await import("../snapshot-versioning.js");
    sendResponse(captureSnapshotEnvelope(source ?? "dom"));
  } catch {
    sendResponse({ error: "envelope-failed" });
  }
}

export async function handleResolveAnchorBoundsMessage(
  anchorKey: string | undefined,
  nodeRef: string | undefined,
  padding: number | undefined,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    const { resolveAnchorKey } = await import("./enhanced-anchor.js");
    const { getElementByRef } = await import("./page-map-traversal.js");
    if (!anchorKey && !nodeRef) {
      sendResponse({ error: "no-ref" });
      return;
    }
    const element = nodeRef ? getElementByRef(nodeRef) : anchorKey ? resolveAnchorKey(anchorKey) : null;
    if (!element) {
      sendResponse({ error: "not-found" });
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) {
      sendResponse({ error: "element-off-screen" });
      return;
    }
    const pad = typeof padding === "number" ? padding : 8;
    sendResponse({ bounds: { x: Math.max(0, rect.left - pad), y: Math.max(0, rect.top + window.scrollY - pad), width: rect.width + pad * 2, height: rect.height + pad * 2 } });
  } catch {
    sendResponse({ error: "action-failed" });
  }
}
