import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed } from "./relay-definitions.js";
import { hasPermission } from "./control-permission.js";
import { ensureAttached, sendCommand } from "./debugger-manager.js";
import { KeyCodeMap, parseKeyCombination, MODIFIER_ALT, MODIFIER_CONTROL, MODIFIER_META, MODIFIER_SHIFT } from "./key-code-map.js";
import { resolveTargetTabId, tabExists } from "./relay-control-runtime.js";

export async function handlePressKey(request: RelayActionRequest): Promise<RelayActionResponse> {
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

    const keyCombo = payload.key as string;
    if (!keyCombo) {
      return actionFailed(request, "invalid-request");
    }

    const { modifiers, key } = parseKeyCombination(keyCombo);
    const keyEntry = KeyCodeMap[key];
    const keyName = keyEntry?.key ?? key;
    const code = keyEntry?.code ?? key;
    const wvk = keyEntry?.windowsVirtualKeyCode ?? 0;
    const nvk = keyEntry?.nativeVirtualKeyCode ?? 0;

    const modifierNames = ["Control", "Shift", "Alt", "Meta"] as const;
    const modifierValues = [MODIFIER_CONTROL, MODIFIER_SHIFT, MODIFIER_ALT, MODIFIER_META] as const;

    for (let i = 0; i < modifierNames.length; i++) {
      if (modifiers & modifierValues[i]) {
        const modName = modifierNames[i];
        const modEntry = KeyCodeMap[modName];
        await sendCommand(tabId, "Input.dispatchKeyEvent", {
          type: "rawKeyDown",
          modifiers,
          key: modName,
          code: modEntry?.code ?? modName,
          windowsVirtualKeyCode: modEntry?.windowsVirtualKeyCode ?? 0,
          nativeVirtualKeyCode: modEntry?.nativeVirtualKeyCode ?? 0,
        });
      }
    }

    await sendCommand(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      modifiers,
      key: keyName,
      code,
      windowsVirtualKeyCode: wvk,
      nativeVirtualKeyCode: nvk,
    });
    await sendCommand(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      modifiers,
      key: keyName,
      code,
      windowsVirtualKeyCode: wvk,
      nativeVirtualKeyCode: nvk,
    });

    for (let i = modifierNames.length - 1; i >= 0; i--) {
      if (modifiers & modifierValues[i]) {
        const modName = modifierNames[i];
        const modEntry = KeyCodeMap[modName];
        await sendCommand(tabId, "Input.dispatchKeyEvent", {
          type: "keyUp",
          modifiers: modifiers & ~modifierValues[i],
          key: modName,
          code: modEntry?.code ?? modName,
          windowsVirtualKeyCode: modEntry?.windowsVirtualKeyCode ?? 0,
          nativeVirtualKeyCode: modEntry?.nativeVirtualKeyCode ?? 0,
        });
      }
    }

    return { requestId: request.requestId, success: true, data: { key: keyCombo } };
  } catch {
    return actionFailed(request, "action-failed");
  }
}
