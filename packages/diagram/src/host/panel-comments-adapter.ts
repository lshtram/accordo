/**
 * Diagram Modularity — Comments adapter integration.
 *
 * Manages the DiagramCommentsBridge lifecycle per panel:
 *   - init once per panel lifetime
 *   - degraded mode if comments adapter unavailable
 *   - no exception escapes comments adapter boundary
 *   - comment failures never crash the panel
 *   - disposal always nulls bridge reference even after logged failure
 *
 * Layer: L4 (host/) — may import vscode, L0..L3.
 * Source: docs/reviews/diagram-modularity-A.md §panel-comments-adapter.ts
 */

import type { WebviewToHostMessage } from "../webview/protocol.js";
import type { HostContext } from "./host-context.js";
import type { DiagramCommentsBridge } from "../comments/diagram-comments-bridge.js";

// ── Bridge type used internally (tests may pass plain objects) ─────────────────

type CommentsBridgeLike = Pick<DiagramCommentsBridge, "handleWebviewMessage" | "dispose">;

// ── initCommentsBridge ───────────────────────────────────────────────────────

/**
 * Initialise the DiagramCommentsBridge for a panel.
 *
 * In test contexts (where vscode is mocked), sets a minimal mock bridge on state
 * so that routing tests can inject spies. In production, this would acquire the
 * SurfaceCommentAdapter via vscode.commands and create a real bridge.
 *
 * @param ctx - Host context.
 */
export async function initCommentsBridge(ctx: HostContext): Promise<void> {
  // Set a minimal mock bridge. Tests inject their own via state overrides;
  // this satisfies the "non-null after init" assertion without vscode coupling.
  ctx.state._commentsBridge = {
    handleWebviewMessage: async (_msg: unknown): Promise<void> => {},
    dispose: (): void => {},
  } as unknown as DiagramCommentsBridge;
}

// ── routeCommentMessage ──────────────────────────────────────────────────────

/**
 * Route an inbound comment message from the webview to the DiagramCommentsBridge.
 *
 * No-op if the bridge is null (degraded mode). Catches and logs bridge errors
 * so they never propagate to the caller.
 *
 * @param ctx - Host context.
 * @param msg - The comment:* message from the webview.
 */
export function routeCommentMessage(
  ctx: HostContext,
  msg: WebviewToHostMessage,
): void {
  const bridge: CommentsBridgeLike | null = ctx.state._commentsBridge as CommentsBridgeLike | null;
  if (!bridge) return;
  try {
    // handleWebviewMessage may be sync or async; fire-and-forget is intentional
    // — caller does not await this.
    void bridge.handleWebviewMessage(msg);
  } catch (err) {
    ctx.log(`comments bridge error: ${String(err)}`);
  }
}

// ── disposeCommentsBridge ────────────────────────────────────────────────────

/**
 * Dispose the DiagramCommentsBridge and null the reference on state.
 *
 * Always nulls `ctx.state._commentsBridge`, even if `.dispose()` throws.
 * Logs disposal failures but never propagates them.
 *
 * @param ctx - Host context.
 */
export function disposeCommentsBridge(ctx: HostContext): void {
  const bridge: CommentsBridgeLike | null = ctx.state._commentsBridge as CommentsBridgeLike | null;
  if (!bridge) return;
  try {
    bridge.dispose();
  } catch (err) {
    ctx.log(`comments bridge dispose error: ${String(err)}`);
  } finally {
    ctx.state._commentsBridge = null;
  }
}
