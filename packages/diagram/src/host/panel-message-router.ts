/**
 * Diagram Modularity — Webview message router.
 *
 * Routes incoming WebviewToHostMessage from the webview to the appropriate
 * host-layer handler (scene loader, layout patcher, export, comments).
 *
 * Layer: L4 (host/) — may import vscode, L0..L3.
 * Source: docs/reviews/diagram-modularity-A.md §panel-message-router.ts
 */

import type { WebviewToHostMessage } from "../webview/protocol.js";
import type { HostContext } from "./host-context.js";
import { patchLayout, handleNodeMoved, handleNodeResized, handleNodeStyled, persistEdgeWaypoints } from "./panel-layout-patcher.js";
import { handleExportReady } from "./panel-export.js";
import { routeCommentMessage } from "./panel-comments-adapter.js";

// ── routeWebviewMessage ──────────────────────────────────────────────────────

/**
 * Dispatch a webview-to-host message to the correct handler.
 *
 * Delegates to:
 *   - panel-scene-loader for canvas:ready
 *   - panel-layout-patcher for canvas:node-moved/resized/styled, canvas:edge-routed
 *   - panel-export for canvas:export-ready
 *   - panel-comments-adapter for comment:* messages
 *   - logging for canvas:js-error, canvas:timing
 *   - no-op with log for unimplemented messages (canvas:node-added, etc.)
 *
 * @param ctx - Host context with panel, state, and logging.
 * @param msg - The typed message from the webview.
 */
export function routeWebviewMessage(
  ctx: HostContext,
  msg: WebviewToHostMessage,
): void {
  const log = ctx.log ?? ((_m: string): void => { /* no-op */ });

  switch (msg.type) {
    case "canvas:ready": {
      const createTime = ctx.createTime ?? 0;
      log(`canvas:ready received — ${Date.now() - createTime}ms since create`);
      if (ctx.state.mmdPath === "") {
        const emptyMsg = { type: "host:load-scene", elements: [], appState: {} };
        void ctx.panel.webview.postMessage(emptyMsg);
      } else {
        // Use test override if set — wrap in Promise.resolve to handle
        // the case where the override is a sync spy (returns undefined).
        if (ctx._testLoadAndPost) {
          void Promise.resolve(ctx._testLoadAndPost()).then(() => {
            ctx.state._commentsBridge?.loadThreadsForUri();
          });
        } else {
          // Dynamically import loadAndPost to avoid circular dependency
          void import("./panel-scene-loader.js").then(({ loadAndPost }) => {
            void loadAndPost(ctx)
              .then(() => {
                ctx.state._commentsBridge?.loadThreadsForUri();
              })
              .catch(() => {
                // Errors surfaced via host:error-overlay inside loadAndPost; noop here.
              });
          });
        }
      }
      break;
    }
    case "canvas:node-moved": {
      const handler = ctx._testHandleNodeMoved ??
        ((nodeId: string, x: number, y: number) => handleNodeMoved(ctx, nodeId, x, y));
      handler(msg.nodeId, msg.x, msg.y);
      break;
    }
    case "canvas:node-resized": {
      const handler = ctx._testHandleNodeResized ??
        ((nodeId: string, w: number, h: number) => handleNodeResized(ctx, nodeId, w, h));
      handler(msg.nodeId, msg.w, msg.h);
      break;
    }
    case "canvas:node-styled": {
      handleNodeStyled(ctx, msg.nodeId, msg.style);
      break;
    }
    case "canvas:export-ready": {
      const handler = ctx._testHandleExportReady ??
        ((f: string, d: string) => handleExportReady(ctx, f, d));
      handler(msg.format, msg.data);
      break;
    }
    case "canvas:js-error":
      log("webview JS error: " + msg.message);
      break;
    case "canvas:timing":
      log(`[TIMING webview] ${msg.label}: ${msg.ms}ms`);
      break;
    case "canvas:edge-routed":
      persistEdgeWaypoints(ctx, msg);
      break;
    case "canvas:node-added":
    case "canvas:node-deleted":
    case "canvas:edge-added":
    case "canvas:edge-deleted":
      log(`[diag.2] ${msg.type} — not yet implemented`);
      break;
    case "comment:create":
    case "comment:reply":
    case "comment:resolve":
    case "comment:reopen":
    case "comment:delete": {
      log(`webview → host: ${msg.type} received; bridge=${ctx.state._commentsBridge ? "active" : "null"}`);
      routeCommentMessage(ctx, msg);
      break;
    }
    default:
      log("webview → host: unhandled message type: " + (msg as { type: string }).type);
      break;
  }
}
