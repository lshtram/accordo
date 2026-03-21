/**
 * End-to-end integration test for Accordo Hub
 *
 * Tests:
 * 1. Hub starts fresh
 * 2. Fake bridge connects via WebSocket (correct protocol)
 * 3. All 40 tools are registered
 * 4. /instructions lists ALL 40 tools (not just 5 discover stubs)
 * 5. /mcp tools/list returns all 40 tools
 * 6. mcp.json on disk has correct format (not nested under settings.mcp)
 *
 * Run: node scripts/integration-test.mjs
 */

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// ws lives in hub's node_modules (pnpm workspace — not hoisted to root)
import { fileURLToPath } from "node:url";
import wsModule from "../packages/hub/node_modules/ws/index.js";
const WebSocket = wsModule.WebSocket;

const HUB_TOKEN = "integration-test-token";
const BRIDGE_SECRET = "integration-test-secret";
const PORT = 3099; // use different port to not conflict with running hub
const HUB_BINARY = fileURLToPath(new URL("../packages/hub/dist/index.js", import.meta.url));

// ── Fake tool registry (mirrors real 40 tools) ────────────────────────────────

const FAKE_TOOLS = [
  { name: "accordo_editor_open", description: "Open a file in the editor", group: "editor" },
  { name: "accordo_editor_close", description: "Close an editor tab", group: "editor" },
  { name: "accordo_editor_scroll", description: "Scroll the active editor", group: "editor" },
  { name: "accordo_editor_split", description: "Split the editor pane", group: "editor" },
  { name: "accordo_editor_focus", description: "Focus an editor group", group: "editor" },
  { name: "accordo_editor_reveal", description: "Reveal a line in the editor", group: "editor" },
  { name: "accordo_editor_highlight", description: "Highlight lines in the editor", group: "editor" },
  { name: "accordo_editor_clearHighlights", description: "Clear editor highlights", group: "editor" },
  { name: "accordo_editor_save", description: "Save active file", group: "editor" },
  { name: "accordo_editor_saveAll", description: "Save all open files", group: "editor" },
  { name: "accordo_editor_format", description: "Format the active document", group: "editor" },
  { name: "accordo_editor_discover", description: "Returns full schemas for all 11 editor tools", group: undefined },
  { name: "accordo_terminal_open", description: "Open a new terminal", group: "terminal" },
  { name: "accordo_terminal_run", description: "Run a command in a terminal", group: "terminal" },
  { name: "accordo_terminal_focus", description: "Focus the terminal panel", group: "terminal" },
  { name: "accordo_terminal_list", description: "List open terminals", group: "terminal" },
  { name: "accordo_terminal_close", description: "Close a terminal", group: "terminal" },
  { name: "accordo_terminal_discover", description: "Returns full schemas for all 5 terminal tools", group: undefined },
  { name: "accordo_panel_toggle", description: "Toggle sidebar panel visibility", group: "layout" },
  { name: "accordo_layout_zen", description: "Toggle Zen Mode", group: "layout" },
  { name: "accordo_layout_fullscreen", description: "Toggle fullscreen mode", group: "layout" },
  { name: "accordo_layout_joinGroups", description: "Collapse all editor splits", group: "layout" },
  { name: "accordo_layout_evenGroups", description: "Equalize editor group sizes", group: "layout" },
  { name: "accordo_layout_discover", description: "Returns full schemas for all 5 layout tools", group: undefined },
  { name: "accordo_comment_list", description: "List review threads", group: "comments" },
  { name: "accordo_comment_get", description: "Get a specific review thread", group: "comments" },
  { name: "accordo_comment_create", description: "Create a review thread", group: "comments" },
  { name: "accordo_comment_reply", description: "Reply to a review thread", group: "comments" },
  { name: "accordo_comment_resolve", description: "Resolve a review thread", group: "comments" },
  { name: "accordo_comment_delete", description: "Delete a review thread", group: "comments" },
  { name: "accordo_comments_discover", description: "Get schemas for 6 review-thread tools", group: undefined },
  { name: "accordo_presentation_discover", description: "List Slidev presentation deck files in the workspace. Only returns actual Slidev decks", group: undefined },
  { name: "accordo_presentation_open", description: "Open a Slidev presentation deck", group: "presentation" },
  { name: "accordo_presentation_close", description: "Close the active presentation session", group: "presentation" },
  { name: "accordo_presentation_listSlides", description: "List all slides in the current deck", group: "presentation" },
  { name: "accordo_presentation_getCurrent", description: "Get the current slide", group: "presentation" },
  { name: "accordo_presentation_goto", description: "Navigate to a specific slide", group: "presentation" },
  { name: "accordo_presentation_next", description: "Advance to the next slide", group: "presentation" },
  { name: "accordo_presentation_prev", description: "Go back to the previous slide", group: "presentation" },
  { name: "accordo_presentation_generateNarration", description: "Generate narration text for slides", group: "presentation" },
];

