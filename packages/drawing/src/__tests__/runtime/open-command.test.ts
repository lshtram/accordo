import { mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { activate } from "../../extension.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "drw-open-"));
  vi.clearAllMocks();
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(tmpDir), name: "test", index: 0 }];
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("accordo-drawing.open command", () => {
  it("creates a missing sibling .excalidraw before opening an .mmd", async () => {
    const mmdPath = join(tmpDir, "flow.mmd");
    const excalidrawPath = join(tmpDir, "flow.excalidraw");
    await writeFile(mmdPath, "flowchart LR\nStart --> Stop\n", "utf8");
    const context = new vscode.ExtensionContext();

    activate(context as never);
    const openCommand = vi.mocked(vscode.commands.registerCommand).mock.calls.find(([name]) => name === "accordo-drawing.open")?.[1];
    expect(openCommand).toBeDefined();

    await openCommand?.(vscode.Uri.file(mmdPath));

    const scene = JSON.parse(await readFile(excalidrawPath, "utf8")) as { elements?: unknown[]; accordoSource?: { kind?: string; content?: string } };
    expect(scene.elements).toEqual([]);
    expect(scene.accordoSource).toMatchObject({ kind: "mermaid", content: "flowchart LR\nStart --> Stop\n" });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "vscode.openWith",
      expect.objectContaining({ fsPath: excalidrawPath }),
      "accordo-drawing.drawingEditor",
    );
  });
});
