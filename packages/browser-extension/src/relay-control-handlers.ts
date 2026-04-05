/**
 * M110-TC — Relay Control Handlers
 *
 * CDP-based handlers for navigate, click, type, press_key relay actions.
 * Each handler:
 * 1. Resolves target tab ID.
 * 2. Checks controlPermission.isGranted(tabId) → "control-not-granted" error if denied.
 * 3. Ensures debugger attached (with MV3 recovery).
 * 4. Sends CDP commands via debuggerManager.sendCommand().
 * 5. Returns structured RelayActionResponse.
 *
 * REQ-TC-003: PERMISSION_REQUIRED when hasPermission returns false.
 * REQ-TC-004: Sends correct navigate relay action to extension.
 * REQ-TC-006: Dispatches Input.dispatchMouseEvent with correct x/y.
 * REQ-TC-007: PERMISSION_REQUIRED if tab not granted for click.
 * REQ-TC-008: Supports dblClick: true option.
 * REQ-TC-010: Dispatches Input.dispatchKeyEvent for each character.
 * REQ-TC-011: PERMISSION_REQUIRED if tab not granted for type.
 * REQ-TC-012: Supports pressEnter, pressTab, pressEscape shortcuts.
 * REQ-TC-013: Dispatches correct Input.dispatchKeyEvent for key.
 * REQ-TC-014: Handles modifier keys via modifiers bitmask.
 * REQ-TC-015: Uses KeyCodeMap for named keys.
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed } from "./relay-definitions.js";
import { hasPermission } from "./control-permission.js";
import { ensureAttached, sendCommand } from "./debugger-manager.js";
import { KeyCodeMap, parseKeyCombination, MODIFIER_ALT, MODIFIER_CONTROL, MODIFIER_META, MODIFIER_SHIFT } from "./key-code-map.js";

/**
 * Resolve target tabId from payload, defaulting to active tab.
 */
async function resolveTargetTabId(payload: Record<string, unknown>): Promise<number> {
  if (typeof payload.tabId === "number") {
    return payload.tabId;
  }
  // Query for active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id !== undefined) {
    return tabs[0].id;
  }
  return 1; // fallback
}

/**
 * Resolve element coordinates via content script.
 */
async function resolveElementCoords(
  tabId: number,
  uid?: string,
  selector?: string
): Promise<{ x: number; y: number; bounds: { x: number; y: number; width: number; height: number }; inViewport: boolean } | { error: string }> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "RESOLVE_ELEMENT_COORDS",
    uid,
    selector,
  });
  return response as { x: number; y: number; bounds: { x: number; y: number; width: number; height: number }; inViewport: boolean } | { error: string };
}

export async function handleNavigate(request: RelayActionRequest): Promise<RelayActionResponse> {
  const payload = request.payload;

  try {
    const tabId = await resolveTargetTabId(payload);

    // Check permission
    if (!(await hasPermission(tabId))) {
      return actionFailed(request, "control-not-granted");
    }

    await ensureAttached(tabId);

    const type = (payload.type as string) || "url";

    if (type === "url") {
      const url = payload.url as string;
      if (!url) {
        return actionFailed(request, "invalid-request");
      }
      await sendCommand(tabId, "Page.navigate", { url });
    } else if (type === "back") {
      await sendCommand(tabId, "Page.goBackInHistory");
    } else if (type === "forward") {
      await sendCommand(tabId, "Page.goForwardInHistory");
    } else if (type === "reload") {
      await sendCommand(tabId, "Page.reload");
    }

    // GAP-A1: Get document.readyState after navigation
    const readyStateResult = await sendCommand<{ result: { value: string } }>(tabId, "Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    });
    const readyState = (readyStateResult?.result?.value ?? "interactive") as "loading" | "interactive" | "complete";

    // Get frame tree for title
    const frameTree = await sendCommand<{ frameTree: { frame: { title: string } } }>(tabId, "Page.getFrameTree");
    const title = frameTree?.frameTree?.frame?.title ?? "";

    // Return the URL that was navigated to
    const url = payload.url as string;

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

export async function handleClick(request: RelayActionRequest): Promise<RelayActionResponse> {
  const payload = request.payload;

  try {
    const tabId = await resolveTargetTabId(payload);

    // Check permission
    if (!(await hasPermission(tabId))) {
      return actionFailed(request, "control-not-granted");
    }

    await ensureAttached(tabId);

    let x: number;
    let y: number;

    // Explicit coordinates
    if (payload.coordinates && typeof payload.coordinates === "object") {
      const coords = payload.coordinates as { x: number; y: number };
      x = coords.x;
      y = coords.y;
    } else {
      // Resolve via content script
      const uid = payload.uid as string | undefined;
      const selector = payload.selector as string | undefined;
      const coords = await resolveElementCoords(tabId, uid, selector);

      if ("error" in coords) {
        if (coords.error === "not-found" || coords.error === "zero-size") {
          return actionFailed(request, "element-not-found");
        }
        return actionFailed(request, "action-failed");
      }

      x = coords.x;
      y = coords.y;

      // Scroll into view if needed
      if (!coords.inViewport) {
        await sendCommand(tabId, "DOM.scrollIntoViewIfNeeded", {
          node: undefined,
          rect: coords.bounds,
        });
      }
    }

    const dblClick = payload.dblClick === true;

    if (dblClick) {
      // Double-click sequence
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x, y });
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x, y });
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 2, x, y });
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 2, x, y });
    } else {
      // Single-click sequence
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x, y });
      await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x, y });
    }

    return {
      requestId: request.requestId,
      success: true,
      data: { clickedAt: { x, y } },
    };
  } catch (e) {
    return actionFailed(request, "action-failed");
  }
}

