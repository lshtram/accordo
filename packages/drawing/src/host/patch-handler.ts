/**
 * accordo_drawing_patch handler.
 *
 * Replaces .mmd content then merges. Returns PatchReport.
 */
import { readFile, writeFile } from "node:fs/promises";
import {
  parseMermaidSource,
  buildSceneIndex,
  computeMergePlan,
  placeNewNodes,
  type DrawingToolContext,
  type PatchReport,
  DrawingError,
} from "../core/types.js";
import { resolveWorkspaceMmdPath, siblingExcalidrawPath } from "./path-utils.js";

export async function patchDrawing(
  input: { path: string; content: string },
  ctx: DrawingToolContext
): Promise<PatchReport> {
  const { path: rawPath, content } = input;
  const { absolutePath: path, sourcePath } = resolveWorkspaceMmdPath(rawPath, ctx.workspaceRoot);

  // Persist new .mmd content
  await writeFile(path, content, "utf8");

  const scenePath = siblingExcalidrawPath(path);

  // Parse new source
  let sourceGraph: ReturnType<typeof parseMermaidSource>;
  try {
    sourceGraph = parseMermaidSource(content);
  } catch {
    throw new DrawingError("source-parse-failed", "failed to parse Mermaid source");
  }

  // Read and index scene
  let sceneJson: unknown;
  try {
    sceneJson = JSON.parse(await readFile(scenePath, "utf8"));
  } catch {
    sceneJson = { elements: [], version: 2 };
  }

  const sceneIndex = buildSceneIndex(sceneJson);

  // Compute merge plan
  let plan = computeMergePlan(sourceGraph, sceneIndex, sourcePath);

  if (plan.placementEngine === "accordo") {
    plan = placeNewNodes(plan, sourceGraph);
  }

  // Write updated scene
  const updatedScene = {
    elements: [
      ...plan.preserved,
      ...plan.updated,
      ...plan.added,
      ...plan.orphaned,
      ...plan.unmanaged,
    ],
    version: 2,
  };
  await writeFile(scenePath, JSON.stringify(updatedScene), "utf8");

  return {
    patched: true,
    merged: true,
    path,
    scenePath,
    placementEngine: plan.placementEngine,
    counts: plan.counts,
  };
}
