import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { toInspectPayload } from "./inspect-payload.js";
import { appendPaginationMetadata, clampOffsetLimit, handlePageUnderstandingAction } from "./relay-page-runtime.js";
import { handleFrameIdRequest } from "./relay-page-frames.js";

export async function handleInspectElement(request: RelayActionRequest): Promise<RelayActionResponse> {
  const localHandler = typeof document !== "undefined"
    ? async (): Promise<unknown> => {
        const { inspectElement } = await import("./content/element-inspector.js");
        return inspectElement(toInspectPayload(request.payload));
      }
    : null;
  return handlePageUnderstandingAction(request, localHandler, false, handleFrameIdRequest);
}

export async function handleGetDomExcerpt(request: RelayActionRequest): Promise<RelayActionResponse> {
  const localHandler = typeof document !== "undefined"
    ? async (): Promise<unknown> => {
      const { getDomExcerpt } = await import("./content/element-inspector.js");
        const selector = typeof request.payload.selector === "string" ? request.payload.selector : undefined;
        const anchorKey = typeof request.payload.anchorKey === "string" ? request.payload.anchorKey : undefined;
        const creationSnapshotId = typeof request.payload.creationSnapshotId === "string" ? request.payload.creationSnapshotId : undefined;
        const maxDepth = typeof request.payload.maxDepth === "number" ? request.payload.maxDepth : undefined;
        const maxLength = typeof request.payload.maxLength === "number" ? request.payload.maxLength : undefined;
        return getDomExcerpt({ selector, anchorKey, creationSnapshotId }, maxDepth, maxLength);
      }
    : null;
  return handlePageUnderstandingAction(request, localHandler, false, handleFrameIdRequest);
}

export async function handleGetTextMap(request: RelayActionRequest): Promise<RelayActionResponse> {
  const localHandler = typeof document !== "undefined"
    ? async (): Promise<unknown> => {
        const { collectTextMap } = await import("./content/text-map-collector.js");
        const p = request.payload;
        const result = collectTextMap({
          maxSegments: typeof p.maxSegments === "number" ? p.maxSegments : undefined,
          logicalFrameId: typeof p.logicalFrameId === "string" ? p.logicalFrameId : undefined,
        });

        const pagination = clampOffsetLimit(p as Record<string, unknown>, 500, 2000, "maxSegments");
        if (pagination.hasPagination) {
          appendPaginationMetadata(result as unknown as Record<string, unknown>, {
            itemsKey: "segments",
            totalAvailable: result.totalSegments,
            offset: pagination.offset,
            limit: pagination.limit,
          });
        }

        return result;
      }
    : null;
  return handlePageUnderstandingAction(request, localHandler, false, handleFrameIdRequest);
}

export async function handleGetSemanticGraph(request: RelayActionRequest): Promise<RelayActionResponse> {
  const localHandler = typeof document !== "undefined"
    ? async (): Promise<unknown> => {
        const { collectSemanticGraph } = await import("./content/semantic-graph-collector.js");
        const p = request.payload;
        return collectSemanticGraph({
          maxDepth: typeof p.maxDepth === "number" ? p.maxDepth : undefined,
          visibleOnly: typeof p.visibleOnly === "boolean" ? p.visibleOnly : undefined,
          piercesShadow: typeof p.piercesShadow === "boolean" ? p.piercesShadow : undefined,
          logicalFrameId: typeof p.logicalFrameId === "string" ? p.logicalFrameId : undefined,
        });
      }
    : null;
  return handlePageUnderstandingAction(request, localHandler, false, handleFrameIdRequest);
}

export async function handleGetSpatialRelations(request: RelayActionRequest): Promise<RelayActionResponse> {
  const localHandler = typeof document !== "undefined"
    ? async (): Promise<unknown> => {
        const { handleGetSpatialRelationsAction } = await import("./content/spatial-relations-handler.js");
        return handleGetSpatialRelationsAction(request.payload);
      }
    : null;
  return handlePageUnderstandingAction(request, localHandler, false, handleFrameIdRequest);
}
