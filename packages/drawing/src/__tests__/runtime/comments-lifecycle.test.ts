/**
 * DRW-RT09, DRW-CUI04 — Extension command registration smoke tests.
 *
 * DRW-C07: The drawing extension must register `accordo_diagram_focusThread`
 * so the Comments panel can dispatch to it.
 *
 * These tests are smoke tests for command registration only.
 * Full provider lifecycle tests are in comment-parity-runtime.test.ts.
 *
 * Proof surfaces: DRW-RT09 (runtime/MCP), DRW-CUI04 (UI/E2E)
 * Requirements: DRW-C07
 *
 * Source: docs/20-requirements/requirements-drawing.md §6.6 (DRW-C07)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as vscode from "vscode";
import { activate } from "../../extension.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "drw-lifecycle-"));
  vi.clearAllMocks();
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpDir, scheme: "file", path: tmpDir } as unknown as vscode.Uri, name: "test", index: 0 }];
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("comments/extension-lifecycle", () => {
  it("DRW-RT09: accordo_diagram_focusThread is registered on activation", () => {
    /**
     * DRW-C07: The drawing extension must register `accordo_diagram_focusThread`
     * so the Comments panel can dispatch to it.
     *
     * Phase B: The command is not yet registered. This test FAILS at assertion level.
     */
    const context = new vscode.ExtensionContext();
    activate(context);

    const focusThreadReg = vi.mocked(vscode.commands.registerCommand).mock.calls.find(
      ([name]: [string]) => name === "accordo_diagram_focusThread"
    );

    expect(focusThreadReg).toBeDefined();
    expect(focusThreadReg![1]).toBeDefined();
  });
});
