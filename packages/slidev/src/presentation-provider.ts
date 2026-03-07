/**
 * accordo-slidev — Presentation Provider
 *
 * Manages the VS Code WebviewPanel and Slidev child process for a single
 * presentation session. One session at a time (M44-EXT-07).
 *
 * Source: requirements-slidev.md §4 M44-PVD
 *
 * Requirements:
 *   M44-PVD-01  Opens deck in a VS Code WebviewPanel (not CustomTextEditorProvider)
 *   M44-PVD-02  Spawns Slidev dev server as child process (npx slidev <deck> --port <N> --remote false)
 *   M44-PVD-03  WebviewPanel HTML contains <iframe> pointing at Slidev server URL
 *   M44-PVD-04  Injects Comment SDK overlay alongside the iframe when comments enabled
 *   M44-PVD-05  dispose() kills Slidev process and resets session state
 *   M44-PVD-06  On dispose, state resets to { isOpen: false, deckUri: null, ... }
 *   M44-PVD-07  Supports reopen/focus of existing session for same deck URI (no restart)
 *   M44-PVD-08  Port selection: scans range 7788–7888 for first free port
 */

import * as vscode from "vscode";
import { dirname, resolve as resolvePath } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type {
  ProcessSpawner,
  ChildProcessHandle,
  PresentationSessionState,
} from "./types.js";
import type { PresentationRuntimeAdapter } from "./runtime-adapter.js";
import type { PresentationCommentsBridge } from "./presentation-comments-bridge.js";

/** Default port scan range (M44-PVD-08). */
export const PORT_RANGE_START = 7788;
export const PORT_RANGE_END = 7888;

// ── Official Slidev theme short-name → npm package name ──────────────────────
const OFFICIAL_THEMES: Record<string, string> = {
  default: "@slidev/theme-default",
  seriph: "@slidev/theme-seriph",
  "apple-basic": "@slidev/theme-apple-basic",
  shibainu: "@slidev/theme-shibainu",
  bricks: "@slidev/theme-bricks",
};

/**
 * Read the deck file, extract the `theme:` value from the YAML front-matter,
 * resolve it to an npm package name, and install it in `deckDir` if it is not
 * already present — all before Slidev is spawned.
 *
 * Slidev's own resolver calls `process.exit(1)` when stdin is not a TTY and
 * the theme is missing. Pre-installing avoids that completely.
 *
 * Silently no-ops if:
 *  - the deck can't be read
 *  - theme is "none", "default" already installed, a local path, or unknown
 *  - the package is already installed under deckDir/node_modules
 */
export async function ensureThemeInstalled(deckUri: string, deckDir: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(deckUri, "utf-8");
  } catch {
    return; // can't read deck — let Slidev handle the error
  }

  // Extract theme from YAML front-matter (first ---...--- block)
  const fmMatch = raw.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---/);
  if (!fmMatch) return;
  const themeMatch = fmMatch[1].match(/^theme\s*:\s*(.+)$/m);
  if (!themeMatch) return;

  const themeRaw = themeMatch[1].trim().replace(/['"`]/g, "");
  if (!themeRaw || themeRaw === "none" || themeRaw === "default") return;
  // local path reference — not an npm package
  if (themeRaw.startsWith(".") || themeRaw.startsWith("/")) return;

  // Resolve short-name or fully-qualified package name
  let pkgName = OFFICIAL_THEMES[themeRaw]
    ?? (themeRaw.startsWith("@") ? themeRaw : `slidev-theme-${themeRaw}`);

  // Check if already installed (node_modules in deck dir or workspace root)
  // Scoped packages like @slidev/theme-seriph live at node_modules/@slidev/theme-seriph
  // which path.resolve handles correctly with the / separator.
  const localModules = resolvePath(deckDir, "node_modules", ...pkgName.split("/"));
  if (existsSync(localModules)) return;

  // Install via npm into the deck's directory
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolveP) => {
    const proc = spawn("npm", ["install", pkgName], {
      cwd: deckDir,
      stdio: "ignore",
    });
    proc.on("exit", () => resolveP()); // resolve regardless of exit code
    proc.on("error", () => resolveP()); // no npm — let Slidev handle it
  });
}

// ── Port utilities ────────────────────────────────────────────────────────────

/**
 * M44-PVD-08
 * Returns the first free TCP port in [start, end].
 * Throws if no port is available in the range.
 */
export async function findFreePort(start: number, end: number): Promise<number> {
  if (end < start) throw new Error(`Invalid port range: ${start}–${end}`);
  const { createServer } = await import("node:net");
  for (let port = start; port <= end; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const srv = createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => { srv.close(); resolve(true); });
      srv.listen(port, "127.0.0.1");
    });
    if (available) return port;
  }
  throw new Error(`No free port found in range ${start}–${end}`);
}

