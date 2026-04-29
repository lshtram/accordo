/**
 * Preview highlight DOM-script tests.
 *
 * Requirements tested:
 *   M41b-HLT-05  webview applies preview highlights to matching data-block-id elements
 *   M41b-HLT-06  clear by decorationId removes only that preview highlight
 *   M41b-HLT-07  clear-all removes all preview highlights for the target URI
 */

import { describe, it, expect } from "vitest";
import vm from "node:vm";
import { buildWebviewHtml } from "../webview-template.js";

class FakeClassList {
  private readonly names = new Set<string>();

  add(name: string): void { this.names.add(name); }
  remove(name: string): void { this.names.delete(name); }
  contains(name: string): boolean { return this.names.has(name); }
}

class FakeStyle {
  backgroundColor = "";

  removeProperty(name: string): void {
    if (name === "background-color") this.backgroundColor = "";
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly style = new FakeStyle();
  readonly attrs = new Map<string, string>();
  __accordoHighlightColors?: Record<string, string>;

  constructor(blockId: string) {
    this.attrs.set("data-block-id", blockId);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  getBoundingClientRect(): { left: number; top: number } {
    return { left: 0, top: 0 };
  }

  scrollIntoView(): void {}
}

function html(): string {
  return buildWebviewHtml({
    nonce: "nonce-123",
    body: '<p data-block-id="paragraph-a">Hello</p><p data-block-id="paragraph-b">World</p>',
    katexCssUri: "katex.css",
    mermaidJsUri: "mermaid.js",
    sdkJsUri: "sdk.js",
    sdkCssUri: "sdk.css",
    markdownCssUri: "markdown.css",
    themeKind: 2,
    cspSource: "vscode-webview://test",
  });
}

function runWebviewScript() {
  const output = html();
  const scriptMatch = output.match(/<script nonce="nonce-123">([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error("inline script not found");

  const elements = new Map([
    ["paragraph-a", new FakeElement("paragraph-a")],
    ["paragraph-b", new FakeElement("paragraph-b")],
  ]);
  let messageListener: ((event: { data: unknown }) => void) | undefined;
  const posted: unknown[] = [];

  const document = {
    body: { classList: new FakeClassList() },
    querySelector(selector: string): FakeElement | null {
      const blockId = selector.match(/\[data-block-id="([^"]+)"\]/)?.[1];
      return blockId ? elements.get(blockId) ?? null : null;
    },
    querySelectorAll(selector: string): FakeElement[] {
      const all = Array.from(elements.values());
      if (selector === "[data-accordo-highlight-id]") {
        return all.filter((el) => el.getAttribute("data-accordo-highlight-id") !== null);
      }
      if (selector === ".accordo-preview-highlight") {
        return all.filter((el) => el.classList.contains("accordo-preview-highlight"));
      }
      return [];
    },
  };

  vm.runInNewContext(scriptMatch[1], {
    AccordoSDK: { AccordoCommentSDK: class { init(): void {}; loadThreads(): void {}; addThread(): void {}; updateThread(): void {}; removeThread(): void {}; openPopover(): void {} } },
    acquireVsCodeApi: () => ({ postMessage: (msg: unknown) => posted.push(msg) }),
    console,
    document,
    mermaid: { initialize(): void {}, run: () => Promise.resolve() },
    window: {
      scrollX: 0,
      scrollY: 0,
      addEventListener(_type: string, listener: (event: { data: unknown }) => void): void {
        messageListener = listener;
      },
    },
  });

  return {
    elements,
    posted,
    dispatch(data: unknown): void {
      if (!messageListener) throw new Error("message listener not registered");
      messageListener({ data });
    },
  };
}

describe("PreviewHighlightDOM (M41b-HLT-05, M41b-HLT-06, M41b-HLT-07)", () => {
  it("M41b-HLT-05: applies preview highlights to matching data-block-id elements", () => {
    const { dispatch, elements } = runWebviewScript();

    dispatch({
      type: "preview:applyHighlight",
      decorationId: "h1",
      blockIds: ["paragraph-a", "paragraph-b"],
      color: "rgba(255, 0, 0, 0.5)",
    });

    for (const id of ["paragraph-a", "paragraph-b"]) {
      const el = elements.get(id)!;
      expect(el.classList.contains("accordo-preview-highlight")).toBe(true);
      expect(el.getAttribute("data-accordo-highlight-id")).toBe("h1");
      expect(el.style.backgroundColor).toBe("rgba(255, 0, 0, 0.5)");
    }
  });

  it("M41b-HLT-06: clear by decorationId preserves overlapping highlight color", () => {
    const { dispatch, elements } = runWebviewScript();
    const el = elements.get("paragraph-a")!;

    dispatch({ type: "preview:applyHighlight", decorationId: "h1", blockIds: ["paragraph-a"], color: "yellow" });
    dispatch({ type: "preview:applyHighlight", decorationId: "h2", blockIds: ["paragraph-a"], color: "red" });
    dispatch({ type: "preview:clearHighlight", decorationId: "h2" });

    expect(el.classList.contains("accordo-preview-highlight")).toBe(true);
    expect(el.getAttribute("data-accordo-highlight-id")).toBe("h1");
    expect(el.style.backgroundColor).toBe("yellow");
  });

  it("M41b-HLT-07: clear-all removes all preview highlight classes and state", () => {
    const { dispatch, elements } = runWebviewScript();

    dispatch({ type: "preview:applyHighlight", decorationId: "h1", blockIds: ["paragraph-a", "paragraph-b"], color: "yellow" });
    dispatch({ type: "preview:clearAllHighlights" });

    for (const el of elements.values()) {
      expect(el.classList.contains("accordo-preview-highlight")).toBe(false);
      expect(el.getAttribute("data-accordo-highlight-id")).toBeNull();
      expect(el.style.backgroundColor).toBe("");
    }
  });
});
