import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed } from "./relay-definitions.js";
import { hasPermission } from "./control-permission.js";
import { ensureAttached, sendCommand } from "./debugger-manager.js";
import { resolveControlFrameTarget, resolveElementCoords, resolveTargetTabId, scrollElementIntoView, tabExists } from "./relay-control-runtime.js";

export async function handleClick(request: RelayActionRequest): Promise<RelayActionResponse> {
  const payload = request.payload;

  try {
    const tabId = await resolveTargetTabId(payload);
    if (tabId === undefined) {
      return actionFailed(request);
    }

    if (typeof payload.tabId === "number" && !(await tabExists(tabId))) {
      return actionFailed(request, "tab-not-found");
    }

    if (!(await hasPermission(tabId))) {
      return actionFailed(request, "control-not-granted");
    }

    await ensureAttached(tabId);

    let x: number;
    let y: number;

    const uid = payload.uid as string | undefined;
    const selector = payload.selector as string | undefined;
    const frameTarget = await resolveControlFrameTarget(tabId, uid);
    if (!frameTarget.ok) {
      return actionFailed(request, frameTarget.error);
    }

    if (uid || selector) {
      const coords = await resolveElementCoords(tabId, frameTarget.target.frameId, uid, selector);

      if ("error" in coords) {
        if (coords.error === "not-found" || coords.error === "zero-size") {
          return actionFailed(request, "element-not-found");
        }
        return actionFailed(request, "action-failed");
      }

      x = coords.x + frameTarget.target.offsetX;
      y = coords.y + frameTarget.target.offsetY;

      if (!coords.inViewport) {
          const scrollResult = await scrollElementIntoView(tabId, frameTarget.target.frameId, uid, selector);
        if ("error" in scrollResult) {
          if (scrollResult.error === "not-found" || scrollResult.error === "zero-size") {
            return actionFailed(request, "element-not-found");
          }
          return actionFailed(request, "action-failed");
        }

        const updatedCoords = await resolveElementCoords(tabId, frameTarget.target.frameId, uid, selector);
        if ("error" in updatedCoords) {
          if (updatedCoords.error === "not-found" || updatedCoords.error === "zero-size") {
            return actionFailed(request, "element-not-found");
          }
          return actionFailed(request, "action-failed");
        }

        x = updatedCoords.x + frameTarget.target.offsetX;
        y = updatedCoords.y + frameTarget.target.offsetY;
      }
    } else if (payload.coordinates && typeof payload.coordinates === "object") {
      const coords = payload.coordinates as { x: number; y: number };
      x = coords.x;
      y = coords.y;
    } else {
      return actionFailed(request, "invalid-request");
    }

    const dblClick = payload.dblClick === true;

    if (dblClick) {
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x, y });
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x, y });
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 2, x, y });
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 2, x, y });
    } else {
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x, y });
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x, y });
    }

    return {
      requestId: request.requestId,
      success: true,
      data: { clickedAt: { x, y } },
    };
  } catch {
    return actionFailed(request, "action-failed");
  }
}
