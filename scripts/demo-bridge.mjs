/**
 * demo-bridge.mjs — Simulated Bridge for manual Hub testing
 *
 * Connects to the Hub as if it were the accordo-bridge VSCode extension,
 * sends a realistic stateSnapshot + toolRegistry, then keeps the WS alive
 * so you can query the Hub via /instructions.
 *
 * Usage (from repo root):
 *   ACCORDO_BRIDGE_SECRET=demo-secret node scripts/demo-bridge.mjs
 *
 * The Hub should already be running:
 *   ACCORDO_TOKEN=demo-token ACCORDO_BRIDGE_SECRET=demo-secret \
 *     node packages/hub/dist/index.js --port 3000
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve ws from the hub package's node_modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  path.join(__dirname, "../packages/hub/package.json"),
);
const WebSocket = require("ws");

const PORT = Number(process.env.ACCORDO_HUB_PORT ?? 3000);
const SECRET = process.env.ACCORDO_BRIDGE_SECRET ?? "";
const PROTOCOL_VERSION = "1";

// ── Sample IDE state (mimics what state-publisher.ts would send) ──────────────
const fakeState = {
  activeFile: "/Users/Shared/dev/accordo/packages/bridge/src/state-publisher.ts",
  activeFileLine: 42,
  activeFileColumn: 7,
  openEditors: [
    "/Users/Shared/dev/accordo/packages/bridge/src/state-publisher.ts",
    "/Users/Shared/dev/accordo/packages/bridge/src/ws-client.ts",
    "/Users/Shared/dev/accordo/docs/requirements-bridge.md",
  ],
  visibleEditors: [
    "/Users/Shared/dev/accordo/packages/bridge/src/state-publisher.ts",
  ],
  workspaceFolders: ["/Users/Shared/dev/accordo"],
  activeTerminal: "zsh",
  workspaceName: "accordo",
  remoteAuthority: null,
  modalities: {},
};

// ── Sample tool registry ───────────────────────────────────────────────────────
const fakeTools = [
  {
    name: "accordo_editor_open",
    description: "Open a file in the VSCode editor",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    idempotent: true,
  },
  {
    name: "accordo_terminal_run",
    description: "Run a command in a VSCode terminal",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        terminalName: { type: "string" },
      },
      required: ["command"],
    },
    idempotent: false,
  },
];

// ── Connect ───────────────────────────────────────────────────────────────────
console.log(`[demo-bridge] Connecting to ws://localhost:${PORT}/bridge …`);

const ws = new WebSocket(`ws://localhost:${PORT}/bridge`, {
  headers: SECRET ? { "x-accordo-secret": SECRET } : {},
});

ws.on("open", () => {
  console.log("[demo-bridge] Connected ✓");

  // Send full snapshot (same format as state-publisher.sendSnapshot)
  ws.send(JSON.stringify({
    type: "stateSnapshot",
    protocolVersion: PROTOCOL_VERSION,
    state: fakeState,
  }));
  console.log("[demo-bridge] Sent stateSnapshot ✓");
  console.log(`             activeFile: ${fakeState.activeFile}`);
  console.log(`             openEditors: ${fakeState.openEditors.length} files`);

  // Send tool registry
  ws.send(JSON.stringify({
    type: "toolRegistry",
    tools: fakeTools,
  }));
  console.log(`[demo-bridge] Sent toolRegistry ✓  (${fakeTools.length} tools)`);

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" Hub is live with real IDE state. Try:");
  console.log("");
  console.log("  # View the rendered system prompt (what the agent sees):");
  console.log(`  curl -s http://localhost:${PORT}/instructions \\`);
  console.log('       -H "Authorization: Bearer demo-token" | head -60');
  console.log("");
  console.log("  # Health check:");
  console.log(`  curl -s http://localhost:${PORT}/health | python3 -m json.tool`);
  console.log("");
  console.log("  # Send a diff patch (simulates state-publisher stateUpdate):");
  console.log("  # (see demo-bridge.mjs sendUpdate example below)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" Press Ctrl+C to disconnect the simulated Bridge");
  console.log("");

  // After 5s, simulate a real-time diff update (like user switching file)
  setTimeout(() => {
    ws.send(JSON.stringify({
      type: "stateUpdate",
      patch: {
        activeFile: "/Users/Shared/dev/accordo/docs/workplan.md",
        activeFileLine: 1,
        activeFileColumn: 1,
      },
    }));
    console.log("[demo-bridge] Sent stateUpdate (switched active file to workplan.md) ✓");
    console.log("             Re-run /instructions curl to see it reflected.");
  }, 5_000);
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "ping") {
    ws.send(JSON.stringify({ type: "pong", ts: msg.ts }));
    return;
  }
  if (msg.type === "getState") {
    // Hub requested fresh state — reply with current snapshot
    ws.send(JSON.stringify({
      type: "stateSnapshot",
      protocolVersion: PROTOCOL_VERSION,
      state: fakeState,
    }));
    console.log("[demo-bridge] Hub requested getState — replied with snapshot ✓");
    return;
  }
  console.log("[demo-bridge] Received:", JSON.stringify(msg));
});

ws.on("close", (code, reason) => {
  console.log(`[demo-bridge] Disconnected (code ${code}: ${reason.toString() || "normal"})`);
  process.exit(0);
});

ws.on("error", (err) => {
  console.error("[demo-bridge] Error:", err.message);
  console.error("             Is the Hub running? Start it with:");
  console.error(`             ACCORDO_TOKEN=demo-token ACCORDO_BRIDGE_SECRET=demo-secret \\`);
  console.error(`               node packages/hub/dist/index.js --port ${PORT}`);
  process.exit(1);
});