// ── PresentationProvider ──────────────────────────────────────────────────────

export interface PresentationProviderOptions {
  context: vscode.ExtensionContext;
  spawner: ProcessSpawner;
  portOverride?: number | null;
}

/**
 * M44-PVD — Manages the WebviewPanel and Slidev child process lifecycle.
 *
 * Only one session is active at a time. Call open() to start; dispose() to end.
 */
export class PresentationProvider {
  private panel: vscode.WebviewPanel | null = null;
  private process: ChildProcessHandle | null = null;
  private currentDeckUri: string | null = null;
  /** URI of a deck whose open() is in progress but not yet complete. */
  private pendingDeckUri: string | null = null;
  private currentPort: number | null = null;
  private onDisposeCallback: (() => void) | null = null;
  private readonly outputChannel: vscode.OutputChannel;

  constructor(private readonly options: PresentationProviderOptions) {
    this.outputChannel = vscode.window.createOutputChannel("Accordo — Slidev");
  }

  /**
   * M44-PVD-01 / M44-PVD-02 / M44-PVD-03
   * Opens the deck in a new or existing WebviewPanel.
   * If the same deck is already open, reveals the existing panel (M44-PVD-07).
   * If a different deck is open, closes the current session first.
   *
   * @param deckUri         Absolute file-system path to the deck.
   * @param adapter         Runtime adapter (already validated).
   * @param commentsBridge  Optional comments bridge (null = disabled).
   */
  async open(
    deckUri: string,
    adapter: PresentationRuntimeAdapter,
    commentsBridge: PresentationCommentsBridge | null,
  ): Promise<void> {
    // M44-PVD-07: same deck → reveal existing panel
    if (this.panel && this.currentDeckUri === deckUri) {
      this.panel.reveal?.();
      return;
    }

    // Reject if the same deck is already being opened (re-entrance guard).
    // This prevents the CustomTextEditorProvider from re-triggering for the
    // previous deck while we are in the middle of closing it.
    if (this.pendingDeckUri === deckUri) {
      this.panel?.reveal?.();
      return;
    }

    // M44-EXT-07: different deck open → close previous session first
    if (this.panel) {
      this.close();
    }

    this.pendingDeckUri = deckUri;
    try {
      // M44-PVD-08: port selection
      const port = this.options.portOverride ?? await findFreePort(PORT_RANGE_START, PORT_RANGE_END);
    this.currentPort = port;

    // M44-PVD-02: spawn Slidev dev server
    // cwd = directory containing the deck so Slidev resolves relative assets
    const deckDir = dirname(deckUri) || undefined;

    // Pre-install missing theme before Slidev starts.
    // Slidev calls process.exit(1) when stdin is not a TTY and the theme
    // package (e.g. @slidev/theme-seriph) isn't installed — it cannot prompt.
    // ensureThemeInstalled() reads the deck front-matter and runs
    // `npm install <pkg>` in the deck directory if the package is absent.
    if (deckDir) {
      await ensureThemeInstalled(deckUri, deckDir);
    }

    const handle = this.options.spawner(
      "npx",
      ["slidev", deckUri, "--port", String(port), "--remote", "false"],
      { cwd: deckDir },
    );
    this.process = handle;

    // M44-PVD-01: create WebviewPanel
    const title = deckUri.split("/").pop() ?? "Presentation";
    const panel = vscode.window.createWebviewPanel(
      "accordo.presentation",
      title,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel = panel;
    this.currentDeckUri = deckUri;
    this.pendingDeckUri = null; // open complete

    // M44-PVD-03: build HTML with iframe
    const serverUri = await vscode.env.asExternalUri(
      vscode.Uri.parse(`http://localhost:${port}`),
    );
    const serverUrl = String(serverUri);
    panel.webview.html = buildWebviewHtml(commentsBridge !== null);

    // Collect stderr and forward to output channel for diagnostics.
    let stderrOutput = "";
    handle.onStderr?.((chunk) => {
      stderrOutput += chunk;
      // Strip ANSI colour codes for the output channel
      const plain = chunk.replace(/\x1B\[[0-9;]*m/g, "");
      this.outputChannel.append(plain);
    });

    // Detect premature process exit (e.g. missing theme, bad config).
    let processExited = false;
    handle.onExit((code) => {
      processExited = true;
      if (code !== null && code !== 0 && this.panel === panel) {
        clearInterval(pollTimer);
        // Strip ANSI codes, then find the first meaningful error line
        // (not a stack-trace frame starting with "at ").
        const plainStderr = stderrOutput.replace(/\x1B\[[0-9;]*m/g, "");
        const lines = plainStderr.trim().split("\n").map(l => l.trim()).filter(Boolean);
        const hint =
          lines.find(l => !l.startsWith("at ") && !l.startsWith(">") && l.length > 0)
          || `Slidev exited with code ${code}`;
        this.outputChannel.appendLine(`\n[Accordo] Slidev exited with code ${code}. Showing in webview: ${hint}`);
        this.outputChannel.show(false); // reveal without stealing focus
        panel.webview.postMessage({ type: "slidev-error", message: hint });
      }
    });

    // Poll Slidev readiness from the Node.js side (no CSP restrictions).
    // When the port responds, postMessage to the webview to reveal the iframe.
    let attempts = 0;
    const MAX_ATTEMPTS = 60;
    const pollTimer = setInterval(() => {
      attempts++;
      if (processExited) {
        clearInterval(pollTimer);
        return;
      }
      if (attempts > MAX_ATTEMPTS || !this.panel) {
        clearInterval(pollTimer);
        if (this.panel === panel) {
          panel.webview.postMessage({ type: "slidev-timeout" });
        }
        return;
      }
      import("node:net").then(({ createConnection }) => {
        const sock = createConnection(port, "127.0.0.1");
        sock.setTimeout(800);
        sock.on("connect", () => {
          sock.destroy();
          clearInterval(pollTimer);
          if (this.panel === panel) {
            panel.webview.postMessage({ type: "slidev-ready", url: serverUrl });
          }
        });
        sock.on("error", () => sock.destroy());
        sock.on("timeout", () => sock.destroy());
      }).catch(() => { /* ignore import errors */ });
    }, 1000);

    // Clean up poll timer when panel is disposed
    panel.onDidDispose(() => { clearInterval(pollTimer); });

    // Panel close → clean up session
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = null;
        this._cleanupProcess();
        this.currentDeckUri = null;
        this.currentPort = null;
        this.onDisposeCallback?.();
      }
    });

    // M44-PVD-04: wire comments bridge messages
    if (commentsBridge) {
      commentsBridge.loadThreadsForUri(deckUri);
      panel.webview.onDidReceiveMessage((msg: unknown) => {
        void commentsBridge.handleWebviewMessage(msg, deckUri);
      });
    }
    } catch (err) {
      // If open() throws after pendingDeckUri was set, clear it so
      // subsequent attempts are not silently swallowed.
      this.pendingDeckUri = null;
      throw err;
    }
  }

