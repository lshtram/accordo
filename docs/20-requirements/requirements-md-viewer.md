# accordo-md-viewer — Requirements Specification

**Package:** `accordo-md-viewer`  
**Type:** VSCode extension  
**Publisher:** `accordo`  
**Version:** 0.1.0  
**Date:** 2025-01-01

---

## 1. Purpose

Accordo Markdown Viewer is a standalone VS Code extension that renders `.md` files as a rich, interactive HTML preview with integrated comment pins powered by `@accordo/comment-sdk`. It implements VS Code's `CustomTextEditorProvider` API to render markdown files inside a `WebviewPanel`, injecting rendered HTML with block-level anchors (`data-block-id` attributes) so the SDK can place comment pins at precise document locations.

The package depends on `accordo-comments` (for thread storage) and `@accordo/comment-sdk` (for the webview-side pin UI). It does not register tools itself.

---

## 2. Extension Manifest Contract

```json
{
  "name": "accordo-md-viewer",
  "displayName": "Accordo Markdown Viewer",
  "publisher": "accordo",
  "version": "0.1.0",
  "engines": { "vscode": "^1.100.0" },
  "extensionKind": ["workspace"],
  "activationEvents": ["onStartupFinished"],
  "extensionDependencies": ["accordo.accordo-bridge", "accordo.accordo-comments"],
  "main": "./dist/extension.js",
  "contributes": {
    "customEditors": [
      {
        "viewType": "accordo.markdownPreview",
        "displayName": "Accordo Markdown Preview",
        "selector": [{ "filenamePattern": "*.md" }],
        "priority": "option"
      }
    ],
    "commands": [
      { "command": "accordo.preview.open", "title": "Accordo: Open Markdown Preview" },
      { "command": "accordo.preview.toggle", "title": "Accordo: Toggle Preview/Source" },
      { "command": "accordo.preview.openSideBySide", "title": "Accordo: Open Preview Side by Side" }
    ],
    "configuration": {
      "properties": {
        "accordo.preview.defaultSurface": {
          "type": "string",
          "enum": ["viewer", "text"],
          "default": "viewer"
        }
      }
    },
    "keybindings": [
      {
        "command": "accordo.preview.toggle",
        "key": "shift+cmd+v",
        "when": "editorLangId == markdown"
      }
    ]
  }
}
```

### Design Notes

- `priority: "option"` preserves the built-in text editor as the default. Users can right-click a `.md` file → "Open With…" → "Accordo Markdown Preview" to use the viewer.
- The viewer opens alongside the source editor (side by side) via `accordo.preview.openSideBySide`.

---

## 3. Rendering Pipeline

```
.md file (disk)
  ↓  markdown-it.parse()               [block-id-plugin: inject data-block-id tokens]
  ↓  markdown-it.render()              [shiki syntax highlight, KaTeX math, mermaid fence]
  ↓  ImageResolver.resolve()           [rewrite image src → webview URI]
  ↓  buildWebviewHtml()                [wrap in full HTML page: CSP, nonce, SDK script]
  ↓  webview.html = ...                [VS Code renders the WebviewPanel]
```

Mermaid diagrams are rendered **client-side** in the webview via the mermaid.js library. All other transformations run in the extension host.

---

## 4. Block-ID Anchor Model

Every block-level HTML element in the rendered output receives a `data-block-id` attribute. This enables the Comment SDK to map `SdkThread.blockId` values back to DOM elements for pin placement.

```html
<h2 data-block-id="heading:2:introduction">Introduction</h2>
<p data-block-id="p:0">First paragraph text…</p>
<li data-block-id="li:0:0">List item</li>
<pre data-block-id="pre:0"><code>…</code></pre>
```

| Block element | ID strategy |
|---|---|
| `h1`–`h6` | `heading:{level}:{slug}` with `:2`, `:3` suffix for duplicates |
| `p` | `p:{index}` |
| `li` | `li:{listIdx}:{itemIdx}` |
| `pre` | `pre:{index}` |

