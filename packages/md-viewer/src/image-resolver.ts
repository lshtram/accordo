/**
 * ImageResolver — converts relative image paths in markdown to absolute
 * vscode-resource: URIs that webviews can load.
 *
 * Source: M41b — ImageResolver
 *
 * Requirements:
 *   M41b-IMG-01  Relative ./path.png + docUri → vscode-resource URI
 *   M41b-IMG-02  Absolute /path/to/img.png → vscode-resource URI
 *   M41b-IMG-03  http/https URIs → pass through unchanged
 *   M41b-IMG-04  data: URIs → pass through unchanged
 *   M41b-IMG-05  Non-existent path → return original (no throw)
 */

import type { WebviewLike, UriLike } from "./renderer.js";
import * as path from "path";
import { existsSync as fsExistsSync } from "fs";

// ── Injectable filesystem interface (for testing without real fs) ─────────────

export interface FsLike {
  existsSync(path: string): boolean;
}

// ── ImageResolverOptions ──────────────────────────────────────────────────────

export interface ImageResolverOptions {
  /** Absolute FS path of the markdown document being rendered */
  docFsPath: string;
  /** Webview whose asWebviewUri we call for local files — optional (tests may omit) */
  webview?: WebviewLike;
  /**
   * Factory to create a proper URI from a file system path.
   * In VS Code: pass `vscode.Uri.file`. Falls back to a plain object.
   */
  uriFromFsPath?: (fsPath: string) => UriLike;
  /** Injectable fs — defaults to real `fs` in production */
  fs?: FsLike;
}

// ── ImageResolver ─────────────────────────────────────────────────────────────

export class ImageResolver {
  private readonly _docFsPath: string;
  private readonly _webview: WebviewLike | undefined;
  private readonly _uriFromFsPath: (fsPath: string) => UriLike;
  private readonly _fs: FsLike;

  constructor(opts: ImageResolverOptions) {
    this._docFsPath = opts.docFsPath;
    this._webview = opts.webview;
    // Default URI factory — creates a plain object. In VS Code, pass vscode.Uri.file.
    this._uriFromFsPath = opts.uriFromFsPath ?? ((p: string) => ({ fsPath: p, toString: () => p }));
    // Default to real fs; tests inject a fake
    this._fs = opts.fs ?? { existsSync: fsExistsSync };
  }

  /**
   * M41b-IMG-01 / M41b-IMG-02 / M41b-IMG-03 / M41b-IMG-04 / M41b-IMG-05
   *
   * Resolve an image src attribute to a URI safe for use in the webview.
   *
   * @param rawSrc  The src attribute value from the markdown image token.
   */
  resolve(rawSrc: string): string {
    // Pass through http/https/data: URIs unchanged
    if (
      rawSrc.startsWith("http://") ||
      rawSrc.startsWith("https://") ||
      rawSrc.startsWith("data:")
    ) {
      return rawSrc;
    }

    // Resolve to absolute fs path
    const docDir = path.dirname(this._docFsPath);
    const fsPath = rawSrc.startsWith("/")
      ? rawSrc
      : path.resolve(docDir, rawSrc);

    // Non-existent file → return original src unchanged
    if (!this._fs.existsSync(fsPath)) {
      return rawSrc;
    }

    // No webview → return original (can't produce vscode-resource URI)
    if (!this._webview) {
      return rawSrc;
    }

    const uri = this._webview.asWebviewUri(this._uriFromFsPath(fsPath));
    return uri.toString();
  }
}
