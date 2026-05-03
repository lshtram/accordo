/**
 * accordo_drawing_create handler.
 *
 * Validates:
 * - path ends with .mmd
 * - content is a valid flowchart Mermaid source
 * - file doesn't already exist (unless force)
 *
 * Then writes both .mmd and sibling .excalidraw.
 */
import { writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import {
  parseMermaidSource,
  buildSceneIndex,
  computeMergePlan,
  type DrawingToolContext,
  type CreateReport,
  DrawingError,
} from "../core/types.js";

function siblingExcalidraw(mmdPath: string): string {
  return mmdPath.replace(/\.mmd$/, ".excalidraw");
}

function isFlowchartType(graph: ReturnType<typeof parseMermaidSource>): boolean {
  return graph.type === "flowchart";
}

export async function createDrawing(
  input: { path: string; content: string; force?: boolean; open?: boolean },
  ctx: DrawingToolContext
): Promise<CreateReport> {
  const { path, content, force = false, open = false } = input;

  // Validate path extension
  if (!path.endsWith(".mmd")) {
    throw new DrawingError("invalid-argument", "path must end with .mmd");
  }

  // Check if path is in workspace
  const rel = path.replace(ctx.workspaceRoot, "");
  if (rel.startsWith("..") || rel.startsWith("/")) {
    throw new DrawingError("path-outside-workspace", "path is outside workspace root");
  }

  // Check already exists (unless force)
  if (!force) {
    try {
      await access(path);
      throw new DrawingError("already-exists", "file already exists at path");
    } catch {
      // expected — file doesn't exist
    }
  }

  // Validate Mermaid content — must be a flowchart
  let sourceGraph: ReturnType<typeof parseMermaidSource>;
  try {
    sourceGraph = parseMermaidSource(content);
  } catch {
    throw new DrawingError("source-parse-failed", "failed to parse Mermaid source");
  }

  if (!isFlowchartType(sourceGraph)) {
    throw new DrawingError("unsupported-diagram-type", "only flowchart diagrams are supported");
  }

  const scenePath = siblingExcalidraw(path);

  // Write .mmd
  await writeFile(path, content, "utf8");

  // Build initial excalidraw with positioned nodes (bootstrap mode)
  const bootstrapEngine: "mermaid-to-excalidraw" | "empty" =
    sourceGraph.nodes.length > 0 ? "mermaid-to-excalidraw" : "empty";

  if (bootstrapEngine === "mermaid-to-excalidraw") {
    // Bootstrap: convert Mermaid nodes to initial excalidraw elements
    const elements = sourceGraph.nodes.map((node, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      return {
        id: `-bootstrap-${node.id}-${Date.now()}`,
        type: "rectangle",
        x: 40 + col * PLACEMENT_GRID_PX * 4,
        y: 40 + row * PLACEMENT_GRID_PX * 4,
        width: 100,
        height: 40,
        customData: {
          accordo: {
            version: 1 as const,
            entityKind: "node" as const,
            identity: node.id,
            sceneRole: "primary" as const,
            sourcePath: path.replace(/^.*[/\\]/, ""),
            status: "active" as const,
          },
        },
      };
    });

    const sceneJson = { elements, version: 2 };
    await writeFile(scenePath, JSON.stringify(sceneJson), "utf8");
  } else {
    // Empty bootstrap
    const sceneJson = { elements: [], version: 2 };
    await writeFile(scenePath, JSON.stringify(sceneJson), "utf8");
  }

  return {
    created: true,
    path,
    scenePath,
    bootstrapEngine,
    opened: open,
  };
}

const PLACEMENT_GRID_PX = 40;