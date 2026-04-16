/**
 * accordo-marp — VS Code Extension Entry Point
 *
 * Source: requirements-marp.md §4 M50-EXT
 */

import * as vscode from "vscode";
import { CAPABILITY_COMMANDS, DEFERRED_COMMANDS } from "@accordo/capabilities";
import type { SurfaceCommentAdapter, NavigationAdapterRegistry } from "@accordo/capabilities";
import { createNavigationAdapterRegistry } from "@accordo/capabilities";
import type { BridgeAPI, ParsedDeck } from "./types.js";
import { parseDeck } from "./narration.js";
import { MarpAdapter } from "./marp-adapter.js";
import { PresentationProvider } from "./presentation-provider.js";
import { PresentationCommentsBridge } from "./presentation-comments-bridge.js";
import { PresentationStateContribution } from "./presentation-state.js";
import { createPresentationTools } from "./presentation-tools.js";
import type { PresentationToolDeps } from "./presentation-tools.js";
import { MarpRenderer } from "./marp-renderer.js";

export type { BridgeAPI };

interface SessionState {
  adapter: MarpAdapter | null;
  deck: ParsedDeck | null;
  deckContent: string | null;
  slideSubscription: { dispose(): void } | null;
}

// Module-level registry shared with accordo-comments for surface:slide navigation routing.
// Registered at activation; accordo-comments acquires it via the getNavigationRegistry command.
let sharedRegistry: NavigationAdapterRegistry | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const engineSetting =
    vscode.workspace.getConfiguration().get<string>("accordo.presentation.engine") ?? "marp";
  if (engineSetting === "slidev") return;

  const bridgeExt = vscode.extensions.getExtension<BridgeAPI>("accordo.accordo-bridge");
  if (!bridgeExt) return;

  const bridge: BridgeAPI = bridgeExt.exports;

  const stateContrib = new PresentationStateContribution(bridge);
  stateContrib.update({
    isOpen: false,
    deckUri: null,
    currentSlide: 0,
    totalSlides: 0,
    narrationAvailable: false,
  });

  const commentsAdapter = await acquireCommentsAdapter();
  const provider = new PresentationProvider({ context });

  // Navigation adapter for surface:slide routing via comments panel.
  // Stored at module level (sharedRegistry) and exposed via command for accordo-comments.
  sharedRegistry = createNavigationAdapterRegistry();
  const registry = sharedRegistry;
  const slideAdapter: NavigationAdapterRegistry extends { get(s: string): infer A } ? A : never = {
    surfaceType: "slide",
    navigateToAnchor: async (anchor) => {
      // anchor is a CommentAnchorSurface cast to Record<string, unknown>.
      // The real slideIndex lives at anchor.coordinates.slideIndex.
      const a = anchor as { coordinates?: { slideIndex?: number } };
      const slideIndex = a.coordinates?.slideIndex;
      if (typeof slideIndex === "number") {
        await vscode.commands.executeCommand(
          DEFERRED_COMMANDS.PRESENTATION_GOTO,
          slideIndex,
        );
        return true;
      }
      return false;
    },
    focusThread: async (threadId, anchor) => {
      // M50-FOCUS is the single canonical focus path.
      // Call accordo.presentation.internal.focusThread directly with the full context
      // so it can open the deck, navigate to the slide, and post comments:focus.
      const a = anchor as { uri?: string; coordinates?: { slideIndex?: number }; blockId?: string } | undefined;
      const uri = a?.uri ?? "";
      const blockId = a?.blockId ?? (a?.coordinates?.slideIndex !== undefined ? `slide:${a.coordinates.slideIndex}:0.5000:0.5000` : "");
      await vscode.commands.executeCommand(
        "accordo.presentation.internal.focusThread",
        uri,
        threadId,
        blockId,
      );
      return true;
    },
  };
  registry.register(slideAdapter);

  const session: SessionState = {
    adapter: null,
    deck: null,
    deckContent: null,
    slideSubscription: null,
  };

  const deps: PresentationToolDeps = {
    discoverDeckFiles,
    openSession: (uri) => openSession(uri, session, provider, stateContrib, commentsAdapter),
    closeSession: () => { closeSession(session, provider, stateContrib); },
    listSlides: () => listSlides(session),
    getCurrent: () => getCurrent(session),
    goto: (index) => gotoSlide(index, session, stateContrib),
    next: () => nextSlide(session, stateContrib),
    prev: () => prevSlide(session, stateContrib),
    generateNarration: (target) => generateNarration(target, session),
    capture: () => provider.requestCapture(),
    getSessionDeckUri: () => provider.getCurrentDeckUri(),
  };

  const tools = createPresentationTools(deps);
  let toolRegistration: { dispose(): void };
  try {
    toolRegistration = bridge.registerTools("accordo-marp", tools);
  } catch {
    return;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("accordo.marp.open", (uri?: vscode.Uri) => {
      if (uri) {
        void openSession(uri.fsPath, session, provider, stateContrib, commentsAdapter);
      } else {
        void vscode.window.showOpenDialog({ filters: { Markdown: ["md"] } }).then((uris) => {
          if (uris?.[0]) {
            void openSession(uris[0].fsPath, session, provider, stateContrib, commentsAdapter);
          }
        });
      }
    }),
    // Alias for accordo.marp.open — used by accordo-comments navigation router
    // when opening a deck from a comment thread on a slide surface.
    vscode.commands.registerCommand("accordo.presentation.open", (uri?: vscode.Uri) => {
      if (uri) {
        void openSession(uri.fsPath, session, provider, stateContrib, commentsAdapter);
      } else {
        void vscode.window.showOpenDialog({ filters: { Markdown: ["md"] } }).then((uris) => {
          if (uris?.[0]) {
            void openSession(uris[0].fsPath, session, provider, stateContrib, commentsAdapter);
          }
        });
      }
    }),
    vscode.commands.registerCommand("accordo.marp.close", () => {
      closeSession(session, provider, stateContrib);
    }),
    vscode.commands.registerCommand("accordo_presentation_goto", (args: unknown) => {
      const index = (args as { index?: number } | undefined)?.index;
      if (typeof index === "number") {
        return gotoSlide(index - 1, session, stateContrib);
      }
      return Promise.resolve({});
    }),
    vscode.commands.registerCommand("accordo_presentation_next", () =>
      nextSlide(session, stateContrib),
    ),
    vscode.commands.registerCommand("accordo_presentation_prev", () =>
      prevSlide(session, stateContrib),
    ),
    // Internal commands used by the NavigationAdapter registry (surface:slide routing)
    // and by DEFERRED_COMMANDS fallback in accordo-comments navigation-router.
    // PRESENTATION_GOTO: takes a 0-based raw slide index (matches CapabilityCommandMap)
    vscode.commands.registerCommand("accordo_presentation_internal_goto", (slideIndex: unknown) => {
      if (typeof slideIndex === "number") {
        return gotoSlide(slideIndex, session, stateContrib);
      }
      return Promise.resolve({});
    }),

    // M50-FOCUS: Canonical focusThread command (M50-FOCUS-01 through M50-FOCUS-05).
    // Handles the full focus sequence: open deck → parse slide → navigate → post to webview.
    vscode.commands.registerCommand(
      "accordo.presentation.internal.focusThread",
      async (uri: string, threadId: string, blockId: string) => {
        // M50-FOCUS-03: open the deck if not already open
        const currentDeckUri = provider.getCurrentDeckUri();
        if (currentDeckUri !== uri) {
          try {
            await openSession(uri, session, provider, stateContrib, commentsAdapter);
          } catch {
            // If we can't open the deck, continue anyway to allow focus message to be posted
          }
        }

        // M50-FOCUS-04: parse slideIndex from blockId (format: slide:{idx}:{x}:{y})
        const match = /^slide:(\d+):[\d.]+:[\d.]+$/.exec(blockId);
        if (match) {
          const slideIndex = parseInt(match[1], 10);
          await gotoSlide(slideIndex, session, stateContrib);
        }

        // M50-FOCUS-05: post comments:focus to webview after navigation
        const panel = provider.getPanel();
        if (panel) {
          panel.webview.postMessage({ type: "comments:focus", threadId, blockId });
        }

        // Always return a defined value so the command promise resolves predictably
        return { uri, threadId, blockId };
      },
    ),
    // Expose the navigation registry to accordo-comments for surface:slide routing.
    // Returns the shared registry (or null if marp hasn't activated yet).
    vscode.commands.registerCommand("accordo_marp_internal_getNavigationRegistry", () =>
      sharedRegistry,
    ),
    toolRegistration,
  );
}