  /**
   * M44-PVD-05 / M44-PVD-06
   * Kills the Slidev process and disposes the WebviewPanel.
   */
  close(): void {
    const panel = this.panel;
    this.panel = null;
    this.currentDeckUri = null;
    this.pendingDeckUri = null;
    this.currentPort = null;

    this._cleanupProcess();

    panel?.dispose();

    this.onDisposeCallback?.();
  }

  private _cleanupProcess(): void {
    if (this.process && !this.process.exited) {
      this.process.kill();
    }
    this.process = null;
  }

  /** Returns the active WebviewPanel, or null if no session is open. */
  getPanel(): vscode.WebviewPanel | null {
    return this.panel;
  }

  /** Returns the URI of the currently open deck, or null. */
  getCurrentDeckUri(): string | null {
    return this.currentDeckUri;
  }

  /** Returns the URI of a deck that is currently being opened (async in-flight), or null. */
  getPendingDeckUri(): string | null {
    return this.pendingDeckUri;
  }

  /** Returns the port the Slidev server is running on, or null. */
  getCurrentPort(): number | null {
    return this.currentPort;
  }

  /**
   * Register a callback to be invoked when the session is disposed.
   * Used by PresentationStateContribution to reset state on close.
   */
  onDispose(callback: () => void): void {
    this.onDisposeCallback = callback;
  }

  /** Alias for close() — implements VS Code disposable pattern. */
  dispose(): void {
    this.close();
    this.outputChannel.dispose();
  }
}

// ── Comment overlay CSS ──────────────────────────────────────────────────────
// Adapted from @accordo/comment-sdk styles for the cross-origin iframe overlay.
// Slidev content lives in an iframe so the SDK can't attach to DOM elements.
// Instead we render a transparent overlay on top with a toggle button.

