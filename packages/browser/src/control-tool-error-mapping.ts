import type { ClickResponse, NavigateResponse, PressKeyResponse, TypeResponse } from "./control-tool-contracts.js";

export function mapNavigateError(error: unknown): NavigateResponse["error"] {
  switch (error) {
    case "control-not-granted":
    case "tab-not-found":
    case "unsupported-page":
    case "invalid-request":
    case "timeout":
    case "browser-not-connected":
    case "action-failed":
      return error;
    default:
      return "navigation-failed";
  }
}

export function mapClickError(error: unknown): ClickResponse["error"] {
  switch (error) {
    case "control-not-granted":
    case "tab-not-found":
    case "element-not-found":
    case "element-off-screen":
    case "no-target":
    case "iframe-cross-origin":
    case "no-content-script":
    case "browser-not-connected":
    case "timeout":
    case "action-failed":
    case "invalid-request":
      return error;
    default:
      return "action-failed";
  }
}

export function mapTypeError(error: unknown): TypeResponse["error"] {
  switch (error) {
    case "control-not-granted":
    case "tab-not-found":
    case "element-not-found":
    case "element-not-focusable":
    case "no-target":
    case "iframe-cross-origin":
    case "no-content-script":
    case "browser-not-connected":
    case "timeout":
    case "action-failed":
    case "invalid-request":
      return error;
    default:
      return "action-failed";
  }
}

export function mapPressKeyError(error: unknown): PressKeyResponse["error"] {
  switch (error) {
    case "control-not-granted":
    case "tab-not-found":
    case "invalid-key":
    case "browser-not-connected":
    case "timeout":
    case "action-failed":
    case "invalid-request":
      return error;
    default:
      return "action-failed";
  }
}