export function deactivate(): void {}

async function openSession(
  deckUri: string,
  session: SessionState,
  provider: PresentationProvider,
  stateContrib: PresentationStateContribution,
  commentsAdapter: SurfaceCommentAdapter | null,
): Promise<{ error?: string }> {
  closeSession(session, provider, stateContrib);

  let deckContent: string;
  try {
    const doc = await vscode.workspace.openTextDocument(deckUri);
    deckContent = doc.getText();
  } catch {
    return { error: `Could not read deck file: ${deckUri}` };
  }

  const adapter = new MarpAdapter(deckContent);
  const validation = adapter.validateDeck(deckUri, deckContent);
  if (!validation.valid) {
    return { error: validation.error };
  }

  const deck = parseDeck(deckContent);
  const commentsBridge = commentsAdapter
    ? new PresentationCommentsBridge(commentsAdapter, {
        postMessage: (msg: unknown) => Promise.resolve(true),
      })
    : null;

  await provider.open(deckUri, adapter, new MarpRenderer(), commentsBridge);

  session.adapter = adapter;
  session.deck = deck;
  session.deckContent = deckContent;

  stateContrib.update({
    isOpen: true,
    deckUri,
    currentSlide: 0,
    totalSlides: deck.slides.length,
    narrationAvailable: true,
  });

  return {};
}

