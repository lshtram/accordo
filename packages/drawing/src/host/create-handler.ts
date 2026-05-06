/**
 * accordo_drawing_create handler.
 *
 * Validates:
 * - path ends with .mmd
 * - content is a valid flowchart Mermaid source
 * - file doesn't already exist (unless force)
 *
 * Then writes both .mmd and sibling .excalidraw.
 *
 * Bootstrap model:
 * - create persists a bootstrap placeholder scene containing accordoSource mermaid
 * - the drawing webview performs browser-side @excalidraw/mermaid-to-excalidraw conversion
 *   on first open and then persists converted elements
 */
import { writeFile, access } from "node:fs/promises";
import {
  parseMermaidSource,
  type DrawingToolContext,
  type CreateReport,
  DrawingError,
} from "../core/types.js";
import { resolveWorkspaceMmdPath, siblingExcalidrawPath } from "./path-utils.js";

function isFlowchartType(graph: ReturnType<typeof parseMermaidSource>): boolean {
  return graph.type === "flowchart";
}

export async function createDrawing(
  input: { path: string; content: string; force?: boolean; open?: boolean },
  ctx: DrawingToolContext
): Promise<CreateReport> {
  const { path: rawPath, content, force = false, open = false } = input;
  const { absolutePath: path, sourcePath } = resolveWorkspaceMmdPath(rawPath, ctx.workspaceRoot);

  // Check already exists (unless force)
  if (!force) {
    try {
      await access(path);
      throw new DrawingError("already-exists", "file already exists at path");
    } catch (error) {
      if (error instanceof DrawingError) throw error;
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

  const scenePath = siblingExcalidrawPath(path);

  // Write .mmd
  await writeFile(path, content, "utf8");

  // Build initial bootstrap strategy
  const bootstrapEngine: "mermaid-to-excalidraw" | "empty" =
    sourceGraph.nodes.length > 0 ? "mermaid-to-excalidraw" : "empty";

  if (bootstrapEngine === "mermaid-to-excalidraw") {
    const sceneJson = {
      type: "excalidraw",
      version: 2,
      source: "https://accordo.dev/drawing",
      elements: [],
      files: {},
      accordoSource: {
        kind: "mermaid",
        path,
        sourcePath,
        content,
      },
    };
    await writeFile(scenePath, JSON.stringify(sceneJson), "utf8");
  } else {
    // Empty bootstrap
    const sceneJson = {
      type: "excalidraw",
      version: 2,
      source: "https://accordo.dev/drawing",
      elements: [],
      files: {},
    };
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
