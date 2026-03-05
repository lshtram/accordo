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
    const proc = cpSpawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
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
          "accordo.comments.internal.getSurfaceAdapter",
          "slide",
        )) ?? null;
    } catch {
      // comments unavailable or not yet ready — presentation works without it
    }
  }

  // Session-local mutable state (reset on close)
  const session: SessionState = { adapter: null, deck: null };

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
        return {};
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },

    closeSession: () => {
      provider.close();
      session.adapter?.dispose();
      session.adapter = null;
      session.deck = null;
    },

    listSlides: async () => {
      if (!session.adapter) return { error: "No presentation session is open." };
      return session.adapter.listSlides();
    },

    getCurrent: async () => {
      if (!session.adapter) return { error: "No presentation session is open." };
      return session.adapter.getCurrent();
    },

    goto: async (index: number) => {
      try {
        if (!session.adapter) return { error: "No presentation session is open." };
        await session.adapter.goto(index);
        stateContrib.update({ currentSlide: index });
        return {};
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },

    next: async () => {
      try {
        if (!session.adapter) return { error: "No presentation session is open." };
        await session.adapter.next();
        const current = await session.adapter.getCurrent();
        stateContrib.update({ currentSlide: current.index });
        return {};
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },

    prev: async () => {
      try {
        if (!session.adapter) return { error: "No presentation session is open." };
        await session.adapter.prev();
        const current = await session.adapter.getCurrent();
        stateContrib.update({ currentSlide: current.index });
        return {};
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },

    generateNarration: async (target: number | "all") => {
      if (!session.deck) return { error: "No presentation session is open." };
      try {
        return generateNarration(session.deck, target);
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const tools = createPresentationTools(toolDeps);
  const toolsDisposable = bridge.registerTools("accordo-slidev", tools);
  context.subscriptions.push(toolsDisposable);

  // M44-EXT-05: Publish initial state
  stateContrib.update({});

  // Reset state on provider dispose (M44-PVD-06)
  provider.onDispose(() => {
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

