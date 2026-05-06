import { isAbsolute, relative, resolve } from "node:path";
import { DrawingError } from "../core/types.js";

export function resolveWorkspaceMmdPath(inputPath: string, workspaceRoot: string): { absolutePath: string; sourcePath: string } {
  if (!inputPath.endsWith(".mmd")) {
    throw new DrawingError("invalid-argument", "path must end with .mmd");
  }

  const root = resolve(workspaceRoot);
  const absolutePath = resolve(root, inputPath);
  const rel = relative(root, absolutePath);

  if (
    rel === "" ||
    rel === "." ||
    rel.startsWith("..") ||
    isAbsolute(rel)
  ) {
    throw new DrawingError("path-outside-workspace", "path is outside workspace root");
  }

  return {
    absolutePath,
    sourcePath: rel.replace(/\\/g, "/"),
  };
}

export function siblingExcalidrawPath(mmdPath: string): string {
  return mmdPath.replace(/\.mmd$/, ".excalidraw");
}
