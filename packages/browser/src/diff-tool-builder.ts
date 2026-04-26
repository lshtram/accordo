import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import { handleDiffSnapshots } from "./diff-tool-handler.js";
import type { DiffSnapshotsArgs } from "./diff-tool-contracts.js";
import { IMPLICIT_TARGET_TAB_DESCRIPTION } from "./tab-target-contract.js";

export function buildDiffSnapshotsTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_diff_snapshots",
    description:
      "Compare two page snapshots and return what changed — added nodes, removed nodes, and changed text/attributes. " +
      "If toSnapshotId is omitted, captures a fresh snapshot. If fromSnapshotId is omitted, uses the previous retained snapshot before toSnapshotId. " +
      "Typical usage: (1) call get_page_map to record a baseline snapshot and note its snapshotId, (2) perform the " +
      "action you want to observe, (3) call diff_snapshots with fromSnapshotId=<baseline> and no toSnapshotId — " +
      "a fresh snapshot is captured automatically for comparison. If both IDs are omitted, two consecutive snapshots " +
      "are captured and diffed (useful to detect background mutations, but will show an empty diff for static pages).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: IMPLICIT_TARGET_TAB_DESCRIPTION },
        fromSnapshotId: { type: "string", description: "Earlier snapshot ID (baseline). Omit to use the previous retained snapshot before toSnapshotId. Get a snapshotId by calling get_page_map first, then note the returned snapshotId." },
        toSnapshotId: { type: "string", description: "Later snapshot ID (current state). Omit to capture a fresh snapshot automatically." },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleDiffSnapshots(relay, args as DiffSnapshotsArgs, store),
  };
}
