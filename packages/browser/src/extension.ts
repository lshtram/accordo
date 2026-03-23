import * as vscode from "vscode";
import { BrowserRelayServer } from "./relay-server.js";
import type { BrowserBridgeAPI, BrowserRelayAction } from "./types.js";

const EXTENSION_ID = "accordo.accordo-browser";
const TOKEN_KEY = "browserRelayToken";
const DEV_RELAY_TOKEN = "accordo-local-dev-token";

/**
  * Map a Chrome browser relay action to the corresponding unified comment_* tool.
 * Returns { toolName, args } or null if the action has no corresponding tool.
 */
function browserActionToUnifiedTool(
  action: BrowserRelayAction,
  payload: Record<string, unknown>,
): { toolName: string; args: Record<string, unknown> } | null {
  switch (action) {
    case "get_all_comments":
      return { toolName: "comment_list", args: { scope: { modality: "browser" } } };

    case "get_comments": {
      const url = payload["url"] as string | undefined;
      return {
        toolName: "comment_list",
        args: url
          ? { scope: { modality: "browser", url } }
          : { scope: { modality: "browser" } },
      };
    }

    case "create_comment":
      return {
        toolName: "comment_create",
        args: {
          body: payload["body"] as string,
          scope: {
            modality: "browser",
            url: (payload["url"] as string | undefined) ?? "",
          },
          anchor: {
            kind: "browser",
            anchorKey: (payload["anchorKey"] as string | undefined) ?? "body:center",
          },
        },
      };

    case "reply_comment":
      return {
        toolName: "comment_reply",
        args: {
          threadId: payload["threadId"] as string,
          body: payload["body"] as string,
        },
      };

    case "resolve_thread":
      return {
        toolName: "comment_resolve",
        args: {
          threadId: payload["threadId"] as string,
          resolutionNote: (payload["resolutionNote"] as string | undefined) ?? "",
        },
      };

    case "reopen_thread":
      return {
        toolName: "comment_reopen",
        args: { threadId: payload["threadId"] as string },
      };

    case "delete_comment":
      return {
        toolName: "comment_delete",
        args: {
          threadId: payload["threadId"] as string,
          commentId: payload["commentId"] as string | undefined,
        },
      };

    case "delete_thread":
      return {
        toolName: "comment_delete",
        args: { threadId: payload["threadId"] as string },
      };

    default:
      return null;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const out = vscode.window.createOutputChannel("Accordo Browser Relay");
  context.subscriptions.push(out);
  out.appendLine("[accordo-browser] activating...");

  const bridgeExt = vscode.extensions.getExtension("accordo.accordo-bridge");
  if (!bridgeExt) {
    out.appendLine("[accordo-browser] accordo-bridge not installed; aborting activation");
    return;
  }
  const bridge = bridgeExt.exports as BrowserBridgeAPI | undefined;
  if (!bridge || typeof bridge.registerTools !== "function") {
    out.appendLine("[accordo-browser] Bridge exports unavailable; aborting activation");
    return;
  }

  const token = (context.globalState.get<string>(TOKEN_KEY) ?? DEV_RELAY_TOKEN).trim();
  await context.globalState.update(TOKEN_KEY, token);

  let relayStartError: string | null = null;

  const relay = new BrowserRelayServer({
    host: "127.0.0.1",
    port: 40111,
    token,
    onEvent: (event, details) => {
      out.appendLine(`[accordo-browser] ${event}${details ? ` ${JSON.stringify(details)}` : ""}`);
      if (event === "relay-client-connected" || event === "relay-client-disconnected") {
        bridge.publishState(EXTENSION_ID, {
          connected: relay.isConnected(),
          relayHost: "127.0.0.1",
          relayPort: 40111,
          relayStartError,
        });
      }
    },
    // Route all Chrome events through unified comment_* tools
    onRelayRequest: async (action, payload) => {
      const mapped = browserActionToUnifiedTool(action, payload);
      if (!mapped) {
        return { requestId: "", success: false, error: "action-failed" };
      }
      try {
        const result = await bridge.invokeTool(mapped.toolName, mapped.args);
        return { requestId: "", success: true, data: result };
      } catch (err) {
        return {
          requestId: "",
          success: false,
          error: "action-failed",
          data: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  try {
    await relay.start();
    out.appendLine("[accordo-browser] relay listening on 127.0.0.1:40111 (unified tool routing)");
  } catch (err) {
    relayStartError = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser] relay start failed: ${relayStartError}`);
  }

  context.subscriptions.push({
    dispose: () => {
      void relay.stop();
    },
  });

  // Note: accordo_browser_* tools are intentionally NOT registered here.
  // M86: Chrome relay events are routed through unified comment_* tools
  // via the onRelayRequest interceptor above.
  out.appendLine("[accordo-browser] no browser-specific MCP tools registered (M86: unified routing active)");

  bridge.publishState(EXTENSION_ID, {
    connected: relay.isConnected(),
    relayHost: "127.0.0.1",
    relayPort: 40111,
    relayStartError,
  });
  out.appendLine("[accordo-browser] published modality state");
}

export function deactivate(): void {
  // no-op: relay disposed via subscriptions
}
