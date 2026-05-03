/**
 * Manifest contribution test — verifies accordo-comments-panel is registered
 * as a WebviewView in package.json.
 *
 * Without "type": "webview" in the view contribution, VS Code creates a TreeView
 * slot and registerWebviewViewProvider cannot provide data — resulting in the
 * error: "There is no data provider registered that can provide view data."
 *
 * This test reads the real package.json and asserts the webview type is present,
 * ensuring the manifest omission would cause a test failure rather than a
 * runtime surprise.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PACKAGE_JSON_PATH = resolve(__dirname, "../../package.json");

describe("package.json manifest contribution", () => {
  it("contributes accordo-comments-panel as a WebviewView (not TreeView)", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8"));

    const viewEntry = (pkg.contributes.views["accordo-comments"] as any[]).find(
      (v: any) => v.id === "accordo-comments-panel",
    );

    expect(viewEntry, "accordo-comments-panel must be present in contributes.views").toBeDefined();
    expect(viewEntry.type).toBe(
      "webview",
      `"type": "webview" is required — without it VS Code creates a TreeView slot ` +
        `and the "no data provider" error appears at runtime`,
    );
  });

  it("accordo-comments-panel view has required fields: id, name, type", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8"));

    const viewEntry = (pkg.contributes.views["accordo-comments"] as any[]).find(
      (v: any) => v.id === "accordo-comments-panel",
    );

    expect(viewEntry).toMatchObject({
      id: "accordo-comments-panel",
      name: "Comments",
      type: "webview",
    });
  });
});