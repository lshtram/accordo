/**
 * M110-TC — Browser Tab Control Tools
 *
 * 4 tool builder functions for browser_navigate, browser_click,
 * browser_type, browser_press_key.
 *
 * Each tool validates input, calls relay.request(), and maps responses.
 * Delegated to handle* functions in control-tool-types.js.
 *
 * REQ-TC-001..REQ-TC-017
 *
 * @module
 */

export {
  buildNavigateTool,
  buildClickTool,
  buildTypeTool,
  buildPressKeyTool,
  buildControlTools,
  handleNavigate,
  handleClick,
  handleType,
  handlePressKey,
  NAVIGATE_DEFAULT_TIMEOUT_MS,
  NAVIGATE_MAX_TIMEOUT_MS,
  NAVIGATE_RELAY_TIMEOUT_MS,
  CONTROL_ACTION_TIMEOUT_MS,
} from "./control-tool-types.js";

export type {
  NavigateArgs,
  NavigateResponse,
  ClickArgs,
  ClickResponse,
  TypeArgs,
  TypeResponse,
  PressKeyArgs,
  PressKeyResponse,
} from "./control-tool-types.js";