const TOTAL_TOOLS = FAKE_TOOLS.length;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }

async function waitForPort(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
    try {
      await new Promise((resolve, reject) => {
        const s = createConnection(port, "127.0.0.1");
        s.on("connect", () => { s.destroy(); resolve(); });
        s.on("error", reject);
      });
      return;
    } catch {}
  }
  throw new Error(`Port ${port} never opened within ${timeoutMs}ms`);
}

async function httpJson(path, { method = "POST", body, token } = {}) {
  const url = `http://localhost:${PORT}${path}`;
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ── Start hub process ─────────────────────────────────────────────────────────

console.log("\n=== Accordo Integration Test ===\n");
console.log(`Hub binary: ${HUB_BINARY}`);
console.log(`Port: ${PORT}\n`);

const hub = spawn(
  process.execPath,
  [HUB_BINARY, "--port", String(PORT)],
  {
    env: {
      ...process.env,
      ACCORDO_TOKEN: HUB_TOKEN,
      ACCORDO_BRIDGE_SECRET: BRIDGE_SECRET,
    },
    stdio: ["ignore", "pipe", "pipe"],
  }
);
hub.stderr.on("data", d => { /* suppress */ });
hub.stdout.on("data", d => { /* suppress */ });
hub.on("error", e => { console.error("Hub spawn error:", e); process.exit(1); });

// ── Step 1: Hub starts ────────────────────────────────────────────────────────

console.log("Step 1: Hub startup");
try {
  await waitForPort(PORT, 6000);
  const health = await httpJson("/health", { method: "GET" });
  if (health.ok) pass(`Hub started (uptime=${health.uptime?.toFixed(1)}s)`);
  else fail("Hub health check failed: " + JSON.stringify(health));
} catch (e) {
  fail("Hub failed to start: " + e.message);
  hub.kill();
  process.exit(1);
}

// ── Step 2: Bridge WebSocket connects ────────────────────────────────────────

console.log("\nStep 2: Bridge WebSocket connection");
let wsReady;
const wsReadyP = new Promise(r => { wsReady = r; });

const ws = new WebSocket(`ws://localhost:${PORT}/bridge`, {
  headers: { "x-accordo-secret": BRIDGE_SECRET },
});

ws.on("error", e => fail("WebSocket error: " + e.message));
ws.on("open", () => {
  pass("WebSocket connected to /bridge");

  // Send stateSnapshot (required first message per protocol)
  ws.send(JSON.stringify({
    type: "stateSnapshot",
    protocolVersion: "1",
    state: {
      workspaceName: "integration-test",
      workspaceFolders: ["/tmp/integration-test"],
      openEditors: [],
      visibleEditor: null,
      activeTerminalName: null,
      commentThreads: [],
    },
  }));

  // Send toolRegistry with all 40 tools
  ws.send(JSON.stringify({
    type: "toolRegistry",
    tools: FAKE_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: "object", properties: {} },
      ...(t.group ? { group: t.group } : {}),
    })),
  }));

  pass(`toolRegistry sent (${FAKE_TOOLS.length} tools)`);
  wsReady();
});

await wsReadyP;
// Give hub a moment to process the registry
await new Promise(r => setTimeout(r, 300));

// ── Step 3: Health shows all tools ───────────────────────────────────────────

console.log("\nStep 3: Health shows correct tool count");
const health2 = await httpJson("/health", { method: "GET" });
if (health2.toolCount === TOTAL_TOOLS) {
  pass(`toolCount = ${health2.toolCount} (expected ${TOTAL_TOOLS})`);
} else {
  fail(`toolCount = ${health2.toolCount} (expected ${TOTAL_TOOLS})`);
}
if (health2.bridge === "connected") pass("bridge status = connected");
else fail(`bridge status = ${health2.bridge} (expected 'connected')`);