Heading IDs are content-based and stable for unchanged heading text. Non-heading IDs are deterministic index-based within the current render and may shift if document structure changes.

---

## 5. Module Specifications

### M41b-BID — BlockIdPlugin

**File:** `src/block-id-plugin.ts`

**Purpose:** A `markdown-it` plugin that injects `data-block-id` HTML attributes into rendered block elements, and a resolver that maps between block IDs and source line numbers.

| Requirement ID | Requirement |
|---|---|
| M41b-BID-01 | `blockIdPlugin(md)` — registers as a markdown-it plugin; injected `data-block-id` on headings, `p`, `li`, and `pre` elements |
| M41b-BID-02 | Heading IDs use content-based slug (stable across line shifts) |
| M41b-BID-03 | `BlockIdResolver.buildMappingFromTokens(tokens)` populates a `blockId ↔ sourceLine` bidirectional map |
| M41b-BID-04 | `BlockIdResolver.blockIdToLine(blockId)` returns source line number for a known blockId |
| M41b-BID-05 | `BlockIdResolver.lineToBlockId(line)` returns the closest blockId for a given source line |
| M41b-BID-06 | Empty document produces no errors and an empty mapping |
| M41b-BID-07 | Duplicate heading slugs get `:2`, `:3` suffix automatically |
| M41b-BID-08 | `slugify(text)` produces stable, URL-safe, lowercase strings |

**Exports:**

```typescript
export function blockIdPlugin(md: MarkdownIt): void;
export function slugify(text: string): string;

export class BlockIdResolver {
  buildMappingFromTokens(tokens: Token[]): void;
  blockIdToLine(blockId: string): number | null;
  lineToBlockId(line: number): string | null;
}
```

---

### M41b-RND — MarkdownRenderer

**File:** `src/renderer.ts`

**Purpose:** High-quality markdown rendering with syntax highlighting, math, and diagram support.

| Requirement ID | Requirement |
|---|---|
| M41b-RND-01 | `MarkdownRenderer.create()` (no args) returns a configured renderer instance (async, due to shiki init) |
| M41b-RND-02 | `.render(markdown, uri, webview)` returns `{ html, blockIdResolver }` |
| M41b-RND-03 | Syntax highlighting via `@shikijs/markdown-it` (theme: `github-dark` / `github-light` based on VS Code theme) |
| M41b-RND-04 | Math blocks (`$$...$$` and `$...$`) rendered via KaTeX (server-side) |
| M41b-RND-05 | Mermaid fenced code blocks (`\`\`\`mermaid`) preserved as `<div class="mermaid">` for client-side rendering |
| M41b-RND-06 | GitHub Flavored Markdown: task lists, tables, footnotes, front-matter stripped |
| M41b-RND-07 | `blockIdPlugin` applied — all block elements receive `data-block-id` |
| M41b-RND-08 | Front matter is stripped from visible output |
| M41b-RND-09 | `ImageResolver` integrated — all image `src` values rewritten to webview URIs |
| M41b-RND-10 | Returns a `BlockIdResolver` populated from the token stream for use by `PreviewBridge` |
| M41b-RND-11 | Emoji shortcodes (`:smile:`) rendered as Unicode characters |
| M41b-RND-12 | Container blocks (`::: warning`) rendered with semantic class names |
| M41b-RND-13 | Heading anchors (`markdown-it-anchor`) added for in-page navigation |

**Exports:**

