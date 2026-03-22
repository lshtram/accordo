import * as vscode from "vscode";
import { createBrowserTools } from "./browser-tools.js";
import { BrowserRelayServer } from "./relay-server.js";
import type { BrowserBridgeAPI } from "./types.js";

const EXTENSION_ID = "accordo.accordo-browser";
const TOKEN_KEY = "browserRelayToken";
const DEV_RELAY_TOKEN = "accordo-local-dev-token";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const out = vscode.window.createOutputChannel("Accordo Browser Relay");
  context.subscriptions.push(out);
  out.appendLine("[accordo-browser] activating...");

  const bridge = vscode.extensions.getExtension<BrowserBridgeAPI>("accordo.accordo-bridge")?.exports;
  if (!bridge) {
    out.appendLine("[accordo-browser] bridge exports not available; aborting activation");
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
  });
  try {
    await relay.start();
    out.appendLine("[accordo-browser] relay listening on 127.0.0.1:40111");
  } catch (err) {
    relayStartError = err instanceof Error ? err.message : String(err);
    out.appendLine(`[accordo-browser] relay start failed: ${relayStartError}`);
  }

  context.subscriptions.push({
    dispose: () => {
      void relay.stop();
    },
  });

  const tools = createBrowserTools(relay);
  const disposable = bridge.registerTools(EXTENSION_ID, tools);
  context.subscriptions.push(disposable);
  out.appendLine(`[accordo-browser] registered ${tools.length} browser MCP tools: ${tools.map((t) => t.name).join(", ")}`);

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
