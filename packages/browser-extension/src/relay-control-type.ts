import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed } from "./relay-definitions.js";
import { hasPermission } from "./control-permission.js";
import { ensureAttached, sendCommand } from "./debugger-manager.js";
import { KeyCodeMap, MODIFIER_CONTROL } from "./key-code-map.js";
import { resolveControlFrameTarget, resolveTargetTabId, tabExists, typeInElement } from "./relay-control-runtime.js";

export async function handleType(request: RelayActionRequest): Promise<RelayActionResponse> {
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

    const text = payload.text as string;
    if (!text) {
      return actionFailed(request, "invalid-request");
    }

    const uid = payload.uid as string | undefined;
    const selector = payload.selector as string | undefined;
    const frameTarget = await resolveControlFrameTarget(tabId, uid);
    if (frameTarget === null) {
      return actionFailed(request, "action-failed");
    }

    const clearFirst = payload.clearFirst === true;
    if (uid || selector) {
      const typeResult = await typeInElement(tabId, frameTarget.frameId, text, uid, selector, clearFirst);
      if ("error" in typeResult) {
        if (typeResult.error === "not-found" || typeResult.error === "zero-size") {
          return actionFailed(request, "element-not-found");
        }
        if (typeResult.error === "not-focusable") {
          return actionFailed(request, "element-not-focusable");
        }
        return actionFailed(request, "action-failed");
      }
    } else if (clearFirst) {
      await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: MODIFIER_CONTROL, key: "Control", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
      await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "keyDown", modifiers: MODIFIER_CONTROL, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
      await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "keyUp", modifiers: MODIFIER_CONTROL, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
      await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "keyUp", modifiers: MODIFIER_CONTROL, key: "Control", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
      await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
      await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
    }

    if (!uid && !selector) {
      await sendCommand(tabId, "Input.insertText", { text });
    }

    const submitKey = payload.submitKey as string | undefined;
    if (submitKey) {
      const keyEntry = KeyCodeMap[submitKey];
      const key = keyEntry?.key ?? submitKey;
      const code = keyEntry?.code ?? submitKey;
      const wvk = keyEntry?.windowsVirtualKeyCode ?? 0;
      const nvk = keyEntry?.nativeVirtualKeyCode ?? 0;

      await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: wvk, nativeVirtualKeyCode: nvk });
      await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: wvk, nativeVirtualKeyCode: nvk });
    }

    return { requestId: request.requestId, success: true };
  } catch {
    return actionFailed(request, "action-failed");
  }
}
