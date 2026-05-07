import * as vscode from "vscode";
import type { DrawingPanelLike } from "../core/types.js";

export async function ensureDrawingPanel(uri?: string): Promise<DrawingPanelLike | undefined> {
  const panels = (globalThis as { __accordoDrawingPanels?: Map<string, DrawingPanelLike> }).__accordoDrawingPanels;
  if (!panels) return undefined;
  if (uri) {
    const fsPath = normalizeFileUriToPath(uri);
    const existing = panels.get(fsPath) ?? panels.get(fsPath.replace(/\.excalidraw$/i, ".mmd"));
    if (existing) return existing;
    if (fsPath.endsWith(".mmd")) {
      await vscode.commands.executeCommand("accordo-drawing.open", vscode.Uri.file(fsPath));
      return panels.get(fsPath) ?? panels.get(fsPath.replace(/\.mmd$/i, ".excalidraw"));
    }
    if (fsPath.endsWith(".excalidraw")) {
      await vscode.commands.executeCommand("accordo-drawing.open", vscode.Uri.file(fsPath));
      return panels.get(fsPath) ?? panels.get(fsPath.replace(/\.excalidraw$/i, ".mmd"));
    }
  }
  return panels.values().next().value;
}

function normalizeFileUriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    return vscode.Uri.parse(uri).fsPath;
  }
  return uri;
}
