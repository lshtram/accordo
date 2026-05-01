import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import { handleListPages, handleSelectPage, type ListPagesArgs, type SelectPageArgs } from "./page-tool-handlers.js";
import { ACTIVE_PAGE_STATE_DESCRIPTION } from "./tab-target-contract.js";
import { buildStructuredError } from "./page-tool-meta-types.js";

export function buildListPagesTool(relay: BrowserRelayLike): ExtensionToolDefinition {
  return {
    name: "accordo_browser_list_pages",
    description: `List all open browser tabs/pages with their tabId, windowId, url, title, per-window active state, a single isImplicitTarget marker, and whether browser control permission has already been granted for each tab. ${ACTIVE_PAGE_STATE_DESCRIPTION} Read accordo://skills/browser for browser workflow and recovery guidance.`,
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional tab ID (unused; reserved for future filtering)" },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args): Promise<Awaited<ReturnType<typeof handleListPages>>> => handleListPages(relay, args as ListPagesArgs),
  };
}

export function buildSelectPageTool(
  relay: BrowserRelayLike,
  isSelectPageArgs: (obj: unknown) => obj is SelectPageArgs,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_select_page",
    description: "Select (activate) a browser tab by its tabId and make it the implicit target by focusing its window. Read accordo://skills/browser for browser workflow and recovery guidance.",
    inputSchema: {
      type: "object",
      required: ["tabId"],
      properties: {
        tabId: { type: "number", description: "The tab ID to activate." },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args): Promise<Awaited<ReturnType<typeof handleSelectPage>>> => {
      if (!isSelectPageArgs(args)) return Promise.resolve(buildStructuredError("invalid-request"));
      return handleSelectPage(relay, args);
    },
  };
}
