import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { handleInspectElement, type InspectElementArgs } from "./page-tool-handlers.js";
import { IMPLICIT_TARGET_TAB_DESCRIPTION } from "./tab-target-contract.js";

export function buildInspectElementTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_inspect_element",
    description:
      "Deep inspection of a specific DOM element. " +
      "Returns computed styles, full attribute set, states (disabled, readonly, invalid, checked, expanded), " +
      "interaction properties (hasPointerEvents, isObstructed, clickTargetSize), " +
      "bounding box, visibility, and accessible name. " +
      "When inspecting from a stored browser anchor, anchorStrategy/anchorConfidence/resolvedTier describe the actual re-resolution path, while canonicalAnchor* describes the best current anchor for the found element. " +
      "B2-UID-001: uid \"{frameId}:{nodeId}\" from get_page_map is snapshot-scoped — " +
      "requires creationSnapshotId from the same get_page_map response. " +
      "Use selector or anchorKey for current-page resolution without a snapshotId. " +
      "Stale handles (missing creationSnapshotId or outdated snapshotId) must be reacquired via get_page_map.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: IMPLICIT_TARGET_TAB_DESCRIPTION },
        anchorKey: { type: "string", description: "Browser comment or capture anchor key identifying the target element" },
        creationSnapshotId: { type: "string", description: "Original snapshotId recorded when the browser comment anchor was created; used to detect drift on re-resolution" },
        uid: { type: "string", description: "B2-UID-001: Snapshot/frame-scoped node identity \"{frameId}:{nodeId}\" from get_page_map. Requires creationSnapshotId. Use selector/anchorKey for current-page resolution." },
        ref: { type: "string", description: "Snapshot-scoped element reference from get_page_map. Requires creationSnapshotId. Use selector/anchorKey for current-page resolution." },
        selector: { type: "string", description: "CSS selector to find element (current-DOM, no snapshot required)" },
        nodeId: { type: "number", description: "B2-SV-006: Snapshot-scoped node ID from a page map snapshot. Requires creationSnapshotId. Use selector/anchorKey for current-page resolution." },
        frameId: { type: "string", description: "F12: Target a specific iframe by its frameId from get_page_map iframes[]" },
        allowedOrigins: { type: "array", items: { type: "string" }, description: "Only allow data from these origins. Empty = use global policy." },
        deniedOrigins: { type: "array", items: { type: "string" }, description: "Block data from these origins. Takes precedence over allowedOrigins." },
        redactPII: { type: "boolean", description: "I1-text: When true, scan text content for PII and replace with [REDACTED]." },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleInspectElement(relay, args as InspectElementArgs, store, security),
  };
}