```typescript
export interface RenderOptions {
  /** Absolute file system path of the markdown document being rendered. Used to resolve relative image paths. */
  docFsPath: string;
  /** VS Code webview, used to produce vscode-resource: URIs for local images. Omit in unit tests. */
  webview?: WebviewLike;
  /**
   * The VS Code theme kind — used to choose the shiki highlighting theme.
   * 1 = light, 2 = dark, 3 = high contrast dark, 4 = high contrast light.
   * Note: shiki currently always uses 'github-dark' regardless of themeKind (theme switching not yet implemented).
   */
  themeKind?: 1 | 2 | 3 | 4;
  /**
   * Additional fence renderers keyed by language identifier.
   * Runs before the default shiki fallback.
   * Add WaveDrom, Viz.js, Vega, Plotly, Kroki processors here.
   */
  fenceRenderers?: Map<string, FenceRenderer>;
  /** Factory to create a proper URI from a file path. In VS Code: pass `vscode.Uri.file`. In tests: omit. */
  uriFromFsPath?: (fsPath: string) => UriLike;
}

export interface RenderResult {
  html: string;
  blockIdResolver: BlockIdResolver;
}

/**
 * A fence renderer converts a fenced code block into HTML.
 * Runs server-side (extension host), not in the webview.
 * @param code     Raw source inside the fence
 * @param attrs   Key/value pairs parsed from the fence info string (e.g. {engine="dot"})
 * @returns        HTML string, or null to fall through to shiki syntax highlight
 */
export type FenceRenderer = (
  code: string,
  attrs: Record<string, string>
) => Promise<string | null>;

export interface WebviewLike {
  asWebviewUri(uri: UriLike): UriLike;
}

export interface UriLike {
  toString(): string;
  fsPath: string;
}

export class MarkdownRenderer {
  static create(): Promise<MarkdownRenderer>;
  render(markdown: string, options: RenderOptions): Promise<RenderResult>;
}
```

---

### M41b-IMG — ImageResolver

**File:** `src/image-resolver.ts`

**Purpose:** Rewrite image `src` attributes from markdown-relative paths to VS Code webview URIs.

| Requirement ID | Requirement |
|---|---|
| M41b-IMG-01 | `new ImageResolver({ docFsPath, webview?, fs? })` constructs a resolver |
| M41b-IMG-02 | `.resolve(rawSrc)` — absolute URLs (http/https/data:) are returned unchanged |
| M41b-IMG-03 | Relative paths resolved relative to the directory of `docFsPath` |
| M41b-IMG-04 | Resolved path converted to webview URI via `webview.asWebviewUri()` |
| M41b-IMG-05 | Missing file → original `rawSrc` returned unchanged (no throw) |

**Exports:**

```typescript
export interface FsLike {
  existsSync(path: string): boolean;
}

export interface ImageResolverOptions {
  docFsPath: string;
  webview?: WebviewLike;
  fs?: FsLike;
}

export class ImageResolver {
  constructor(options: ImageResolverOptions);
  resolve(rawSrc: string): string;
}
```

---

### M41b-TPL — WebviewTemplate

**File:** `src/webview-template.ts`

**Purpose:** Build the complete webview HTML page, wiring SDK scripts, CSP nonces, and VS Code theme class.

| Requirement ID | Requirement |
|---|---|
| M41b-TPL-01 | `buildWebviewHtml(opts)` returns a valid HTML string |
| M41b-TPL-02 | CSP `<meta>` includes `nonce-{nonce}` for all inline scripts |
| M41b-TPL-03 | KaTeX CSS injected via `<link>` with correct URI from `opts.katexCssUri` |
| M41b-TPL-04 | Mermaid JS injected via `<script nonce="…" src="…">` using `opts.mermaidJsUri` |
| M41b-TPL-05 | SDK JS injected via `<script nonce="…" src="…">` using `opts.sdkJsUri` |
| M41b-TPL-06 | SDK CSS injected via `<link>` using `opts.sdkCssUri` |
| M41b-TPL-07 | `<body>` receives the VS Code theme class from `themeKindToClass(opts.themeKind)` |
| M41b-TPL-08 | `themeKindToClass(kind)` maps: 1→`vscode-light`, 2→`vscode-dark`, 3→`vscode-high-contrast`, 4→`vscode-high-contrast-light`; unknown → `vscode-dark` |

