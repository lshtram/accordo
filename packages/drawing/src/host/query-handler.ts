/**
 * accordo_drawing_query handler.
 *
 * Reads both files and returns sync status + counts. Non-mutating.
 */
import { readFile } from "node:fs/promises";
import { parseMermaidSource, buildSceneIndex, type DrawingToolContext, type QueryReport, DrawingError } from "../core/types.js";
import { resolveWorkspaceMmdPath, siblingExcalidrawPath } from "./path-utils.js";

export async function queryDrawing(
  input: { path: string; includeOrphans?: boolean; includeElements?: boolean },
  ctx: DrawingToolContext
): Promise<QueryReport> {
  const { path: rawPath, includeOrphans = false } = input;
  const { absolutePath: path } = resolveWorkspaceMmdPath(rawPath, ctx.workspaceRoot);

  const scenePath = siblingExcalidrawPath(path);

  // Parse source
  let sourceGraph: ReturnType<typeof parseMermaidSource>;
  let sourceType: QueryReport["sourceType"] = "flowchart";

  try {
    const mmdContent = await readFile(path, "utf8");
    sourceGraph = parseMermaidSource(mmdContent);
    sourceType = sourceGraph.type;
  } catch (err) {
    if (err instanceof DrawingError && err.code === "source-parse-failed") {
      return {
        path,
        scenePath,
        sourceType: "invalid",
        status: "source-invalid",
        counts: { managed: 0, unmanaged: 0, orphaned: 0 },
      };
    }
    throw err;
  }

  // Parse scene
  let sceneIndex: ReturnType<typeof buildSceneIndex>;
  try {
    const sceneJson = JSON.parse(await readFile(scenePath, "utf8"));
    sceneIndex = buildSceneIndex(sceneJson);
  } catch {
    return {
      path,
      scenePath,
      sourceType,
      status: "scene-invalid",
      counts: { managed: 0, unmanaged: 0, orphaned: 0 },
    };
  }

  const totalManaged = sceneIndex.activeManaged.length;
  const totalOrphaned = sceneIndex.orphanedManaged.length;
  const totalUnmanaged = sceneIndex.unmanaged.length;

  // Determine sync status
  const sourceIdentities = new Set([
    ...sourceGraph.nodes.map((n) => `node:${n.id}`),
    ...sourceGraph.edges.map((e) => `edge:${e.id}`),
  ]);
  const sceneIdentities = new Set(sceneIndex.activeManaged.map((el) => {
    const accordo = el.customData?.accordo;
    return `${accordo?.entityKind ?? "node"}:${accordo?.identity ?? ""}`;
  }));
  const needsMerge = sourceIdentities.size !== sceneIdentities.size ||
    [...sourceIdentities].some(id => !sceneIdentities.has(id)) ||
    [...sceneIdentities].some(id => !sourceIdentities.has(id));

  const status: QueryReport["status"] =
    sourceType === "unsupported" || sourceType === "invalid" ? "source-invalid" :
    totalOrphaned > 0 ? "needs-merge" :  // orphans need merge
    needsMerge ? "needs-merge" : "in-sync";

  const report: QueryReport = {
    path,
    scenePath,
    sourceType,
    status,
    counts: {
      managed: totalManaged,
      unmanaged: totalUnmanaged,
      orphaned: totalOrphaned,
    },
  };

  if (includeOrphans && totalOrphaned > 0) {
    report.orphans = sceneIndex.orphanedManaged.map(el => ({
      elementId: el.id,
      orphanReason: el.customData?.accordo?.orphanReason ?? "unknown",
    }));
  }

  return report;
}
