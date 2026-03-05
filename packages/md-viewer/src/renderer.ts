/**
 * MarkdownRenderer — the full rendering pipeline for the Accordo markdown preview.
 *
 * Renders markdown to sanitized HTML with:
 *   - GFM (tables, strikethrough)
 *   - Task lists (@hackmd/markdown-it-task-lists)
 *   - Syntax highlighting via shiki (server-side, inline styles, matches VS Code theme)
 *   - Math typesetting via KaTeX (@traptitech/markdown-it-katex, server-side)
 *   - Mermaid diagram placeholders (rendered client-side by mermaid.js)
 *   - Footnotes (markdown-it-footnote)
 *   - Heading anchors (markdown-it-anchor)
 *   - Emoji (markdown-it-emoji)
 *   - Front matter stripping (markdown-it-front-matter)
 *   - Admonitions / callouts (markdown-it-container)
 *   - Block IDs for comment anchoring (blockIdPlugin)
 *   - Image URI resolution (absolute vscode-resource: URIs)
 *   - HTML sanitization (no <script> tags in output)
 *
 * Source: M41b — MarkdownRenderer
 *
 * Requirements:
 *   M41b-RND-01  GFM tables, strikethrough, task lists
 *   M41b-RND-02  Code blocks: shiki syntax highlighting, inline color styles
 *   M41b-RND-03  Inline math $...$ → KaTeX HTML
 *   M41b-RND-04  Display math $$...$$ → KaTeX display block
 *   M41b-RND-05  Mermaid fenced blocks → <div class="mermaid">...</div>
 *   M41b-RND-06  Footnotes → links + section
 *   M41b-RND-07  Emoji :rocket: → 🚀
 *   M41b-RND-08  Front matter → stripped from visible output
 *   M41b-RND-09  Heading anchors → id attributes
 *   M41b-RND-10  Admonitions :::note → <div class="admonition note">
 *   M41b-RND-11  data-block-id attributes on all block elements
 *   M41b-RND-12  Relative images → resolved URIs
 *   M41b-RND-13  <script> in markdown → not present in output HTML
 */

import type { BlockIdResolver } from "./block-id-plugin.js";
import { blockIdPlugin, BlockIdResolver as BlockIdResolverImpl, slugify } from "./block-id-plugin.js";
import { ImageResolver } from "./image-resolver.js";
import type MarkdownItLib from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type { Options as MdOptions } from "markdown-it";
import type Renderer from "markdown-it/lib/renderer.mjs";

// ── FenceRenderer ─────────────────────────────────────────────────────────────

/**
 * A fence renderer converts a fenced code block into HTML.
 * Runs server-side (extension host), not in the webview.
 *
 * @param code     Raw source inside the fence
 * @param attrs    Key/value pairs parsed from the fence info string (e.g. {engine="dot"})
 * @returns        HTML string to inline, or null to fall through to shiki syntax highlight
 *
 * Used to plug in: Kroki, Viz.js, Vega, WaveDrom, etc. without changing core renderer code.
 */
export type FenceRenderer = (
  code: string,
  attrs: Record<string, string>
) => Promise<string | null>;

// ── RenderOptions ─────────────────────────────────────────────────────────────

export interface RenderOptions {
  /**
   * Absolute file system path of the markdown document being rendered.
   * Used to resolve relative image paths.
   */
  docFsPath: string;

  /**
   * VS Code webview, used to produce vscode-resource: URIs for local images.
   * Pass `undefined` in unit tests (images will not be resolved).
   */
  webview?: WebviewLike;

  /**
   * The VS Code theme kind — used to choose the shiki highlighting theme.
   * 1 = light, 2 = dark, 3 = high contrast dark, 4 = high contrast light
   */
  themeKind?: 1 | 2 | 3 | 4;

  /**
   * Additional fence renderers keyed by language identifier.
   * Runs before the default shiki fallback.
   * Add WaveDrom, Viz.js, Vega, Plotly, Kroki processors here.
   */
  fenceRenderers?: Map<string, FenceRenderer>;
}

/** Minimal webview interface used by the renderer (avoids hard VSCode dependency in tests). */
export interface WebviewLike {
  asWebviewUri(uri: UriLike): UriLike;
}

/** Minimal URI interface. */
export interface UriLike {
  toString(): string;
  fsPath: string;
}

// ── RenderResult ─────────────────────────────────────────────────────────────

export interface RenderResult {
  /** Full sanitized HTML (no DOCTYPE/html/body wrappers — fragment only) */
  html: string;
  /** Bidirectional blockId ↔ source line mapping */
  resolver: BlockIdResolver;
}

// ── MarkdownRenderer ──────────────────────────────────────────────────────────

/**
 * Stateful renderer that holds the configured markdown-it instance and shiki highlighter.
 * Call `create()` to build the instance (async due to shiki initialization).
 */
export class MarkdownRenderer {
  private _md: MarkdownItLib | null = null;

  private constructor() {
    // Use MarkdownRenderer.create()
  }

