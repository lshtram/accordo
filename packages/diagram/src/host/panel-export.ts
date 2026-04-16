/**
 * Diagram Modularity — Export handler.
 *
 * Handles the export flow: host requests export from webview, webview responds
 * with canvas:export-ready containing base64 data.
 *
 * Layer: L4 (host/) — may import vscode, L0..L3.
 * Source: docs/reviews/diagram-modularity-A.md §panel-export.ts
 */

import type { HostContext } from "./host-context.js";
import type { HostRequestExportMessage } from "../webview/protocol.js";
import { PanelFileNotFoundError, ExportBusyError, PanelDisposedError } from "../webview/panel.js";

// ── handleExportReady ────────────────────────────────────────────────────────

/**
 * Handle canvas:export-ready — resolves the pending export promise with a Buffer.
 *
 * No-op if there is no pending export or the format does not match.
 *
 * @param ctx    - Host context.
 * @param format - Export format ("svg" or "png").
 * @param data   - Base64-encoded export data from the webview.
 */
export function handleExportReady(
  ctx: HostContext,
  format: string,
  data: string,
): void {
  const state = ctx.state;
  if (!state._pendingExport) return;
  const { resolve, format: expectedFormat } = state._pendingExport;
  if (format !== expectedFormat) return;
  state._pendingExport = null;
  resolve(Buffer.from(data, "base64"));
}

// ── requestExport ────────────────────────────────────────────────────────────

/**
 * Request the webview to export the current canvas as SVG or PNG.
 *
 * Posts host:request-export and returns a Promise that resolves when the
 * webview responds with canvas:export-ready.
 *
 * Throws ExportBusyError if an export is already in progress.
 * Throws PanelDisposedError if the panel has been disposed.
 *
 * @param ctx    - Host context.
 * @param format - Desired export format.
 * @returns Buffer containing the exported image data.
 */
export async function requestExport(
  ctx: HostContext,
  format: "svg" | "png",
): Promise<Buffer> {
  const state = ctx.state;

  if (state._disposed) {
    throw new PanelDisposedError();
  }

  if (state._pendingExport !== null) {
    throw new ExportBusyError();
  }

  // Test override — allows test harness to resolve/reject without webview round-trip.
  // Must be called instead of the real implementation to prevent timeouts in tests
  // that don't simulate the canvas:export-ready message.
  if (ctx._testRequestExport) {
    return ctx._testRequestExport(ctx, format);
  }

  return new Promise<Buffer>((resolve, reject) => {
    state._pendingExport = { resolve, reject, format };
    const msg: HostRequestExportMessage = { type: "host:request-export", format };
    void ctx.panel.webview.postMessage(msg);
  });
}