**Exports:**

```typescript
export interface TemplateOptions {
  nonce: string;
  body: string;
  katexCssUri: string;
  mermaidJsUri: string;
  sdkJsUri: string;
  sdkCssUri: string;
  themeKind: 1 | 2 | 3 | 4;
  cspSource: string;
  /** Additional <script src="..."> tags injected before </body>. Nonce is applied automatically. */
  additionalScripts?: string[];
  /** Additional <link rel="stylesheet"> tags injected in <head>. */
  additionalStylesheets?: string[];
}

export function buildWebviewHtml(opts: TemplateOptions): string;
export function themeKindToClass(kind: 1 | 2 | 3 | 4): string;
```

---

### M41b-PBR — PreviewBridge

**File:** `src/preview-bridge.ts`

**Purpose:** Wire the webview's `postMessage` channel to `accordo-comments`'s thread store. Translates between `WebviewMessage`/`HostMessage` format and store CRUD operations.

| Requirement ID | Requirement |
|---|---|
| M41b-PBR-01 | Constructor subscribes to `store.onChanged` for the current URI |
| M41b-PBR-02 | `loadThreadsForUri()` sends `comments:load` to the webview with threads for `uri` |
| M41b-PBR-03 | `comment:create` message → resolves `blockId -> line` (if available) and calls `store.createThread({ uri, blockId, body, intent?, line? })` |
| M41b-PBR-04 | `comment:reply` message → calls `store.reply({ threadId, body })` |
| M41b-PBR-05 | `comment:resolve` message → calls `store.resolve({ threadId, resolutionNote })` |
| M41b-PBR-06 | `comment:delete` message → calls `store.delete({ threadId, commentId? })` |
| M41b-PBR-07 | Store `onChanged` fires → pushes updated `comments:load` for current URI |
| M41b-PBR-08 | `dispose()` calls `dispose()` on both the store subscription and the webview message listener |
| M41b-PBR-09 | Unknown message type → silently ignored (no throw) |
| M41b-PBR-10 | `toSdkThread(thread, loadedAt, resolver?)` — exported helper that converts a `CommentThread` to `SdkThread` including line/block mapping for text anchors |

**`toSdkThread` hasUnread logic:**

- `hasUnread = thread.lastActivity > loadedAt` (ISO 8601 string comparison)
- `thread.lastActivity === loadedAt` → `hasUnread: false`
- `thread.lastActivity < loadedAt` → `hasUnread: false`

**Exports:**

```typescript
export interface CommentStoreLike {
  createThread(args: { uri: string; blockId: string; body: string; intent?: string; line?: number }): Promise<CommentThread>;
  reply(args: { threadId: string; body: string }): Promise<void>;
  resolve(args: { threadId: string; resolutionNote?: string }): Promise<void>;
  reopen(args: { threadId: string }): Promise<void>;
  delete(args: { threadId: string; commentId?: string }): Promise<void>;
  getThreadsForUri(uri: string): CommentThread[];
  onChanged(listener: (uri: string) => void): { dispose(): void };
}

export interface WebviewLike {
  postMessage(message: HostMessage): void;
  onDidReceiveMessage: (listener: (msg: WebviewMessage) => void) => { dispose(): void };
}

export interface ResolverLike {
  blockIdToLine(blockId: string): number | null;
  lineToBlockId(line: number): string | null;
}

export function toSdkThread(thread: CommentThread, loadedAt: string, resolver?: ResolverLike): SdkThread;
export class PreviewBridge {
  constructor(store: CommentStoreLike, webview: WebviewLike, uri: string, resolver?: ResolverLike);
  loadThreadsForUri(): void;
  handleMessage(msg: WebviewMessage): Promise<void>;
  dispose(): void;
}
```

---

### M41b-CPE — CommentablePreview

**File:** `src/commentable-preview.ts`

