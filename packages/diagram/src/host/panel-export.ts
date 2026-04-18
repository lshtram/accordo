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
import { layoutDebug } from "../layout/layout-debug.js";

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
  if (!state._pendingExport) {
    layoutDebug({
      category: "panel-export",
      message: "canvas:export-ready ignored (no pending export)",
      data: {
        format,
        base64Length: data.length,
      },
    });
    return;
  }
  const { resolve, format: expectedFormat } = state._pendingExport;
  if (format !== expectedFormat) {
    layoutDebug({
      category: "panel-export",
      message: "canvas:export-ready ignored (format mismatch)",
      data: {
        format,
        expectedFormat,
        base64Length: data.length,
      },
    });
    return;
  }
  state._pendingExport = null;
  layoutDebug({
    category: "panel-export",
    message: "canvas:export-ready resolved pending export",
    data: {
      format,
      base64Length: data.length,
      byteLength: Buffer.byteLength(data, "base64"),
    },
  });
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
  layoutDebug({
    category: "panel-export",
    message: "requestExport called",
    data: {
      format,
      disposed: state._disposed,
      hasPendingExport: state._pendingExport !== null,
      mmdPath: state.mmdPath,
    },
  });

  if (state._disposed) {
    layoutDebug({
      category: "panel-export",
      message: "requestExport rejected: panel disposed",
      data: {
        format,
        mmdPath: state.mmdPath,
      },
    });
    throw new PanelDisposedError();
  }

  if (state._pendingExport !== null) {
    layoutDebug({
      category: "panel-export",
      message: "requestExport rejected: export busy",
      data: {
        format,
        pendingFormat: state._pendingExport.format,
      },
    });
    throw new ExportBusyError();
  }

  // Test override — allows test harness to resolve/reject without webview round-trip.
  // Must be called instead of the real implementation to prevent timeouts in tests
  // that don't simulate the canvas:export-ready message.
  if (ctx._testRequestExport) {
    layoutDebug({
      category: "panel-export",
      message: "requestExport delegated to test override",
      data: {
        format,
      },
    });
    return ctx._testRequestExport(ctx, format);
  }

  return new Promise<Buffer>((resolve, reject) => {
    state._pendingExport = { resolve, reject, format };
    const msg: HostRequestExportMessage = { type: "host:request-export", format };
    layoutDebug({
      category: "panel-export",
      message: "posted host:request-export",
      data: {
        format,
        hasPendingExport: state._pendingExport !== null,
      },
    });
    void ctx.panel.webview.postMessage(msg);
  });
}