const COMMENT_OVERLAY_CSS = `
/* Toggle button — always visible in top-right corner */
#comment-toggle {
  position: fixed; top: 12px; right: 12px; z-index: 1001;
  width: 32px; height: 32px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.25); background: rgba(55,148,255,0.75);
  color: #fff; font-size: 16px; cursor: pointer; pointer-events: all;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.35); transition: background 0.2s, transform 0.15s;
  opacity: 0.6;
}
#comment-toggle:hover { transform: scale(1.1); opacity: 1; }
#comment-toggle.active {
  background: rgba(204,167,0,0.9); border-color: rgba(255,255,255,0.5); opacity: 1;
}
/* Mode indicator bar at top */
#comment-mode-bar {
  position: fixed; top: 0; left: 0; right: 0; height: 3px;
  background: #cca700; z-index: 1002; display: none;
}
#comment-mode-bar.active { display: block; }
#comment-mode-hint {
  position: fixed; top: 8px; left: 50%; transform: translateX(-50%);
  z-index: 1003; background: rgba(40,40,55,0.92); color: #cdd6f4;
  font-family: system-ui; font-size: 12px; padding: 4px 12px;
  border-radius: 6px; pointer-events: none; display: none;
}
#comment-mode-hint.active { display: block; }

/* Overlay — sits on top of iframe, transparent by default */
#comment-overlay {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  z-index: 1000; pointer-events: none;
}
#comment-overlay.active { pointer-events: all; cursor: crosshair; }

/* ── Pin styles ──────────────────────────────────────────────────────────── */
.accordo-pin {
  position: absolute; width: 22px; height: 22px; border-radius: 50%;
  cursor: pointer; pointer-events: all;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; font-family: system-ui; color: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.35);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  transform: translate(-50%, -50%);
  border: 2px solid transparent; user-select: none;
}
.accordo-pin:hover { transform: translate(-50%, -50%) scale(1.15); box-shadow: 0 2px 8px rgba(0,0,0,0.45); }
.accordo-pin--open { background: #3794ff; border-color: #007fd4; }
.accordo-pin--updated { background: #cca700; border-color: #b8940d; }
.accordo-pin--resolved { background: #4caf50; border-color: #388e3c; opacity: 0.7; }
.accordo-pin__badge { font-size: 9px; font-weight: 700; line-height: 1; }

/* ── Inline input (new comment form) ─────────────────────────────────────── */
.accordo-inline-input {
  position: fixed; z-index: 1200; background: #252526;
  border: 1px solid #454545; border-radius: 8px; padding: 8px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.45); width: 300px; pointer-events: all;
}
.accordo-inline-input textarea {
  width: 100%; min-height: 52px; resize: vertical;
  background: #1e1e1e; color: #ccc; border: 1px solid #3c3c3c;
  border-radius: 4px; padding: 5px 8px; font-family: system-ui;
  font-size: 12px; outline: none; box-sizing: border-box;
}
.accordo-inline-input textarea:focus { border-color: #007fd4; }
.accordo-inline-input__actions { display: flex; gap: 6px; margin-top: 6px; justify-content: flex-end; }

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.accordo-btn {
  padding: 4px 10px; border-radius: 4px; font-size: 12px;
  font-family: system-ui; font-weight: 500; cursor: pointer;
  border: 1px solid transparent;
}
.accordo-btn:hover { opacity: 0.85; }
.accordo-btn--primary { background: #0e639c; color: #fff; border-color: #0e639c; }
.accordo-btn--secondary { background: #3a3d41; color: #ccc; border-color: #3a3d41; }
.accordo-btn--danger { background: transparent; color: #f14c4c; border-color: currentColor; }

/* ── Popover ─────────────────────────────────────────────────────────────── */
.accordo-popover {
  position: fixed; z-index: 1200; background: #252526;
  border: 1px solid #454545; border-radius: 8px; padding: 0;
  box-shadow: 0 6px 24px rgba(0,0,0,0.45); width: 320px;
  max-height: 480px; overflow: hidden;
  display: flex; flex-direction: column; pointer-events: all;
}
.accordo-popover__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid #454545;
  font-size: 11px; color: #9d9d9d; font-family: system-ui;
}
.accordo-popover__close {
  background: none; border: none; color: #c5c5c5; cursor: pointer;
  font-size: 16px; line-height: 1; padding: 2px 4px; border-radius: 3px;
}
.accordo-popover__close:hover { background: rgba(90,93,94,0.31); }
.accordo-thread-list { overflow-y: auto; flex: 1; padding: 8px 0; max-height: 300px; }
.accordo-comment-item { padding: 6px 12px; border-bottom: 1px solid #454545; }
.accordo-comment-item:last-child { border-bottom: none; }
.accordo-comment__author-line { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.accordo-comment__avatar {
  width: 18px; height: 18px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #fff;
}
.accordo-comment__avatar--user { background: #3794ff; }
.accordo-comment__avatar--agent { background: #9b59b6; }
.accordo-comment__author { font-size: 12px; font-weight: 600; color: #ccc; font-family: system-ui; }
.accordo-comment__body {
  font-size: 13px; color: #ccc; font-family: system-ui;
  line-height: 1.5; white-space: pre-wrap; word-break: break-word;
}
.accordo-popover__reply {
  padding: 8px 12px; border-top: 1px solid #454545;
  display: flex; flex-direction: column; gap: 6px;
}
.accordo-popover__reply textarea {
  width: 100%; min-height: 52px; resize: none;
  background: #1e1e1e; color: #ccc; border: 1px solid #3c3c3c;
  border-radius: 4px; padding: 5px 8px; font-family: system-ui;
  font-size: 12px; outline: none; box-sizing: border-box;
}
.accordo-popover__reply textarea:focus { border-color: #007fd4; }
.accordo-popover__actions { display: flex; gap: 6px; justify-content: flex-end; }
.accordo-resolved-banner {
  padding: 6px 12px; background: rgba(76,175,80,0.12);
  border-top: 1px solid rgba(76,175,80,0.25);
  font-size: 12px; color: #4caf50; font-family: system-ui;
}
`;

