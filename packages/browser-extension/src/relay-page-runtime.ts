import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { handleLocalPageUnderstandingAction } from "./relay-page-local.js";
import { handleRemotePageUnderstandingAction } from "./relay-page-remote.js";

export { appendNodePaginationMetadata, appendPaginationMetadata, clampOffsetLimit, cloneRecord } from "./relay-pagination.js";

export async function handlePageUnderstandingAction(
  request: RelayActionRequest,
  localHandler: (() => Promise<unknown>) | null,
  saveToStore: boolean,
  handleFrameIdRequest?: (request: RelayActionRequest, tabId: number, frameId: string, saveToStore: boolean) => Promise<RelayActionResponse>,
): Promise<RelayActionResponse> {
  const localResponse = await handleLocalPageUnderstandingAction(request, localHandler, saveToStore);
  if (localResponse !== undefined) {
    return localResponse;
  }

  return handleRemotePageUnderstandingAction(request, saveToStore, handleFrameIdRequest);
}
