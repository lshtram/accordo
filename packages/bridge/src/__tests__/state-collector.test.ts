import { describe, expect, it } from "vitest";
import {
  deriveOpenEditors,
  deriveOpenTabs,
  deriveActiveFileFromTabs,
  deriveVisibleEditorsFromTabs,
  isTabInputText,
  isTabInputWebview,
  normalizePath,
  type TabGroup,
} from "../state-collector.js";

describe("state-collector helpers", () => {
  it("normalizePath converts backslashes to forward slashes", () => {
    expect(normalizePath("C:\\repo\\file.ts")).toBe("C:/repo/file.ts");
  });

  it("type guards detect text and webview inputs", () => {
    expect(isTabInputText({ uri: { fsPath: "/tmp/a.ts" } })).toBe(true);
    expect(isTabInputWebview({ viewType: "accordo.diagram" })).toBe(true);
    expect(isTabInputText({ viewType: "x" })).toBe(false);
    expect(isTabInputWebview({ uri: { fsPath: "/tmp/a.ts" } })).toBe(false);
  });

  it("deriveOpenEditors returns deduped normalized text paths", () => {
    const groups: TabGroup[] = [
      { tabs: [{ label: "a", input: { uri: { fsPath: "C:\\repo\\a.ts" } } }] },
      { tabs: [{ label: "a copy", input: { uri: { fsPath: "C:\\repo\\a.ts" } } }] },
    ];
    expect(deriveOpenEditors(groups)).toEqual(["C:/repo/a.ts"]);
  });

  it("deriveOpenTabs classifies text/webview/other tabs", () => {
    const groups: TabGroup[] = [
      {
        tabs: [
          { label: "a.ts", isActive: true, input: { uri: { fsPath: "/repo/a.ts" } } },
          { label: "Diagram", input: { viewType: "accordo.diagram" } },
          { label: "Welcome", input: {} },
        ],
      },
    ];

    expect(deriveOpenTabs(groups)).toEqual([
      { label: "a.ts", type: "text", path: "/repo/a.ts", isActive: true, groupIndex: 0 },
      { label: "Diagram", type: "webview", viewType: "accordo.diagram", isActive: false, groupIndex: 0 },
      { label: "Welcome", type: "other", isActive: false, groupIndex: 0 },
    ]);
  });

  it("deriveOpenTabs classifies URI-bearing webviews as webview with path", () => {
    const groups: TabGroup[] = [
      {
        tabs: [
          { label: "README.md", isActive: true, input: { viewType: "markdown.preview", uri: { fsPath: "/repo/README.md" } } },
        ],
      },
    ];

    expect(deriveOpenTabs(groups)).toEqual([
      { label: "README.md", type: "webview", path: "/repo/README.md", viewType: "markdown.preview", isActive: true, groupIndex: 0 },
    ]);
  });

  it("deriveActiveFileFromTabs returns the active URI-bearing tab path", () => {
    const groups: TabGroup[] = [
      { tabs: [{ label: "README.md", isActive: true, input: { viewType: "markdown.preview", uri: { fsPath: "/repo/README.md" } } }] },
    ];

    expect(deriveActiveFileFromTabs(groups)).toBe("/repo/README.md");
  });

  it("deriveVisibleEditorsFromTabs returns active URI-bearing tabs from each group", () => {
    const groups: TabGroup[] = [
      { tabs: [{ label: "A", isActive: true, input: { uri: { fsPath: "/repo/a.ts" } } }] },
      { tabs: [{ label: "B", isActive: true, input: { viewType: "markdown.preview", uri: { fsPath: "/repo/b.md" } } }] },
    ];

    expect(deriveVisibleEditorsFromTabs(groups)).toEqual(["/repo/a.ts", "/repo/b.md"]);
  });
});
