/**
 * relay-forwarder.ts — Cross-context messaging facade.
 *
 * @module
 */

export { getActiveTabUrl, resolveRequestedUrl, resolveTargetTabId } from "./relay-forwarder-tab.js";
export {
  ensureContentScriptInjected,
  forwardToContentScript,
  forwardToFrame,
  forwardToMainFrame,
  NO_CONTENT_SCRIPT,
  requestContentScriptEnvelope,
} from "./relay-forwarder-messaging.js";