function closeSession(
  session: SessionState,
  provider: PresentationProvider,
  stateContrib: PresentationStateContribution,
): void {
  session.slideSubscription?.dispose();
  session.slideSubscription = null;
  session.adapter = null;
  session.deck = null;
  session.deckContent = null;
  provider.close();
  stateContrib.reset();
}

async function listSlides(
  session: SessionState,
): Promise<{ error: string } | Array<{ index: number; title: string }>> {
  if (!session.adapter) return { error: "No presentation session is open." };
  return session.adapter.listSlides();
}

async function getCurrent(
  session: SessionState,
): Promise<{ error: string } | { index: number; title: string }> {
  if (!session.adapter) return { error: "No presentation session is open." };
  return session.adapter.getCurrent();
}

async function gotoSlide(
  index: number,
  session: SessionState,
  stateContrib: PresentationStateContribution,
): Promise<{ error?: string }> {
  if (!session.adapter) return { error: "No presentation session is open." };
  try {
    await session.adapter.goto(index);
  } catch (err) {
    return { error: (err as Error).message };
  }
  const total = session.deck?.slides.length ?? 0;
  stateContrib.update({ currentSlide: index, totalSlides: total });
  return {};
}

async function nextSlide(
  session: SessionState,
  stateContrib: PresentationStateContribution,
): Promise<{ error?: string }> {
  if (!session.adapter) return { error: "No presentation session is open." };
  const prev = await session.adapter.getCurrent();
  await session.adapter.next();
  const next = await session.adapter.getCurrent();
  const total = session.deck?.slides.length ?? 0;
  if (next.index !== prev.index) {
    stateContrib.update({ currentSlide: next.index, totalSlides: total });
  }
  return {};
}

async function prevSlide(
  session: SessionState,
  stateContrib: PresentationStateContribution,
): Promise<{ error?: string }> {
  if (!session.adapter) return { error: "No presentation session is open." };
  const prev = await session.adapter.getCurrent();
  await session.adapter.prev();
  const next = await session.adapter.getCurrent();
  const total = session.deck?.slides.length ?? 0;
  if (next.index !== prev.index) {
    stateContrib.update({ currentSlide: next.index, totalSlides: total });
  }
  return {};
}

async function generateNarration(
  target: number | "all",
  session: SessionState,
): Promise<{ error: string } | Array<{ slideIndex: number; narrationText: string }>> {
  if (!session.deck) return { error: "No presentation session is open." };
  const { generateNarration: gen } = await import("./narration.js");
  return gen(session.deck, target);
}

async function discoverDeckFiles(): Promise<string[]> {
  if (!vscode.workspace.workspaceFolders) return [];
  const files: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders) {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, "**/*.md"),
      "**/node_modules/**",
    );
    for (const uri of uris) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        if (doc.getText().includes("---")) {
          files.push(uri.fsPath);
        }
      } catch {
        // skip
      }
    }
  }
  return files;
}

async function acquireCommentsAdapter(): Promise<SurfaceCommentAdapter | null> {
  const commentsExt = vscode.extensions.getExtension("accordo.accordo-comments");
  if (!commentsExt) return null;
  try {
    const result = await vscode.commands.executeCommand<SurfaceCommentAdapter>(
      CAPABILITY_COMMANDS.COMMENTS_GET_SURFACE_ADAPTER,
      "slide",
    );
    return result ?? null;
  } catch {
    return null;
  }
}
