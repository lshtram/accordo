/**
 * accordo-marp — VS Code Extension Entry Point
 *
 * Source: requirements-marp.md §4 M50-EXT
 */

import * as vscode from "vscode";
import { CAPABILITY_COMMANDS } from "@accordo/capabilities";
import type { SurfaceCommentAdapter } from "@accordo/capabilities";
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
    vscode.commands.registerCommand("accordo.marp.close", () => {
      closeSession(session, provider, stateContrib);
    }),
    // Script runner commands — these mirror the MCP tools so NarrationScript
    // "command" steps can invoke presentation navigation via executeCommand.
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
