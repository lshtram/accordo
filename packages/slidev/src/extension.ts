/**
 * accordo-slidev — VS Code Extension Entry Point
 *
 * Activates by acquiring BridgeAPI from accordo-bridge and wiring:
 * - PresentationStateContribution (modality state → Hub)
 * - PresentationProvider (WebviewPanel + Slidev process)
 * - SurfaceCommentAdapter (from accordo-comments getSurfaceAdapter)
 * - PresentationTools (9 MCP tools registered via BridgeAPI)
 *
 * If accordo-bridge is not installed, the extension is inert.
 * If accordo-comments is unavailable, presentation works without comments (M44-EXT-06).
 *
 * Source: requirements-slidev.md §4 M44-EXT
 *
 * Requirements:
 *   M44-EXT-01  Activates Bridge dependency and acquires BridgeAPI exports
 *   M44-EXT-02  Registers all presentation tools
 *   M44-EXT-03  Creates WebviewPanel on demand (via open tool), not via custom editor provider
 *   M44-EXT-04  Acquires comments surface adapter via getSurfaceAdapter when available
 *   M44-EXT-05  Publishes initial modality state via bridge.publishState
 *   M44-EXT-06  If comments extension unavailable, presentation works without comments
 *   M44-EXT-07  Only one presentation session at a time
 */

import * as vscode from "vscode";
import { spawn as cpSpawn } from "node:child_process";
import type { SurfaceAdapterLike } from "./types.js";
import { parseDeck, generateNarration } from "./narration.js";
import { SlidevAdapter } from "./slidev-adapter.js";
import { PresentationProvider, findFreePort } from "./presentation-provider.js";
import { PresentationCommentsBridge } from "./presentation-comments-bridge.js";
import { PresentationStateContribution } from "./presentation-state.js";
import { createPresentationTools } from "./presentation-tools.js";
import type { BridgeAPI, ParsedDeck, ProcessSpawner } from "./types.js";
import type { PresentationRuntimeAdapter } from "./runtime-adapter.js";
import type { PresentationToolDeps } from "./presentation-tools.js";

export type { BridgeAPI };

/** Session-local mutable state. */
interface SessionState {
  adapter: PresentationRuntimeAdapter | null;
  deck: ParsedDeck | null;
  /** Subscription for adapter.onSlideChanged — disposed when session closes. */
  slideSubscription: { dispose(): void } | null;
  /**
   * Set while openSession() is in progress. Navigation tools await this
   * so that parallel open+navigate calls (common with agent batching)
   * succeed instead of immediately returning "No presentation session is open."
   */
  openingPromise: Promise<void> | null;
}

