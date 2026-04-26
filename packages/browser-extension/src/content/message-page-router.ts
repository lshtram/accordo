import { getLogicalFrameId, toInspectPayload } from "./message-action-helpers.js";
import { routeDiffSnapshots, routeDomExcerpt, routeInspectElement, routeSpatialRelations } from "./message-page-routing-helpers.js";

export async function handlePageUnderstandingActionMessage(
  action: string,
  payload: Record<string, unknown>,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    const result = await routePageAction(action, payload);
    sendResponse(result.error ? { error: result.error } : { data: result.data });
  } catch {
    sendResponse({ error: "action-failed" });
  }
}

async function routePageAction(action: string, payload: Record<string, unknown>): Promise<{ data?: unknown; error?: string }> {
  if (action === "get_page_map") return routePageMap(payload);
  if (action === "inspect_element") return routeInspectElement(payload);
  if (action === "get_dom_excerpt") return routeDomExcerpt(payload);
  if (action === "wait_for") return routeWaitFor(payload);
  if (action === "get_text_map") return routeTextMap(payload);
  if (action === "get_semantic_graph") return routeSemanticGraph(payload);
  if (action === "get_frame_path") return { data: { frameId: getLogicalFrameId() } };
  if (action === "get_spatial_relations") return routeSpatialRelations(payload);
  if (action === "diff_snapshots") return routeDiffSnapshots(payload);
  return { error: "unsupported-action" };
}

async function routePageMap(payload: Record<string, unknown>): Promise<{ data: unknown }> {
  const { collectPageMap } = await import("./page-map-collector.js");
  const data = collectPageMap(payload as Parameters<typeof collectPageMap>[0]);
  const { defaultStore, isVersionedSnapshot } = await import("../relay-definitions.js");
  if (isVersionedSnapshot(data)) {
    await defaultStore.save((data as { pageId: string }).pageId, data as Parameters<typeof defaultStore.save>[1]);
  }
  return { data };
}

async function routeWaitFor(payload: Record<string, unknown>): Promise<{ data: unknown }> {
  const { handleWaitForAction } = await import("./wait-provider.js");
  return { data: await handleWaitForAction(payload) };
}

async function routeTextMap(payload: Record<string, unknown>): Promise<{ data: unknown }> {
  const { collectTextMap } = await import("./text-map-collector.js");
  return { data: collectTextMap(payload as Parameters<typeof collectTextMap>[0]) };
}

async function routeSemanticGraph(payload: Record<string, unknown>): Promise<{ data: unknown }> {
  const { collectSemanticGraph } = await import("./semantic-graph-collector.js");
  return { data: collectSemanticGraph(payload as Parameters<typeof collectSemanticGraph>[0]) };
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
