/**
 * accordo_drawing_render handler.
 *
 * Requires the drawing panel to be open.
 * Uses the panel's requestExport to produce PNG/SVG output.
 */
import { writeFile } from "node:fs/promises";
import type { DrawingToolContext, RenderReport } from "../core/types.js";
import { DrawingError } from "../core/types.js";
import { resolveWorkspaceMmdPath, siblingExcalidrawPath } from "./path-utils.js";
import { EXCALIDRAW_PACKAGE_VERSION } from "../core/excalidraw-fonts.js";

export async function renderDrawing(
  input: { path: string; format: "png" | "svg"; outputPath?: string },
  ctx: DrawingToolContext
): Promise<RenderReport> {
  const { path: rawPath, format, outputPath } = input;
  const { absolutePath: path } = resolveWorkspaceMmdPath(rawPath, ctx.workspaceRoot);
  const scenePath = siblingExcalidrawPath(path);

  // Require panel to be open
  let panel = ctx.getPanel(path);
  const mayBeDesyncedVisiblePanel = panel === undefined && (ctx.hasVisiblePanelTab?.(path) ?? false);
  if (!panel && mayBeDesyncedVisiblePanel && ctx.ensurePanelOpen) {
    try {
      await ctx.ensurePanelOpen(path);
    } catch {
      // fall through and keep panel-not-open contract if panel still unresolved
    }
    panel = ctx.getPanel(path);
  }
  if (!panel) {
    throw new DrawingError("panel-not-open", "drawing panel is not open");
  }

  let output: Buffer;
  try {
    output = await panel.requestExport(format);
  } catch {
    throw new DrawingError("render-failed", "panel requestExport failed");
  }

  const finalPath = outputPath ?? scenePath.replace(/\.excalidraw$/, `.${format}`);
  if (format === "svg") {
    const svgText = output.toString("utf8")
      .replaceAll(
        "@undefined/dist/excalidraw-assets/",
        `@${EXCALIDRAW_PACKAGE_VERSION}/dist/excalidraw-assets/`
      )
      .replaceAll(
        "https://unpkg.com/@excalidraw/excalidraw@undefined/",
        `https://unpkg.com/@excalidraw/excalidraw@${EXCALIDRAW_PACKAGE_VERSION}/`
      );
    await writeFile(finalPath, svgText, "utf8");
  } else {
    await writeFile(finalPath, output);
  }

  return {
    rendered: true,
    path,
    format,
    outputPath: finalPath,
  };
}
