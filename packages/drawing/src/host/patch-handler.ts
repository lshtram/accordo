/**
 * accordo_drawing_patch handler.
 *
 * Replaces .mmd content then merges. Returns PatchReport.
 */
import { writeFile } from "node:fs/promises";
import {
  parseMermaidSource,
  buildSceneIndex,
  computeMergePlan,
  placeNewNodes,
  type DrawingToolContext,
  type PatchReport,
  DrawingError,
} from "../core/types.js";

function siblingExcalidraw(mmdPath: string): string {
  return mmdPath.replace(/\.mmd$/, ".excalidraw");
}

export async function patchDrawing(
  input: { path: string; content: string },
  ctx: DrawingToolContext
): Promise<PatchReport> {
  const { path, content } = input;

  if (!path.endsWith(".mmd")) {
    throw new DrawingError("invalid-argument", "path must end with .mmd");
  }

  const rel = path.replace(ctx.workspaceRoot, "");
  if (rel.startsWith("..") || rel.startsWith("/")) {
    throw new DrawingError("path-outside-workspace", "path is outside workspace root");
  }

  // Persist new .mmd content
  await writeFile(path, content, "utf8");

  const scenePath = siblingExcalidraw(path);

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
    const { readFile } = await import("node:fs/promises");
    sceneJson = JSON.parse(await readFile(scenePath, "utf8"));
  } catch {
    throw new DrawingError("scene-invalid", "could not parse .excalidraw file");
  }

  const sceneIndex = buildSceneIndex(sceneJson);

  // Compute merge plan
  let plan = computeMergePlan(sourceGraph, sceneIndex);

  if (plan.placementEngine === "accordo") {
    plan = placeNewNodes(plan, sourceGraph);
  }

  // Write updated scene
  const { readFile } = await import("node:fs/promises");
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