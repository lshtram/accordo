import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import { handleListPages, handleSelectPage, type ListPagesArgs, type SelectPageArgs } from "./page-tool-handlers.js";

export function buildListPagesTool(relay: BrowserRelayLike): ExtensionToolDefinition {
  return {
    name: "accordo_browser_list_pages",
    description: "List all open browser tabs/pages with their tabId, url, title, and active state.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional tab ID (unused; reserved for future filtering)" },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleListPages(relay, args as ListPagesArgs),
  };
}

export function buildSelectPageTool(
  relay: BrowserRelayLike,
  isSelectPageArgs: (obj: unknown) => obj is SelectPageArgs,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_select_page",
    description: "Select (activate) a browser tab by its tabId.",
    inputSchema: {
      type: "object",
      required: ["tabId"],
      properties: {
        tabId: { type: "number", description: "The tab ID to activate." },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => {
      if (!isSelectPageArgs(args)) return Promise.resolve({ success: false, error: "invalid-request", pageUrl: null });
      return handleSelectPage(relay, args);
    },
  };
}