// ── Step 4: /instructions lists ALL tools ────────────────────────────────────

console.log("\nStep 4: /instructions lists ALL tools");
const instructions = await httpJson("/instructions", { method: "GET", token: HUB_TOKEN });

if (typeof instructions !== "string") {
  fail("/instructions did not return a string: " + JSON.stringify(instructions));
} else {
  const toolSection = instructions.split("## Registered Tools")[1] ?? "";

  // Count how many tool names appear
  const toolsFound = FAKE_TOOLS.filter(t => instructions.includes(t.name));
  const toolsMissing = FAKE_TOOLS.filter(t => !instructions.includes(t.name));

  if (toolsFound.length === TOTAL_TOOLS) {
    pass(`All ${TOTAL_TOOLS} tools listed in /instructions`);
  } else {
    fail(`Only ${toolsFound.length}/${TOTAL_TOOLS} tools in /instructions`);
    toolsMissing.forEach(t => console.error(`    Missing: ${t.name}`));
  }

  // Verify presentation.open specifically (the one the agent couldn't see)
  if (instructions.includes("accordo_presentation_open")) {
    pass("accordo_presentation_open is visible in system prompt");
  } else {
    fail("accordo_presentation_open is MISSING from system prompt");
  }

  // Verify grouped tools are NOT hidden (e.g. editor.open has no discover stub)
  const groupedTools = FAKE_TOOLS.filter(t => t.group);
  const groupedFound = groupedTools.filter(t => instructions.includes(t.name));
  if (groupedFound.length === groupedTools.length) {
    pass(`All ${groupedTools.length} grouped tools visible (not hidden by group filter)`);
  } else {
    fail(`${groupedFound.length}/${groupedTools.length} grouped tools visible`);
  }

  // Verify descriptions are included (not just names)
  if (instructions.includes("Open a file in the editor")) {
    pass("Tool descriptions are included (not name-only)");
  } else {
    fail("Tool descriptions appear to be missing");
  }
}

// ── Step 5: MCP tools/list returns all 40 ────────────────────────────────────

console.log("\nStep 5: MCP tools/list via JSON-RPC");
const mcpResp = await httpJson("/mcp", {
  method: "POST",
  token: HUB_TOKEN,
  body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
});
const mcpTools = mcpResp?.result?.tools ?? [];

if (mcpTools.length === TOTAL_TOOLS) {
  pass(`MCP tools/list returned ${mcpTools.length} tools`);
} else {
  fail(`MCP tools/list returned ${mcpTools.length} (expected ${TOTAL_TOOLS})`);
}

// Check that presentation.open is in the MCP list
const presOpen = mcpTools.find(t => t.name === "accordo_presentation_open");
if (presOpen) pass("accordo_presentation_open in MCP tools/list");
else fail("accordo_presentation_open MISSING from MCP tools/list");

// ── Step 6: mcp.json format ───────────────────────────────────────────────────

console.log("\nStep 6: mcp.json file format on disk");
const mcpJsonPath = process.platform === "win32"
  ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Code", "User", "mcp.json")
  : join(homedir(), "Library", "Application Support", "Code", "User", "mcp.json");
try {
  const raw = readFileSync(mcpJsonPath, "utf8").trim();
  if (!raw) {
    // File exists but is empty — VS Code creates the placeholder; content is
    // only written when the Accordo bridge extension activates for the first time.
    console.log(`  ℹ mcp.json at ${mcpJsonPath} is empty — bridge extension has not run yet (skip)`);
    throw Object.assign(new Error("skip"), { skip: true });
  }
  const mcpJson = JSON.parse(raw);

  // Must be flat { servers: { accordo: ... } } — NOT nested under mcp.servers
  if ("servers" in mcpJson && !("mcp" in mcpJson)) {
    pass("mcp.json has correct flat format { servers: { ... } }");
  } else if ("mcp" in mcpJson) {
    fail('mcp.json uses deprecated nested format { mcp: { servers: {} } } — will trigger VS Code warning');
  } else {
    fail("mcp.json missing 'servers' key: " + JSON.stringify(Object.keys(mcpJson)));
  }

  const entry = mcpJson?.servers?.accordo;
  if (entry?.type === "http") pass(`accordo entry: type=http url=${entry.url}`);
  else fail("accordo entry missing or wrong type: " + JSON.stringify(entry));

  if (entry?.headers?.Authorization?.startsWith("Bearer ")) {
    pass("accordo entry has Authorization Bearer header");
  } else {
    fail("accordo entry missing Authorization header");
  }
} catch (e) {
  if (!e.skip) fail(`Could not read mcp.json at ${mcpJsonPath}: ${e.message}`);
}