**Purpose:** The `CustomTextEditorProvider` that vs Code calls when a `.md` file is opened with the "Accordo Markdown Preview" editor. Wires all sub-modules together.

| Requirement ID | Requirement |
|---|---|
| M41b-CPE-01 | `PREVIEW_VIEW_TYPE = "accordo.markdownPreview"` constant exported |
| M41b-CPE-02 | `generateNonce()` returns a 32-character alphanumeric random string |
| M41b-CPE-03 | `mapThemeKind(kind)` maps `vscode.ColorThemeKind` enum to `1 \| 2 \| 3 \| 4`; unknown → `2` (dark) |
| M41b-CPE-04 | `CommentablePreview` class implements `vscode.CustomTextEditorProvider` |
| M41b-CPE-05 | `resolveCustomTextEditor()` creates webview HTML and creates `PreviewBridge` when a comments store is available |
| M41b-CPE-06 | Webview HTML rebuilt on `vscode.workspace.onDidChangeTextDocument` for the current file |
| M41b-CPE-07 | Webview is disposed when the panel is closed; all subscriptions cleaned up |
| M41b-CPE-08 | Webview options: `enableScripts: true`, `localResourceRoots` restricted to extension + workspace |

**Exports:**

```typescript
export const PREVIEW_VIEW_TYPE = "accordo.markdownPreview";
export function generateNonce(): string;
export function mapThemeKind(kind: vscode.ColorThemeKind): 1 | 2 | 3 | 4;
export class CommentablePreview implements vscode.CustomTextEditorProvider { … }
```

---

### M41b-EXT — extension.ts (entry point)

**File:** `src/extension.ts`

**Purpose:** Register `CommentablePreview` as a `CustomTextEditorProvider` and register the three preview commands.

| Requirement ID | Requirement |
|---|---|
| M41b-EXT-01 | Calls `vscode.window.registerCustomEditorProvider(PREVIEW_VIEW_TYPE, new CommentablePreview(...))` |
| M41b-EXT-02 | Retrieves a store adapter via `accordo_comments_internal_getStore` command (via `CAPABILITY_COMMANDS.COMMENTS_GET_STORE`) |
| M41b-EXT-03 | Registers `accordo.preview.open`, `accordo.preview.toggle`, `accordo.preview.openSideBySide` commands |
| M41b-EXT-04 | All disposables pushed to `context.subscriptions` |
| M41b-EXT-05 | If `accordo-comments` is unavailable, extension logs a warning and is inert |

---

## 6. Configuration

| Setting | Type | Default | Description |
|---|---|---|---|
| `accordo.preview.defaultSurface` | `"viewer" \| "text"` | `"viewer"` | Activation-time behavior toggle used during custom-editor registration. |

---

## 7. Keybindings

| Key | Command | `when` condition |
|---|---|---|
| `shift+cmd+v` | `accordo.preview.toggle` | `editorLangId == markdown` |

---

## 8. Test Coverage Summary

| Module | Test file | Req IDs covered |
|---|---|---|
| BlockIdPlugin | `src/__tests__/block-id-plugin.test.ts` | M41b-BID-01 → BID-08 |
| MarkdownRenderer | `src/__tests__/renderer.test.ts` | M41b-RND-01 → RND-13 |
| ImageResolver | `src/__tests__/image-resolver.test.ts` | M41b-IMG-01 → IMG-05 |
| WebviewTemplate | `src/__tests__/webview-template.test.ts` | M41b-TPL-01 → TPL-08 |
| PreviewBridge | `src/__tests__/preview-bridge.test.ts` | M41b-PBR-01 → PBR-10 |
| CommentablePreview | `src/__tests__/commentable-preview.test.ts` | M41b-CPE-01 → CPE-08 |

Total Phase B: 76 tests across 7 test files. `extension.ts` (M41b-EXT) has its own integration test file `src/__tests__/extension.test.ts`.

---

## 9. Package Dependencies