/**
 * Called by VS Code when the extension activates (onStartupFinished).
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // M44-EXT-01: Acquire bridge
  const bridgeExt = vscode.extensions.getExtension<BridgeAPI>("accordo.accordo-bridge");
  if (!bridgeExt) return; // Inert when bridge is absent (M44-EXT-06 analogue)

  const bridge: BridgeAPI = bridgeExt.exports;

  // M44-STATE: State contribution
  const stateContrib = new PresentationStateContribution(bridge);

  // M44-PVD: Presentation provider
  const portOverride =
    vscode.workspace.getConfiguration("accordo.presentation").get<number>("port") ?? null;

  const spawner: ProcessSpawner = (cmd, args, opts) => {
    // stdin must be 'pipe' (not 'ignore') — Slidev v52+ detects closed stdin
    // and exits immediately instead of running as a dev server.
    const proc = cpSpawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    return {
      kill: () => proc.kill(),
      get exited() { return proc.exitCode !== null; },
      onExit: (listener) => { proc.once("exit", (code) => listener(code)); },
      onStderr: (listener) => {
        proc.stderr?.on("data", (chunk: Buffer) => listener(chunk.toString()));
      },
    };
  };

  const provider = new PresentationProvider({ context, spawner, portOverride });
  context.subscriptions.push(provider);

  // M44-EXT-04: Try to get surface adapter from accordo-comments
  // Wrapped in try/catch: executeCommand rejects if the command isn't
  // registered yet (race on first activation) — slidev must stay inert
  // rather than crash, per M44-EXT-06.
  let surfaceAdapter: SurfaceAdapterLike | null = null;
  const commentsExt = vscode.extensions.getExtension("accordo.accordo-comments");
  if (commentsExt) {
    try {
      surfaceAdapter =
        (await vscode.commands.executeCommand<SurfaceAdapterLike>(
          "accordo_comments_internal_getSurfaceAdapter",
          "slide",
        )) ?? null;
    } catch {
      // comments unavailable or not yet ready — presentation works without it
    }
  }

  // Session-local mutable state (reset on close)
  const session: SessionState = { adapter: null, deck: null, slideSubscription: null, openingPromise: null };

  /**
   * Returns the active adapter, waiting up to `timeoutMs` (default 10 s) if
   * openSession() is currently in progress (agent parallelised open + navigate).
   * Returns an error string when no session is open or opening.
   */
  async function requireAdapter(timeoutMs = 10_000): Promise<PresentationRuntimeAdapter | string> {
    if (session.adapter) return session.adapter;
    if (!session.openingPromise) return "No presentation session is open.";
    await Promise.race([
      session.openingPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs),
      ),
    ]).catch(() => { /* timeout — fall through to null-check below */ });
    return session.adapter ?? "No presentation session is open.";
  }

  // M44-EXT-02: Tool deps wiring
  const toolDeps: PresentationToolDeps = {
    discoverDeckFiles: async () => {
      // Find .md files, excluding obvious non-deck directories
      const files = await vscode.workspace.findFiles(
        "**/*.md",
        "**/{node_modules,.git,dist,build,vendor,tmp,.vscode}/**",
      );

      // Filter to actual Slidev decks: check first 600 bytes for Slidev markers.
      // A Slidev deck either:
      //   (a) has YAML frontmatter (starts with "---") containing a Slidev key, OR
      //   (b) has a path that matches known deck naming conventions.
      const deckFiles: string[] = [];
      const slidevFrontmatterKeys = ["theme:", "layout:", "transition:", "drawings:", "background:", "routerMode:", "slidev"];

      for (const file of files) {
        // Fast path: naming convention
        const fp = file.fsPath;
        if (
          fp.endsWith(".deck.md") ||
          /[/\\](slides|decks|deck|presentations?)([/\\]|$)/.test(fp)
        ) {
          deckFiles.push(fp);
          continue;
        }

        // Content check: read first 600 bytes and look for Slidev YAML frontmatter
        try {
          const bytes = await vscode.workspace.fs.readFile(file);
          const head = Buffer.from(bytes.slice(0, 600)).toString("utf-8");
          if (head.startsWith("---\n") || head.startsWith("---\r\n")) {
            const fmEnd = head.indexOf("\n---", 4);
            const frontmatter = fmEnd > 0 ? head.slice(0, fmEnd) : head;
            if (slidevFrontmatterKeys.some((k) => frontmatter.includes(k))) {
              deckFiles.push(fp);
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      return deckFiles;
    },

    openSession: async (deckUri: string) => {
      let resolveOpening!: () => void;
      session.openingPromise = new Promise<void>((resolve) => {
        resolveOpening = resolve;
      });
      try {
        const rawBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(deckUri));
        const raw = Buffer.from(rawBytes).toString("utf-8");

        // Validate before accepting
        const tempAdapter = new SlidevAdapter({ port: 0, deck: { slides: [], raw: "" } });
        const validation = tempAdapter.validateDeck(deckUri, raw);
        if (!validation.valid) return { error: validation.error ?? "Invalid deck" };

        const deck = parseDeck(raw);
        const port =
          portOverride ??
          (await findFreePort(7788, 7888).catch(() => 7788));

        const adapter = new SlidevAdapter({ port, deck });
        session.adapter = adapter;
        session.deck = deck;
        resolveOpening(); // unblock any navigation tools waiting for the session

        const commentsBridge = surfaceAdapter
          ? new PresentationCommentsBridge(surfaceAdapter, {
              postMessage: (msg) =>
                provider.getPanel()?.webview.postMessage(msg) ?? Promise.resolve(false),
            })
          : null;

        stateContrib.update({
          isOpen: true,
          deckUri,
          totalSlides: deck.slides.length,
          currentSlide: 0,
          narrationAvailable: deck.slides.length > 0,
        });

        await provider.open(deckUri, adapter, commentsBridge);

        // M44-RT-04: start polling the Slidev server and push slide-index updates
        // to the webview and state contribution whenever the user navigates manually.
        adapter.startPolling();
        session.slideSubscription = adapter.onSlideChanged((index) => {
          stateContrib.update({ currentSlide: index });
          provider.getPanel()?.webview.postMessage({ type: "slide-index", index });
        });

        // Initial slide sync: push the server's current slide to the webview immediately
        // so the comment overlay starts on the correct slide without waiting for the
        // first 500 ms poll tick (addresses startup race when Slidev resumes a session).
        void adapter.getCurrent().then(({ index }) => {
          provider.getPanel()?.webview.postMessage({ type: "slide-index", index });
        }).catch(() => { /* non-fatal — poller will correct on next tick */ });

        // Wire webview prev/next nav buttons → toolDeps (extension host controls the
        // current slide so onSlideChanged fires and slide-index is sent back to webview).
        provider.getPanel()?.webview.onDidReceiveMessage((msg: unknown) => {
          if (msg && typeof msg === "object") {
            const m = msg as Record<string, unknown>;
            if (m.type === "nav:next") void toolDeps.next();
            else if (m.type === "nav:prev") void toolDeps.prev();
          }
        });

        return {};
      } catch (err) {
        resolveOpening(); // unblock waiters even on failure (adapter stays null → they get error)
        return { error: err instanceof Error ? err.message : String(err) };
      } finally {
        session.openingPromise = null;
      }
    },

    closeSession: () => {
      provider.close();
      session.slideSubscription?.dispose();
      session.slideSubscription = null;
      session.adapter?.dispose();
      session.adapter = null;
      session.deck = null;
      session.openingPromise = null;
    },

    listSlides: async () => {
      const a = await requireAdapter();
      if (typeof a === "string") return { error: a };
      return a.listSlides();
    },

    getCurrent: async () => {
      const a = await requireAdapter();
      if (typeof a === "string") return { error: a };
      return a.getCurrent();
    },

    goto: async (index: number) => {
      try {
        const a = await requireAdapter();
        if (typeof a === "string") return { error: a };
        await a.goto(index);
        stateContrib.update({ currentSlide: index });
        provider.getPanel()?.webview.postMessage({ type: "slide-index", index, navigate: true });
        return {};
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },

    next: async () => {
      try {
        const a = await requireAdapter();
        if (typeof a === "string") return { error: a };
        await a.next();
        const current = await a.getCurrent();
        stateContrib.update({ currentSlide: current.index });
        provider.getPanel()?.webview.postMessage({ type: "slide-index", index: current.index, navigate: true });
        return {};
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },

    prev: async () => {
      try {
        const a = await requireAdapter();
        if (typeof a === "string") return { error: a };
        await a.prev();
        const current = await a.getCurrent();
        stateContrib.update({ currentSlide: current.index });
        provider.getPanel()?.webview.postMessage({ type: "slide-index", index: current.index, navigate: true });
        return {};
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },

    generateNarration: async (target: number | "all") => {
      if (!session.deck) {
        const a = await requireAdapter();
        if (typeof a === "string") return { error: a };
      }
      if (!session.deck) return { error: "No presentation session is open." };
      try {
        return generateNarration(session.deck, target);
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const tools = createPresentationTools(toolDeps);
  // Wrap in try/catch: bridge.registerTools sends over WebSocket which may not
  // be connected yet on first startup. The extension must still finish activating
  // so the custom editor provider for .deck.md files gets registered.
  try {
    const toolsDisposable = bridge.registerTools("accordo-slidev", tools);
    context.subscriptions.push(toolsDisposable);
  } catch {
    // Hub not connected — tools unavailable, extension remains functional for deck opening.
  }

  // ── VS Code command registrations (explorer context menu, command palette) ──

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "accordo.presentation.open",
      async (uri?: vscode.Uri) => {
        // Accept a URI from the explorer context menu or prompt the user
        let deckPath: string | undefined;
        if (uri) {
          deckPath = uri.fsPath;
        } else {
          const files = await toolDeps.discoverDeckFiles();
          if (files.length === 0) {
            vscode.window.showWarningMessage("No Slidev deck files found in the workspace.");
            return;
          }
          const picked = await vscode.window.showQuickPick(
            files.map((f) => ({ label: f.split("/").pop() ?? f, description: f, fsPath: f })),
            { placeHolder: "Select a deck file to open" },
          );
          if (!picked) return;
          deckPath = picked.fsPath;
        }
        const result = await toolDeps.openSession(deckPath);
        if (result.error) {
          vscode.window.showErrorMessage(`Failed to open deck: ${result.error}`);
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("accordo.presentation.close", () => {
      toolDeps.closeSession();
    }),
  );

  // Prerequisite for M45-NR: expose goto as a VS Code command so the custom
  // Comments Panel navigation router can jump to a slide via executeCommand.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "accordo.presentation.goto",
      async (index?: unknown) => {
        if (typeof index !== "number") {
          vscode.window.showInformationMessage(
            "accordo_presentation_goto: a numeric slide index is required.",
          );
          return;
        }
        const result = await toolDeps.goto(index);
        if (result.error) {
          vscode.window.showErrorMessage(`Failed to navigate to slide: ${result.error}`);
        }
      },
    ),
  );

  // Internal goto command — used by the Comments Panel navigation router.
  // Unlike the public accordo.presentation.goto, this THROWS on error so the
  // router's try/catch can detect "no session" and fall through to openSession.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "accordo_presentation_internal_goto",
      async (index?: unknown) => {
        if (typeof index !== "number") throw new Error("slide index required");
        const result = await toolDeps.goto(index);
        if (result.error) throw new Error(result.error);
      },
    ),
  );

  // Internal focusThread command — posts a comments:focus message to the
  // presentation webview so the comment popover opens at the current slide.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "accordo_presentation_internal_focusThread",
      (threadId: string): boolean => {
        const panel = provider.getPanel();
        if (panel) {
          void panel.webview.postMessage({ type: "comments:focus", threadId });
          return true;
        }
        return false;
      },
    ),
  );

  // M44-EXT-08: CustomTextEditorProvider for .deck.md files.
  // When a .deck.md file is activated in the explorer or editor, VS Code hands
  // it to this provider. We immediately start a presentation session AND show a
  // minimal "opening…" webview so VS Code has a panel to display. The webview
  // is replaced once the real PresentationProvider panel is ready.
  const deckEditorProvider: vscode.CustomTextEditorProvider = {
    resolveCustomTextEditor(
      document: vscode.TextDocument,
      webviewPanel: vscode.WebviewPanel,
    ): void | Thenable<void> {
      const requestedUri = document.uri.fsPath;

      // Guard against the race where closing deck A's Slidev panel causes VS Code
      // to re-fire resolveCustomTextEditor for deck A while deck B is opening.
      // If this URI is already the active deck or currently being opened, just
      // reveal the existing presentation and discard this transient webview.
      if (
        provider.getCurrentDeckUri() === requestedUri ||
        provider.getPendingDeckUri() === requestedUri
      ) {
        provider.getPanel()?.reveal?.();
        webviewPanel.dispose();
        return;
      }

      // Show a brief loading screen while the session initialises
      webviewPanel.webview.html = `<!DOCTYPE html><html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#ccc;background:#1e1e1e"><p>Opening presentation…</p></body></html>`;
      // Open the real session (PresentationProvider creates its own panel beside)
      void toolDeps.openSession(requestedUri).then((result) => {
        if (result.error) {
          webviewPanel.webview.html = `<!DOCTYPE html><html><body style="padding:20px;font-family:sans-serif;color:#f44;background:#1e1e1e"><p>Failed to open deck: ${result.error}</p></body></html>`;
        } else {
          // Session opened successfully — dispose this transient panel.
          webviewPanel.dispose();
        }
      });
    },
  };

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "accordo.deckPresentation",
      deckEditorProvider,
      { webviewOptions: { retainContextWhenHidden: false }, supportsMultipleEditorsPerDocument: false },
    ),
  );

  // M44-EXT-05: Publish initial state
  try {
    stateContrib.update({});
  } catch {
    // Hub not connected on first startup — state will be published on next session open.
  }

  // Reset state on provider dispose (M44-PVD-06)
  provider.onDispose(() => {
    session.slideSubscription?.dispose();
    session.slideSubscription = null;
    session.adapter?.dispose();
    session.adapter = null;
    session.deck = null;
    stateContrib.reset();
  });
}

/**
 * Called by VS Code on deactivation — close any open session.
 */
export function deactivate(): void {
  // Session cleanup handled by context.subscriptions / PresentationProvider.dispose()
}