// ── Step 7: SSE endpoint and tools/list_changed notification ─────────────────

console.log("\nStep 7: SSE endpoint + notifications/tools/list_changed");

// 7a: Check initialize capabilities declare listChanged:true
const initResp = await httpJson("/mcp", {
  method: "POST",
  token: HUB_TOKEN,
  body: {
    jsonrpc: "2.0", id: "cap-check",
    method: "initialize",
    params: { protocolVersion: "1", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  },
});
const toolsCap = initResp?.result?.capabilities?.tools;
if (toolsCap?.listChanged === true) {
  pass("initialize capabilities.tools.listChanged = true");
} else {
  fail(`initialize capabilities.tools.listChanged = ${JSON.stringify(toolsCap)} (expected {listChanged:true})`);
}

// 7b: Open SSE stream and capture a notification
let sseNotification = null;
const sseNotificationReceived = new Promise((resolve) => {
  (async () => {
    const url = `http://localhost:${PORT}/mcp`;
    const nodeHttp = await import("node:http");
    const sseReq = nodeHttp.default.request(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${HUB_TOKEN}`,
        Accept: "text/event-stream",
      },
    }, (sseRes) => {
      if (sseRes.statusCode !== 200) {
        fail(`GET /mcp SSE returned ${sseRes.statusCode} (expected 200)`);
        resolve(null);
        return;
      }
      const ct = sseRes.headers["content-type"] ?? "";
      if (ct.includes("text/event-stream")) {
        pass(`GET /mcp returns 200 with content-type: ${ct.split(";")[0]}`);
      } else {
        fail(`GET /mcp content-type = ${ct} (expected text/event-stream)`);
      }

      sseRes.on("data", (chunk) => {
        const text = chunk.toString();
        const lines = text.split("\n").filter(l => l.startsWith("data: "));
        for (const line of lines) {
          try {
            const msg = JSON.parse(line.slice(6));
            if (msg.method === "notifications/tools/list_changed") {
              sseNotification = msg;
              sseReq.destroy();
              resolve(msg);
            }
          } catch {}
        }
      });
    });
    sseReq.on("error", (e) => {
      if (!e.message.includes("socket hang up") && !e.message.includes("ECONNRESET")) {
        fail("SSE connection error: " + e.message);
      }
      resolve(null);
    });
    sseReq.end();
  })();
});

// Give SSE connection a moment to establish, then trigger a registry update
await new Promise(r => setTimeout(r, 300));

// Re-send toolRegistry with ONE extra tool to change tool names hash and trigger notification
ws.send(JSON.stringify({
  type: "toolRegistry",
  tools: [
    ...FAKE_TOOLS.map(t => ({
      name: t.name,
      description: t.description + " (updated)",
      inputSchema: { type: "object", properties: {} },
      ...(t.group ? { group: t.group } : {}),
    })),
    {
      name: "accordo_integration_test_probe",
      description: "Ephemeral probe tool for integration test",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

// Wait up to 2s for the notification
const notif = await Promise.race([
  sseNotificationReceived,
  new Promise(r => setTimeout(() => r(null), 2000)),
]);

if (notif?.method === "notifications/tools/list_changed") {
  pass("Received notifications/tools/list_changed over SSE after registry update");
} else {
  fail("Did NOT receive notifications/tools/list_changed over SSE within 2s");
}

// ── Done ──────────────────────────────────────────────────────────────────────

ws.close();
hub.kill();
await new Promise(r => setTimeout(r, 300));

const exitCode = process.exitCode ?? 0;
if (exitCode === 0) {
  console.log("\n✓ All checks passed\n");
} else {
  console.log("\n✗ Some checks FAILED — see above\n");
}
process.exit(exitCode);