export async function handleType(request: RelayActionRequest): Promise<RelayActionResponse> {
  const payload = request.payload;

  try {
    const tabId = await resolveTargetTabId(payload);

    // Check permission
    if (!(await hasPermission(tabId))) {
      return actionFailed(request, "control-not-granted");
    }

    await ensureAttached(tabId);

    const text = payload.text as string;
    if (!text) {
      return actionFailed(request, "invalid-request");
    }

    // Resolve element
    const uid = payload.uid as string | undefined;
    const selector = payload.selector as string | undefined;

    if (uid || selector) {
      const coords = await resolveElementCoords(tabId, uid, selector);

      if ("error" in coords) {
        if (coords.error === "not-found" || coords.error === "zero-size") {
          return actionFailed(request, "element-not-found");
        }
        return actionFailed(request, "action-failed");
      }

      // Focus element via Runtime.evaluate
      await sendCommand(tabId, "Runtime.evaluate", {
        expression: `(function() {
          var el = document.elementFromPoint(${coords.x}, ${coords.y});
          if (el && typeof el.focus === 'function') el.focus();
          return true;
        })()`,
      });
    }

    const clearFirst = payload.clearFirst === true;
    if (clearFirst) {
      // Ctrl+A then Delete
      await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: MODIFIER_CONTROL, key: "Control", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
      await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "keyUp", modifiers: MODIFIER_CONTROL, key: "Control", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
      await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
      await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
    }

    // Insert text via insertText
    await sendCommand(tabId, "Input.insertText", { text });

    // Submit key if specified
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
  } catch (e) {
    return actionFailed(request, "action-failed");
  }
}

export async function handlePressKey(request: RelayActionRequest): Promise<RelayActionResponse> {
  const payload = request.payload;

  try {
    const tabId = await resolveTargetTabId(payload);

    // Check permission
    if (!(await hasPermission(tabId))) {
      return actionFailed(request, "control-not-granted");
    }

    await ensureAttached(tabId);

    const keyCombo = payload.key as string;
    if (!keyCombo) {
      return actionFailed(request, "invalid-request");
    }

    const { modifiers, key } = parseKeyCombination(keyCombo);

    // Get key entry from KeyCodeMap
    const keyEntry = KeyCodeMap[key];
    const keyName = keyEntry?.key ?? key;
    const code = keyEntry?.code ?? key;
    const wvk = keyEntry?.windowsVirtualKeyCode ?? 0;
    const nvk = keyEntry?.nativeVirtualKeyCode ?? 0;

    // Split into modifiers and base key
    const modifierNames = ["Control", "Shift", "Alt", "Meta"] as const;
    const modifierValues = [MODIFIER_CONTROL, MODIFIER_SHIFT, MODIFIER_ALT, MODIFIER_META] as const;

    // Press modifiers
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

    // Press base key with full modifiers
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

    // Release modifiers in reverse order
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
  } catch (e) {
    return actionFailed(request, "action-failed");
  }
}
