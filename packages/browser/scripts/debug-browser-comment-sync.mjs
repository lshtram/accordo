/**
 * debug-browser-comment-sync.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic CLI probe for browser comment sync flow.
 *
 * USAGE (from repo root):
 *   node packages/browser/scripts/debug-browser-comment-sync.mjs
 *
 * PREREQUISITES:
 *   - VS Code must be running with the accordo-browser extension loaded so
 *     that the shared relay server has written `~/.accordo/shared-relay.json`.
 *   - A Chrome browser with the Accordo extension must be connected to the
 *     shared relay (via the extension popup → pair button).
 *   - The `ws` package must be available in packages/browser/node_modules (it
 *     is a direct dependency of accordo-browser).
 *
 * BEHAVIOR:
 *   1. Reads ~/.accordo/shared-relay.json for host/port/token.
 *   2. Opens a Hub-mode WebSocket to the shared relay using a unique debug hubId.
 *   3. On hub-register-ack, sends a {action:'request_comment_state_sync'} probe.
 *   4. Listens for an incoming Chrome-originated sync_comment_state request.
 *      When received: counts pages/threads/comments, prints counts, and
 *      responds with success:true so Chrome can complete the relay cycle.
 *   5. Listens for the original request_comment_state_sync response.
 *      Prints success/data or error and exits 0 on success, non-zero on failure.
 *   6. Times out after 10 seconds with an explicit error.
 *
 * NOTE: This is a debug/dev-only script. Comment accordingly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import pkg from "../node_modules/ws/index.js";
const { WebSocket } = pkg;
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SHARED_RELAY_PATH = join(homedir(), ".accordo", "shared-relay.json");
const TIMEOUT_MS = 10_000;

function readSharedRelayInfo() {
  if (!existsSync(SHARED_RELAY_PATH)) {
    throw new Error(
      `Shared relay info not found at ${SHARED_RELAY_PATH}\n` +
      "Is VS Code running with the accordo-browser extension loaded?\n" +
      "The extension writes this file when it starts the shared relay server."
    );
  }
  const raw = readFileSync(SHARED_RELAY_PATH, "utf8");
  const info = JSON.parse(raw);
  if (!info.port || !info.token) {
    throw new Error(
      `Shared relay info at ${SHARED_RELAY_PATH} is missing required fields (port/token).\n` +
      `Found: ${Object.keys(info).join(", ")}`
    );
  }
  // host is always 127.0.0.1 per SBR architecture; the file does not store it
  return { host: "127.0.0.1", port: info.port, token: info.token };
}

async function waitFor(socket, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), TIMEOUT_MS);
    socket.on(event, (...args) => {
      clearTimeout(timeout);
      resolve(args);
    });
  });
}

async function main() {
  const relayInfo = readSharedRelayInfo();
  const hubId = `debug-browser-sync-${Date.now()}`;
  const url = `ws://${relayInfo.host}:${relayInfo.port}/hub?hubId=${encodeURIComponent(hubId)}&token=${encodeURIComponent(relayInfo.token)}&label=debug-browser-sync`;

  console.log(`[debug-browser-sync] connecting to shared relay at ${relayInfo.host}:${relayInfo.port}`);
  console.log(`[debug-browser-sync] hubId: ${hubId}`);

  const ws = new WebSocket(url);

  // Track state for the two-hop exchange
  let probeRequestId = null;
  let chromeSyncResponseResolver = null;
  let completed = false;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }

    // ── hub-register-ack ─────────────────────────────────────────────────────
    if (msg.kind === "hub-register-ack") {
      console.log(`[debug-browser-sync] hub-register-ack received (chromeConnected=${msg.chromeConnected})`);

      // Send the probe request
      probeRequestId = `debug-req-${Date.now()}`;
      const probe = {
        hubId,
        requestId: probeRequestId,
        action: "request_comment_state_sync",
        payload: { debug: true },
      };
      console.log(`[debug-browser-sync] sending request_comment_state_sync (requestId=${probeRequestId})`);
      ws.send(JSON.stringify(probe));
      return;
    }

    // ── Chrome-originated sync_comment_state (first hop) ──────────────────────
    // This arrives because the probe was forwarded to Chrome.
    if (msg.action === "sync_comment_state" && !completed) {
      const pages = msg.payload?.pages ?? [];
      const totalThreads = pages.reduce((sum, p) => sum + (p.threads ?? []).length, 0);
      const totalComments = pages.reduce((sum, p) =>
        sum + p.threads.reduce((s, t) => s + (t.comments ?? []).length, 0), 0);
      console.log(`[debug-browser-sync] received sync_comment_state from Chrome`);
      console.log(`  → pages: ${pages.length}, threads: ${totalThreads}, comments: ${totalComments}`);

      // Respond so Chrome's nested relay.send can complete
      const chromeResponse = { requestId: msg.requestId, success: true, data: msg.payload };
      ws.send(JSON.stringify(chromeResponse));
      console.log(`[debug-browser-sync] sent success response to Chrome for requestId=${msg.requestId}`);
      return;
    }

    // ── Original probe response (second hop) ────────────────────────────────
    if (msg.requestId === probeRequestId && typeof msg.success === "boolean" && !completed) {
      completed = true;
      if (msg.success) {
        const data = msg.data ?? {};
        const pages = data.pages ?? [];
        const totalThreads = pages.reduce((sum, p) => sum + (p.threads ?? []).length, 0);
        const totalComments = pages.reduce((sum, p) =>
          sum + p.threads.reduce((s, t) => s + (t.comments ?? []).length, 0), 0);
        console.log(`[debug-browser-sync] request_comment_state_sync success`);
        console.log(`  → pages: ${pages.length}, threads: ${totalThreads}, comments: ${totalComments}`);
        ws.close();
        process.exit(0);
      } else {
        console.error(`[debug-browser-sync] request_comment_state_sync failed: ${msg.error}`);
        ws.close();
        process.exit(1);
      }
    }
  });

  ws.on("open", () => {
    console.log(`[debug-browser-sync] WebSocket opened`);
  });

  ws.on("error", (err) => {
    console.error(`[debug-browser-sync] WebSocket error: ${err.message}`);
    process.exit(1);
  });

  // Wait for hub-register-ack or timeout
  try {
    await waitFor(ws, "message");
  } catch (err) {
    console.error(`[debug-browser-sync] ${err.message}`);
    console.error(`[debug-browser-sync] Timed out waiting for hub-register-ack. Is the relay server running?`);
    ws.close();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[debug-browser-sync] Fatal: ${err.message}`);
  process.exit(1);
});