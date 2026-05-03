/**
 * accordo_drawing_render handler.
 *
 * Requires the drawing panel to be open.
 * Uses the panel's requestExport to produce PNG/SVG output.
 */
import type { DrawingToolContext, RenderReport, DrawingError } from "../core/types.js";

function siblingExcalidraw(mmdPath: string): string {
  return mmdPath.replace(/\.mmd$/, ".excalidraw");
}

export async function renderDrawing(
  input: { path: string; format: "png" | "svg"; outputPath?: string },
  ctx: DrawingToolContext
): Promise<RenderReport> {
  const { path, format, outputPath } = input;

  if (!path.endsWith(".mmd")) {
    throw new DrawingError("invalid-argument", "path must end with .mmd");
  }

  const rel = path.replace(ctx.workspaceRoot, "");
  if (rel.startsWith("..") || rel.startsWith("/")) {
    throw new DrawingError("path-outside-workspace", "path is outside workspace root");
  }

  const scenePath = siblingExcalidraw(path);

  // Require panel to be open
  const panel = ctx.getPanel(path);
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

  // Write output file
  const { writeFile } = await import("node:fs/promises");
  await writeFile(finalPath, output);

  return {
    rendered: true,
    path,
    format,
    outputPath: finalPath,
  };
}