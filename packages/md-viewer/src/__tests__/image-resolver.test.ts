/**
 * ImageResolver — failing tests (Phase B)
 *
 * Requirements tested:
 *   M41b-IMG-01  Relative path → resolved against docFsPath
 *   M41b-IMG-02  Absolute file path → resolved directly
 *   M41b-IMG-03  http/https URL → returned unchanged
 *   M41b-IMG-04  data: URI → returned unchanged
 *   M41b-IMG-05  Nonexistent file → returns original src unchanged
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImageResolver } from "../image-resolver.js";

// ── Minimal mocks ─────────────────────────────────────────────────────────────

function makeWebview(resourceStr = "vscode-resource:{path}") {
  return {
    asWebviewUri: vi.fn((uri: { fsPath: string }) => ({
      toString: () => resourceStr.replace("{path}", uri.fsPath),
    })),
  };
}

function makeFs(existingPaths: string[] = []) {
  return {
    existsSync: (p: string) => existingPaths.includes(p),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ImageResolver", () => {
  let webview: ReturnType<typeof makeWebview>;

  beforeEach(() => {
    webview = makeWebview();
  });

  // ── M41b-IMG-01: Relative paths ───────────────────────────────────────────

  it("M41b-IMG-01: resolves ./relative path against document directory", () => {
    const fs = makeFs(["/project/docs/image.png"]);
    const resolver = new ImageResolver({
      docFsPath: "/project/docs/README.md",
      webview,
      fs,
    });

    const result = resolver.resolve("./image.png");
    expect(webview.asWebviewUri).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "/project/docs/image.png" })
    );
    expect(result).toContain("vscode-resource:");
  });

  it("M41b-IMG-01: resolves ../parent/image.png stepping up directory", () => {
    const fs = makeFs(["/project/assets/logo.png"]);
    const resolver = new ImageResolver({
      docFsPath: "/project/docs/README.md",
      webview,
      fs,
    });

    const result = resolver.resolve("../assets/logo.png");
    expect(webview.asWebviewUri).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "/project/assets/logo.png" })
    );
    expect(result).toContain("vscode-resource:");
  });

  it("M41b-IMG-01: relative path without leading dot resolves correctly", () => {
    const fs = makeFs(["/project/docs/img/diagram.svg"]);
    const resolver = new ImageResolver({
      docFsPath: "/project/docs/guide.md",
      webview,
      fs,
    });

    resolver.resolve("img/diagram.svg");
    expect(webview.asWebviewUri).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "/project/docs/img/diagram.svg" })
    );
  });

  // ── M41b-IMG-02: Absolute file paths ──────────────────────────────────────

  it("M41b-IMG-02: absolute /path/to/image.png resolves via asWebviewUri", () => {
    const fs = makeFs(["/var/images/banner.png"]);
    const resolver = new ImageResolver({
      docFsPath: "/project/README.md",
      webview,
      fs,
    });

    const result = resolver.resolve("/var/images/banner.png");
    expect(webview.asWebviewUri).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "/var/images/banner.png" })
    );
    expect(result).toContain("vscode-resource:");
  });

  // ── M41b-IMG-03: HTTP/HTTPS URLs ──────────────────────────────────────────

  it("M41b-IMG-03: http:// URL is returned unchanged", () => {
    const resolver = new ImageResolver({
      docFsPath: "/project/README.md",
      webview,
      fs: makeFs(),
    });

    const url = "http://example.com/image.png";
    const result = resolver.resolve(url);
    expect(result).toBe(url);
    expect(webview.asWebviewUri).not.toHaveBeenCalled();
  });

  it("M41b-IMG-03: https:// URL is returned unchanged", () => {
    const resolver = new ImageResolver({
      docFsPath: "/project/README.md",
      webview,
      fs: makeFs(),
    });

    const url = "https://cdn.example.com/logo.svg";
    const result = resolver.resolve(url);
    expect(result).toBe(url);
    expect(webview.asWebviewUri).not.toHaveBeenCalled();
  });

  // ── M41b-IMG-04: data: URIs ───────────────────────────────────────────────

  it("M41b-IMG-04: data: URI is returned unchanged", () => {
    const resolver = new ImageResolver({
      docFsPath: "/project/README.md",
      webview,
      fs: makeFs(),
    });

    const encoded = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=";
    const result = resolver.resolve(encoded);
    expect(result).toBe(encoded);
    expect(webview.asWebviewUri).not.toHaveBeenCalled();
  });

  // ── M41b-IMG-05: Nonexistent file ─────────────────────────────────────────

  it("M41b-IMG-05: nonexistent relative file returns original src unchanged", () => {
    const resolver = new ImageResolver({
      docFsPath: "/project/README.md",
      webview,
      fs: makeFs([]), // empty — no file exists
    });

    const original = "./missing-image.png";
    const result = resolver.resolve(original);
    expect(result).toBe(original);
    expect(webview.asWebviewUri).not.toHaveBeenCalled();
  });

  it("M41b-IMG-05: nonexistent absolute file returns original src unchanged", () => {
    const resolver = new ImageResolver({
      docFsPath: "/project/README.md",
      webview,
      fs: makeFs([]),
    });

    const original = "/no/such/image.jpg";
    const result = resolver.resolve(original);
    expect(result).toBe(original);
  });
});
