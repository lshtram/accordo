import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed } from "./relay-definitions.js";
import { NO_CONTENT_SCRIPT, reinjectAndForwardToFrame, resolveTargetTabId } from "./relay-forwarder.js";
import { hasDataField, hasErrorField } from "./relay-type-guards.js";

export async function handleWaitFor(request: RelayActionRequest): Promise<RelayActionResponse> {
  if (typeof document !== "undefined") {
    throw new Error("not implemented");
  }

  const tabId = await resolveTargetTabId(request.payload);
  if (!tabId) {
    return actionFailed(request);
  }

  let waitResponse: unknown;
  try {
    waitResponse = await chrome.tabs.sendMessage(tabId, {
      type: "PAGE_UNDERSTANDING_ACTION",
      action: request.action,
      payload: request.payload,
    }, { frameId: 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const noReceiver = msg.includes("Receiving end does not exist") || msg.includes("Could not establish connection");
    if (!noReceiver) {
      return actionFailed(request);
    }
    try {
      waitResponse = await reinjectAndForwardToFrame(tabId, 0, request.action, request.payload);
    } catch {
      return actionFailed(request, "no-content-script");
    }
    if (waitResponse === NO_CONTENT_SCRIPT) {
      return actionFailed(request, "no-content-script");
    }
  }

  if (!waitResponse || hasErrorField(waitResponse)) {
    const errCode = hasErrorField(waitResponse) ? waitResponse.error : undefined;
    if (errCode === "navigation-interrupted" || errCode === "page-closed" || errCode === "timeout") {
      return { requestId: request.requestId, success: true, data: waitResponse };
    }
    return actionFailed(request);
  }

  const data = hasDataField(waitResponse) ? waitResponse.data : waitResponse;
  return { requestId: request.requestId, success: true, data };
}