// ── Comment overlay JS ───────────────────────────────────────────────────────
// Vanilla JS IIFE — runs inside the VS Code webview alongside the Slidev iframe.
// Since the iframe is cross-origin (http://localhost), we can't inject scripts
// into it. Instead the overlay captures clicks when "comment mode" is toggled on.

const COMMENT_OVERLAY_JS = `
(function() {
  var overlay = document.getElementById('comment-overlay');
  var toggle = document.getElementById('comment-toggle');
  var modeBar = document.getElementById('comment-mode-bar');
  var modeHint = document.getElementById('comment-mode-hint');
  if (!overlay || !toggle) return;

  // acquireVsCodeApi was already called in the main script above; reuse the result.
  var vscode = window._vscodeApi || (window._vscodeApi = acquireVsCodeApi());
  var threads = [];
  var currentSlide = 0;
  var commentMode = false;
  var activePopover = null;

  /* ── Comment mode toggle ────────────────────────────────────────────── */

  function setCommentMode(on) {
    commentMode = on;
    overlay.classList.toggle('active', on);
    toggle.classList.toggle('active', on);
    if (modeBar) modeBar.classList.toggle('active', on);
    if (modeHint) modeHint.classList.toggle('active', on);
    toggle.textContent = on ? '\\u2715' : '\\uD83D\\uDCAC';
    toggle.title = on ? 'Exit comment mode (Esc)' : 'Enter comment mode';
    if (!on) {
      var existing = document.querySelector('.accordo-inline-input');
      if (existing) existing.remove();
    }
  }

  toggle.addEventListener('click', function(e) {
    e.stopPropagation();
    setCommentMode(!commentMode);
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && commentMode) setCommentMode(false);
  });

  /* ── Click on overlay → create comment ──────────────────────────────── */

  overlay.addEventListener('click', function(e) {
    if (!commentMode) return;
    if (e.target !== overlay) return;
    e.preventDefault();
    e.stopPropagation();
    var rect = overlay.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width;
    var y = (e.clientY - rect.top) / rect.height;
    showInlineInput(x, y, e.clientX, e.clientY);
  });

  /* ── Outside click → close popover ──────────────────────────────────── */

  document.addEventListener('click', function(e) {
    if (activePopover && !activePopover.contains(e.target) &&
        !(e.target && e.target.closest && e.target.closest('.accordo-pin'))) {
      closePopover();
    }
  });

  /* ── Inline input form ──────────────────────────────────────────────── */

  function showInlineInput(normX, normY, screenX, screenY) {
    var existing = document.querySelector('.accordo-inline-input');
    if (existing) existing.remove();
    closePopover();

    var form = document.createElement('div');
    form.className = 'accordo-inline-input';

    var textarea = document.createElement('textarea');
    textarea.placeholder = 'Add comment\\u2026 (Cmd+Enter to submit)';
    form.appendChild(textarea);

    var actions = document.createElement('div');
    actions.className = 'accordo-inline-input__actions';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'accordo-btn accordo-btn--secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function(ev) { ev.stopPropagation(); form.remove(); });
    actions.appendChild(cancelBtn);

    var submitBtn = document.createElement('button');
    submitBtn.className = 'accordo-btn accordo-btn--primary';
    submitBtn.textContent = 'Add Comment';
    submitBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      var body = textarea.value.trim();
      if (body) {
        var blockId = 'slide:' + currentSlide + ':' + normX.toFixed(4) + ':' + normY.toFixed(4);
        vscode.postMessage({ type: 'comment:create', blockId: blockId, body: body });
      }
      form.remove();
      setCommentMode(false);
    });
    actions.appendChild(submitBtn);

    textarea.addEventListener('keydown', function(ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); submitBtn.click(); }
      if (ev.key === 'Escape') { form.remove(); }
    });

    form.appendChild(actions);
    document.body.appendChild(form);
    textarea.focus();

    /* Clamp to viewport */
    var vpW = window.innerWidth, vpH = window.innerHeight;
    var left = screenX, top = screenY + 8;
    if (left + 300 > vpW - 8) left = Math.max(8, vpW - 308);
    if (top + 130 > vpH - 8) top = Math.max(8, screenY - 138);
    form.style.left = left + 'px';
    form.style.top = top + 'px';
  }

  /* ── Message handling ───────────────────────────────────────────────── */

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg) return;
    if (msg.type === 'comments:load') { threads = msg.threads || []; renderPins(); }
    else if (msg.type === 'comments:add') { threads.push(msg.thread); renderPins(); }
    else if (msg.type === 'comments:update') {
      for (var i = 0; i < threads.length; i++) {
        if (threads[i].id === msg.threadId) { Object.assign(threads[i], msg.update); break; }
      }
      renderPins();
    }
    else if (msg.type === 'comments:remove') {
      threads = threads.filter(function(t) { return t.id !== msg.threadId; });
      renderPins();
    }
    else if (msg.type === 'slide-index') { currentSlide = msg.index; renderPins(); }
    else if (msg.type === 'comments:focus') {
      var focusThread = null;
      for (var fi = 0; fi < threads.length; fi++) {
        if (threads[fi].id === msg.threadId) { focusThread = threads[fi]; break; }
      }
      if (focusThread) {
        var coords = getCoords(focusThread);
        if (coords) { currentSlide = coords.slideIndex; renderPins(); }
        var pin = overlay.querySelector('[data-thread-id="' + msg.threadId + '"]');
        openPopover(focusThread, pin || overlay);
      }
    }
  });

  /* ── Extract slide coordinates from CommentThread anchor ────────────── */

  function getCoords(thread) {
    if (thread.anchor && thread.anchor.kind === 'surface' && thread.anchor.coordinates) {
      var c = thread.anchor.coordinates;
      if (c.type === 'slide') return { slideIndex: c.slideIndex, x: c.x, y: c.y };
    }
    return null;
  }

  /* ── Render pins ────────────────────────────────────────────────────── */

  function renderPins() {
    overlay.querySelectorAll('.accordo-pin').forEach(function(p) { p.remove(); });
    threads.forEach(function(thread) {
      var coords = getCoords(thread);
      if (!coords) return;
      if (coords.slideIndex !== currentSlide) return;

      var pin = document.createElement('div');
      pin.className = 'accordo-pin';
      pin.classList.add(thread.status === 'resolved' ? 'accordo-pin--resolved' : 'accordo-pin--open');
      pin.style.left = (coords.x * 100) + '%';
      pin.style.top = (coords.y * 100) + '%';
      pin.dataset.threadId = thread.id;

      var badge = document.createElement('span');
      badge.className = 'accordo-pin__badge';
      badge.textContent = String(thread.comments ? thread.comments.length : 0);
      pin.appendChild(badge);

      pin.addEventListener('click', function(e) { e.stopPropagation(); openPopover(thread, pin); });
      overlay.appendChild(pin);
    });
  }

  /* ── Popover ────────────────────────────────────────────────────────── */

  function openPopover(thread, pinEl) {
    closePopover();

    var popover = document.createElement('div');
    popover.className = 'accordo-popover';
    popover.setAttribute('data-thread-id', thread.id);

    /* Header */
    var header = document.createElement('div');
    header.className = 'accordo-popover__header';
    var statusLabel = document.createElement('span');
    statusLabel.textContent = thread.status === 'resolved' ? '\\u2713 Resolved' : 'Comment';
    header.appendChild(statusLabel);
    var closeBtn = document.createElement('button');
    closeBtn.className = 'accordo-popover__close';
    closeBtn.textContent = '\\u00d7';
    closeBtn.addEventListener('click', function(e) { e.stopPropagation(); closePopover(); });
    header.appendChild(closeBtn);
    popover.appendChild(header);

    /* Comments list */
    var list = document.createElement('div');
    list.className = 'accordo-thread-list';
    (thread.comments || []).forEach(function(c) {
      var item = document.createElement('div');
      item.className = 'accordo-comment-item';
      var al = document.createElement('div');
      al.className = 'accordo-comment__author-line';
      var av = document.createElement('div');
      var isAgent = c.author && c.author.kind === 'agent';
      av.className = 'accordo-comment__avatar ' + (isAgent ? 'accordo-comment__avatar--agent' : 'accordo-comment__avatar--user');
      av.textContent = c.author ? c.author.name.charAt(0).toUpperCase() : '?';
      al.appendChild(av);
      var an = document.createElement('span');
      an.className = 'accordo-comment__author';
      an.textContent = c.author ? c.author.name : 'Unknown';
      al.appendChild(an);
      item.appendChild(al);
      var bd = document.createElement('p');
      bd.className = 'accordo-comment__body';
      bd.textContent = c.body;
      item.appendChild(bd);
      list.appendChild(item);
    });
    popover.appendChild(list);

    /* Reply / actions */
    if (thread.status === 'open') {
      var replyDiv = document.createElement('div');
      replyDiv.className = 'accordo-popover__reply';
      var rta = document.createElement('textarea');
      rta.placeholder = 'Reply\\u2026 (Cmd+Enter)';
      replyDiv.appendChild(rta);
      var acts = document.createElement('div');
      acts.className = 'accordo-popover__actions';

      var rslv = document.createElement('button');
      rslv.className = 'accordo-btn accordo-btn--secondary'; rslv.textContent = 'Resolve';
      rslv.addEventListener('click', function(e) { e.stopPropagation(); vscode.postMessage({type:'comment:resolve',threadId:thread.id}); closePopover(); });
      acts.appendChild(rslv);
      var del1 = document.createElement('button');
      del1.className = 'accordo-btn accordo-btn--danger'; del1.textContent = 'Delete';
      del1.addEventListener('click', function(e) { e.stopPropagation(); vscode.postMessage({type:'comment:delete',threadId:thread.id}); closePopover(); });
      acts.appendChild(del1);
      var rply = document.createElement('button');
      rply.className = 'accordo-btn accordo-btn--primary'; rply.textContent = 'Reply';
      rply.addEventListener('click', function(e) {
        e.stopPropagation();
        var body = rta.value.trim();
        if (body) { vscode.postMessage({type:'comment:reply',threadId:thread.id,body:body}); closePopover(); }
      });
      acts.appendChild(rply);
      rta.addEventListener('keydown', function(e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); rply.click(); }
      });
      replyDiv.appendChild(acts);
      popover.appendChild(replyDiv);
    } else {
      var banner = document.createElement('div');
      banner.className = 'accordo-resolved-banner';
      banner.textContent = 'This thread is resolved';
      popover.appendChild(banner);
      var ra = document.createElement('div');
      ra.className = 'accordo-popover__actions'; ra.style.padding = '8px 12px';
      var del2 = document.createElement('button');
      del2.className = 'accordo-btn accordo-btn--danger'; del2.textContent = 'Delete';
      del2.addEventListener('click', function(e) { e.stopPropagation(); vscode.postMessage({type:'comment:delete',threadId:thread.id}); closePopover(); });
      ra.appendChild(del2);
      popover.appendChild(ra);
    }

    popover.addEventListener('click', function(e) { e.stopPropagation(); });

    /* Position near pin */
    var pinRect = pinEl.getBoundingClientRect();
    document.body.appendChild(popover);
    activePopover = popover;

    var vpW = window.innerWidth, vpH = window.innerHeight;
    var pw = 320, ph = popover.offsetHeight || 240;
    var left = pinRect.right + 8, top = pinRect.top;
    if (left + pw > vpW - 8) left = Math.max(8, pinRect.left - pw - 8);
    if (top + ph > vpH - 8) top = Math.max(8, vpH - ph - 8);
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
  }

  function closePopover() {
    if (activePopover) { activePopover.remove(); activePopover = null; }
  }
})();
`;

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildWebviewHtml(commentsEnabled: boolean): string {
  const commentsCss = commentsEnabled ? COMMENT_OVERLAY_CSS : "";
  const commentsHtml = commentsEnabled
    ? `<div id="comment-overlay"></div>
  <div id="comment-mode-bar"></div>
  <div id="comment-mode-hint">Comment mode — click to add, Esc to exit</div>
  <button id="comment-toggle" title="Enter comment mode">&#x1F4AC;</button>`
    : "";
  const commentsScript = commentsEnabled
    ? `<script>${COMMENT_OVERLAY_JS}</script>`
    : "";

  // The webview loads before Slidev has finished starting.
  // Show a loading screen then reveal the iframe when Slidev is ready.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; frame-src http://localhost:* https:; connect-src http://localhost:* https:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100vh; overflow: hidden; }
    #loading {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      height: 100vh; background: #1e1e2e; color: #cdd6f4; font-family: sans-serif; gap: 14px;
    }
    #loading h2 { font-size: 17px; font-weight: 400; }
    #loading p  { font-size: 12px; opacity: 0.55; }
    #frame { display: none; width: 100%; height: 100%; border: none;
             position: fixed; top: 0; left: 0; transition: opacity 0.15s ease; }
    /* Webview-level navigation bar (all z-indices above Slidev iframe) */
    #wv-nav { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
      z-index: 950; display: none; align-items: center; gap: 10px;
      background: rgba(0,0,0,0.6); border-radius: 20px; padding: 6px 16px;
      pointer-events: all; user-select: none; }
    #wv-nav button { background: none; border: none; color: rgba(255,255,255,0.7);
      font-size: 18px; cursor: pointer; padding: 2px 6px; line-height: 1;
      border-radius: 4px; transition: color 0.15s, background 0.15s; }
    #wv-nav button:hover { color: #fff; background: rgba(255,255,255,0.12); }
    #wv-page { color: rgba(255,255,255,0.7); font-family: system-ui;
      font-size: 12px; min-width: 22px; text-align: center; }
    ${commentsCss}
  </style>
