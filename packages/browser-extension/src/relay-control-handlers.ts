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
 * REQ-TC-017: Returns tab-not-found when caller provides an invalid explicit tabId.
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { handleClick } from "./relay-control-click.js";
import { handlePressKey } from "./relay-control-key.js";
import { handleNavigate } from "./relay-control-navigate.js";
import { handleType } from "./relay-control-type.js";

export { toLifecycleEventName } from "./relay-control-runtime.js";
export { handleNavigate } from "./relay-control-navigate.js";
export { handleClick } from "./relay-control-click.js";
export { handleType } from "./relay-control-type.js";
export { handlePressKey } from "./relay-control-key.js";
