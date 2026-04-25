import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed } from "./relay-definitions.js";
import { hasPermission } from "./control-permission.js";
import { ensureAttached, sendCommand } from "./debugger-manager.js";
import {
  createFrameNavigatedWaiter,
  createLifecycleWaiter,
  getNavigateTimeoutMs,
  resolveTargetTabId,
  tabExists,
  toLifecycleEventName,
  type WaitUntil,
} from "./relay-control-runtime.js";

export async function handleNavigate(request: RelayActionRequest): Promise<RelayActionResponse> {
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
    await sendCommand(tabId, "Page.enable");

    const type = (payload.type as string) || "url";
    const waitUntil = (payload.waitUntil as WaitUntil) || "domcontentloaded";
    const eventName = toLifecycleEventName(waitUntil);
    const timeoutMs = getNavigateTimeoutMs(payload);

    if (type === "url") {
      const url = payload.url as string;
      if (!url) {
        return actionFailed(request, "invalid-request");
      }
      await sendCommand(tabId, "Page.setLifecycleEventsEnabled", { enabled: true });
      const frameTreeResult = await sendCommand<{ frameTree: { frame: { id: string } } }>(tabId, "Page.getFrameTree");
      const mainFrameId = frameTreeResult?.frameTree?.frame?.id ?? "";
      if (!mainFrameId) {
        return actionFailed(request, "action-failed");
      }
      const lifecycle = createLifecycleWaiter(tabId, eventName, mainFrameId, timeoutMs);
      try {
        await sendCommand(tabId, "Page.navigate", { url });
        await lifecycle.promise;
      } catch (error) {
        lifecycle.cancel();
        throw error;
      }
    } else if (type === "back") {
      const history = await sendCommand<{ currentIndex: number; entries: Array<{ id: number }> }>(tabId, "Page.getNavigationHistory");
      if (!history || history.currentIndex <= 0) {
        return actionFailed(request, "action-failed");
      }
      const waiter = createFrameNavigatedWaiter(tabId, timeoutMs);
      try {
        await sendCommand(tabId, "Page.navigateToHistoryEntry", {
          entryId: history.entries[history.currentIndex - 1].id,
        });
        await waiter.promise;
      } catch (error) {
        waiter.cancel();
        throw error;
      }
    } else if (type === "forward") {
      const history = await sendCommand<{ currentIndex: number; entries: Array<{ id: number }> }>(tabId, "Page.getNavigationHistory");
      if (!history || history.currentIndex >= history.entries.length - 1) {
        return actionFailed(request, "action-failed");
      }
      const waiter = createFrameNavigatedWaiter(tabId, timeoutMs);
      try {
        await sendCommand(tabId, "Page.navigateToHistoryEntry", {
          entryId: history.entries[history.currentIndex + 1].id,
        });
        await waiter.promise;
      } catch (error) {
        waiter.cancel();
        throw error;
      }
    } else if (type === "reload") {
      await sendCommand(tabId, "Page.setLifecycleEventsEnabled", { enabled: true });
      const frameTreeResult = await sendCommand<{ frameTree: { frame: { id: string } } }>(tabId, "Page.getFrameTree");
      const mainFrameId = frameTreeResult?.frameTree?.frame?.id ?? "";
      if (!mainFrameId) {
        return actionFailed(request, "action-failed");
      }
      const lifecycle = createLifecycleWaiter(tabId, eventName, mainFrameId, timeoutMs);
      try {
        await sendCommand(tabId, "Page.reload");
        await lifecycle.promise;
      } catch (error) {
        lifecycle.cancel();
        throw error;
      }
    }

    const readyStateResult = await sendCommand<{ result: { value: string } }>(tabId, "Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    });
    const readyState = (readyStateResult?.result?.value ?? "interactive") as "loading" | "interactive" | "complete";

    const titleEval = await sendCommand<{ result: { value: string } }>(tabId, "Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    });
    const frameTree = await sendCommand<{ frameTree: { frame: { title: string } } }>(tabId, "Page.getFrameTree");
    const title = (titleEval?.result?.value as string | undefined) ?? frameTree?.frameTree?.frame?.title ?? "";

    const currentTab = await chrome.tabs.get(tabId);
    const url = currentTab.url ?? (payload.url as string | undefined);

    return {
      requestId: request.requestId,
      success: true,
      data: { url, title, readyState },
    };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "unsupported-page") {
      return actionFailed(request, "unsupported-page");
    }
    return actionFailed(request, "action-failed");
  }
}