</head>
<body>
  <div id="loading">
    <h2>Starting Slidev&#8230;</h2>
    <p>Waiting for presentation server</p>
  </div>
  <iframe id="frame" src="about:blank"></iframe>
  <div id="wv-nav">
    <button id="wv-prev" title="Prev slide">&#9664;</button>
    <span id="wv-page">1</span>
    <button id="wv-next" title="Next slide">&#9654;</button>
  </div>
  ${commentsHtml}
  <script>
    var frame = document.getElementById('frame');
    var loading = document.getElementById('loading');
    var wvNav = document.getElementById('wv-nav');
    var wvPage = document.getElementById('wv-page');
    var slidevBase = null;

    // Register the readiness listener FIRST so it always fires regardless of what
    // happens below (acquireVsCodeApi, button wiring, etc.).
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (!msg) return;
      if (msg.type === 'slidev-ready') {
        slidevBase = (msg.url || '').replace(/[/]+$/, '');
        loading.style.display = 'none';
        frame.src = msg.url;
        frame.style.display = 'block';
        if (wvNav) wvNav.style.display = 'flex';
      } else if (msg.type === 'slide-index') {
        if (msg.navigate && slidevBase !== null) {
          frame.style.opacity = '0';
          frame.src = slidevBase + (msg.index === 0 ? '/' : '/' + (msg.index + 1));
        }
        if (wvPage) wvPage.textContent = String(msg.index + 1);
      } else if (msg.type === 'slidev-timeout') {
        loading.querySelector('p').textContent = 'Timed out waiting for Slidev. Is @slidev/cli installed?';
      } else if (msg.type === 'slidev-error') {
        loading.querySelector('h2').textContent = 'Slidev failed to start';
        loading.querySelector('p').textContent = msg.message || 'Unknown error';
      }
    });

    // Set up nav buttons and keyboard shortcuts — wrapped in try/catch so any
    // failure here does NOT prevent the message listener above from working.
    try {
      // acquireVsCodeApi must be called exactly once — share via window._vscodeApi
      // so COMMENT_OVERLAY_JS (appended below) can reuse it without calling it again.
      var vscode = (window._vscodeApi = acquireVsCodeApi());

      var prevBtn = document.getElementById('wv-prev');
      var nextBtn = document.getElementById('wv-next');
      if (prevBtn) prevBtn.addEventListener('click', function() { vscode.postMessage({ type: 'nav:prev' }); });
      if (nextBtn) nextBtn.addEventListener('click', function() { vscode.postMessage({ type: 'nav:next' }); });

      // Fade in after each iframe load (agent navigation crossfade).
      // Also give the iframe focus so Slidev's native controls (Space, arrows) work.
      frame.addEventListener('load', function() {
        frame.style.opacity = '1';
        try { frame.focus(); } catch(e) {}
      });

      document.addEventListener('keydown', function(e) {
        var t = e.target;
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
        if (t && t.closest && t.closest('.accordo-inline-input,.accordo-popover')) return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); vscode.postMessage({ type: 'nav:next' }); }
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); vscode.postMessage({ type: 'nav:prev' }); }
      });
    } catch (setupErr) {
      // Non-fatal: nav buttons will be unresponsive but the presentation still loads.
      console.warn('[accordo-slidev] nav setup error:', setupErr);
    }
  </script>
  ${commentsScript}
</body>
</html>`;
}
