/**
 * accordo_drawing_merge handler.
 *
 * Reads both .mmd and .excalidraw, computes merge plan, writes updated scene.
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseMermaidSource, buildSceneIndex, computeMergePlan, placeNewNodes, type DrawingToolContext, type MergeReport, DrawingError } from "../core/types.js";
import { resolveWorkspaceMmdPath, siblingExcalidrawPath } from "./path-utils.js";

export async function mergeDrawing(
  input: { path: string; content?: string; open?: boolean },
  ctx: DrawingToolContext
): Promise<MergeReport> {
  const { path: rawPath, content } = input;
  const { absolutePath: path, sourcePath } = resolveWorkspaceMmdPath(rawPath, ctx.workspaceRoot);

  // Read .mmd (or use provided content)
  let mmdContent: string;
  if (content !== undefined) {
    mmdContent = content;
  } else {
    try {
      mmdContent = await readFile(path, "utf8");
    } catch {
      throw new DrawingError("file-not-found", "could not read .mmd file");
    }
  }

  const scenePath = siblingExcalidrawPath(path);

  // Write updated .mmd if content was provided
  if (content !== undefined) {
    await writeFile(path, content, "utf8");
  }

  // Parse Mermaid source
  let sourceGraph: ReturnType<typeof parseMermaidSource>;
  try {
    sourceGraph = parseMermaidSource(mmdContent);
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

  // Apply placement engine to newly added nodes
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
    merged: true,
    path,
    scenePath,
    placementEngine: plan.placementEngine,
    counts: plan.counts,
  };
}
