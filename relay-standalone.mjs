/**
 * Standalone relay runner — starts the BrowserRelayServer without VSCode.
 * The extension connects to this relay (ws://127.0.0.1:40111/?token=accordo-local-dev-token).
 * 
 * Usage: node relay-standalone.mjs
 */
import { BrowserRelayServer } from "./packages/browser/dist/relay-server.js";

const relay = new BrowserRelayServer({
  port: 40111,
  host: "127.0.0.1",
  token: "accordo-local-dev-token",
  onEvent: (event, details) => {
    console.log(`[relay] ${event}`, details ?? "");
  },
  // When the extension sends an action, just echo a stub response for now
  onRelayRequest: async (action, payload) => {
    console.log(`[relay] action from Chrome: ${action}`, JSON.stringify(payload).slice(0, 200));
    return { success: true, data: { note: "relay-standalone: no real handler wired" } };
  },
});

await relay.start();
console.log("[relay] Listening on ws://127.0.0.1:40111  (token: accordo-local-dev-token)");