  /**
   * Factory — creates and configures the full rendering pipeline.
   * Async because shiki requires async initialization.
   */
  static async create(): Promise<MarkdownRenderer> {
    const instance = new MarkdownRenderer();
    await instance._initMd();
    return instance;
  }

  private async _initMd(): Promise<void> {
    const [
      { default: MarkdownIt },
      { createHighlighter },
      { fromHighlighter },
      { default: markdownItKatex },
      { default: markdownItAnchor },
      { default: markdownItContainer },
      { full: markdownItEmoji },
      { default: markdownItFootnote },
      { default: markdownItFrontMatter },
      { default: taskLists },
    ] = await Promise.all([
      import("markdown-it"),
      import("shiki"),
      import("@shikijs/markdown-it"),
      import("@traptitech/markdown-it-katex"),
      import("markdown-it-anchor"),
      import("markdown-it-container"),
      import("markdown-it-emoji"),
      import("markdown-it-footnote"),
      import("markdown-it-front-matter"),
      import("@hackmd/markdown-it-task-lists"),
    ]);

    const highlighter = await createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: [
        "typescript", "javascript", "tsx", "jsx",
        "bash", "sh", "json", "jsonc", "css", "html",
        "python", "rust", "go", "yaml", "markdown",
        "diff", "sql", "xml", "toml", "dockerfile",
        "graphql", "c", "cpp", "java", "ruby",
        "php", "swift", "kotlin", "scala", "r",
        "ini", "plaintext",
      ],
    });

    const md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: false,
    });

    // ── Mermaid: convert mermaid fences to <div class="mermaid"> ──────────
    md.core.ruler.push("mermaid_convert", (state: StateCore) => {
      for (const token of state.tokens) {
        if (token.type === "fence" && token.info.trim().toLowerCase() === "mermaid") {
          token.type = "html_block";
          token.content = `<div class="mermaid">${md.utils.escapeHtml(token.content)}</div>\n`;
        }
      }
    });

    // ── Front matter stripping ────────────────────────────────────────────
    md.use(markdownItFrontMatter, () => { /* discard front matter */ });

    // ── GFM task lists ────────────────────────────────────────────────────
    md.use(taskLists);

    // ── Emoji ─────────────────────────────────────────────────────────────
    md.use(markdownItEmoji);

    // ── Footnotes ─────────────────────────────────────────────────────────
    md.use(markdownItFootnote);

    // ── Heading anchors ───────────────────────────────────────────────────
    md.use(markdownItAnchor, {
      slugify,
      tabIndex: false,
    });

    // ── Admonitions ───────────────────────────────────────────────────────
    for (const kind of ["note", "tip", "warning", "danger", "info"]) {
      md.use(markdownItContainer, kind, {
        render(tokens: Token[], idx: number) {
          if (tokens[idx].nesting === 1) {
            return `<div class="admonition ${kind}">\n`;
          }
          return "</div>\n";
        },
      });
    }

    // ── KaTeX math rendering ──────────────────────────────────────────────
    md.use(markdownItKatex);

    // ── Shiki syntax highlighting ─────────────────────────────────────────
    md.use(fromHighlighter(highlighter, {
      theme: "github-dark",
      // Gracefully fall back to plain text for unknown/unlisted languages
      fallbackLanguage: "plaintext",
    }));

    // ── BlockId plugin (wraps shiki's fence renderer) ──────────────────────
    md.use(blockIdPlugin);

    // ── Image URI resolution (per-render via env) ─────────────────────────
    md.renderer.rules.image = (
      tokens: Token[],
      idx: number,
      options: MdOptions,
      env: unknown,
      self: Renderer
    ) => {
      const token = tokens[idx];
      const rawSrc = token.attrGet("src") ?? "";
      const renderOpts = (env as { _renderOpts?: RenderOptions })?._renderOpts;
      if (renderOpts && rawSrc && renderOpts.webview) {
        const resolver = new ImageResolver({
          docFsPath: renderOpts.docFsPath,
          webview: renderOpts.webview,
          // In renderer context, optimistically attempt resolution (files exist in workspace)
          fs: { existsSync: () => true },
        });
        token.attrSet("src", resolver.resolve(rawSrc));
      }
      return self.renderToken(tokens, idx, options);
    };

    this._md = md;
  }

  /**
   * Render markdown to HTML with full pipeline.
   *
   * @param markdown  The raw markdown string
   * @param options   Rendering context (doc path, webview, theme)
   * @returns         Fragment HTML + blockId resolver
   */
  async render(markdown: string, options: RenderOptions): Promise<RenderResult> {
    const md = this._md!;
    const env = { _renderOpts: options };

    // Parse once — core rules run here
    const tokens = md.parse(markdown, env);

    // Build blockId mapping from the parsed token stream
    const resolver = new BlockIdResolverImpl();
    resolver.buildMappingFromTokens(tokens);

    // Render tokens to HTML (no second parse)
    let html = md.renderer.render(tokens, md.options, env);

    // Sanitize: strip any <script> tags that may have leaked through
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, "");

    return { html, resolver };
  }
}