### devDependencies (build + test time only — VS Code extension model)

| Package | Purpose |
|---|---|
| `@accordo/bridge-types` | `CommentThread`, anchor types |
| `@accordo/comment-sdk` | `SdkThread`, `WebviewMessage`, `HostMessage` types |
| `markdown-it` | Core markdown parser |
| `@shikijs/markdown-it` | Syntax highlighting integration |
| `shiki` | Shiki highlighter engine |
| `markdown-it-anchor` | Heading anchors |
| `markdown-it-container` | `::: warning` style containers |
| `markdown-it-emoji` | Emoji shortcodes |
| `markdown-it-footnote` | Footnote support |
| `markdown-it-front-matter` | YAML front matter stripping |
| `@hackmd/markdown-it-task-lists` | Github-style `- [x]` task lists |
| `@types/markdown-it` | Type declarations |
| `@types/markdown-it-container` | Type declarations |
| `@types/markdown-it-emoji` | Type declarations |
| `@types/markdown-it-footnote` | Type declarations |
| `@types/vscode` | VS Code API types |
| `@types/node` | Node.js built-in types |
| `typescript` | Compiler |
| `vitest` | Test runner |

### Runtime (bundled into dist/)

None — VS Code extensions bundle their dependencies at build time.

---

## 10. Extensibility Model

The renderer is designed to grow toward feature parity with Markdown Preview Enhanced without architectural change.

### 10.1 Adding a new client-side diagram renderer

Pattern for adding WaveDrom, Viz.js, Vega, Vega-lite, Plotly, etc.:

1. **Fence processor** — register a `FenceRenderer` for the language identifier (e.g. `wavedrom`, `dot`, `vega`) in `RenderOptions.fenceRenderers`. For client-side libraries the processor emits a wrapper `<div class="diagrams-{lang}">` preserving raw source; the library renders it in the webview.
2. **Script injection** — add the CDN/local URI to `TemplateOptions.additionalScripts`.
3. No changes to `TemplateOptions` named fields, `PreviewBridge`, `BlockIdPlugin`, or `CommentablePreview`.

### 10.2 Adding a server-side diagram renderer (Kroki, PlantUML)

[Kroki](https://kroki.io) supports 25+ diagram types (blockdiag, seqdiag, actdiag, nwdiag, excalidraw, nomnoml, pikchr, mermaid, PlantUML, etc.) via a single HTTP API. Pattern:

1. Register a `FenceRenderer` that POSTs to `https://kroki.io/{type}/svg` (or a self-hosted instance) and returns the SVG inline.
2. No webview changes required — SVG is inlined in the rendered HTML.
3. PlantUML is available via Kroki — no local Java dependency needed.

### 10.3 KaTeX vs MathJax

KaTeX (Phase C default) is faster; MathJax supports a broader LaTeX feature set. To switch:
- Replace `@traptitech/markdown-it-katex` with `markdown-it-texmath` configured for MathJax.
- Update `TemplateOptions.katexCssUri` → `mathJaxJsUri`.
- No change to any other module.

### 10.4 MPE Code Chunk features — permanently out of scope

Features that require local tool execution (matplotlib, gnuplot, LaTeX/TikZ/Chemfig, arbitrary `{cmd=...}`) are the MPE "Code Chunk" modality. These require `enableScriptExecution = true` in user settings and introduce significant security concerns. The viewer never executes user-supplied code.

---

## 11. Non-Requirements (explicitly out of scope)

- **No MCP tool registration** — `accordo-md-viewer` does not register MCP tools. Agent access to thread data goes through `accordo-comments`.
- **No PDF or diagram rendering** — this package handles `.md` files only.
- **No live collaborative editing** — the preview is read-only; source edits happen in the text editor.
- **No client-side KaTeX** — math is rendered server-side via `@traptitech/markdown-it-katex` (Phase C decision: simpler, no CDN dependency in webview).
