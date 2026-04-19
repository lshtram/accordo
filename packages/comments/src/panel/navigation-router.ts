/**
 * NavigationRouter — Anchor-aware navigation dispatch for the Comments Panel.
 *
 * Priority Q Phase C implementation:
 * - keep one canonical routing function (`navigateToThread`)
 * - describe dispatch through typed plans and local abstractions
 * - dispatch is done via navigateWithPlan
 */

import type * as vscode from "vscode";
import type { CommentThread } from "@accordo/bridge-types";
import type { NavigationAdapterRegistry } from "@accordo/capabilities";
import {
  createNavigationAdapterRegistry,
} from "@accordo/capabilities";
import type { BrowserRelayHealthReader } from "./browser-relay-health.js";
import { buildNavigationDispatchPlan } from "./navigation-contract.js";
import { DEFERRED_COMMANDS } from "@accordo/capabilities";

/**
 * Injectable abstraction over vscode.window / vscode.commands / delay.
 */
export interface NavigationEnv {
  showTextDocument(
    uri: vscode.Uri,
    options?: vscode.TextDocumentShowOptions,
  ): Thenable<vscode.TextEditor>;
  executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
  showWarningMessage(message: string): Thenable<string | undefined>;
  showInformationMessage(message: string): Thenable<string | undefined>;
  delay(ms: number): Promise<void>;
  visibleTextEditorUris(): readonly string[];
}

/**
 * Extended environment for browser-health-aware navigation messaging.
 */
export interface NavigationRouterDeps {
  readonly env: NavigationEnv;
  readonly registry: NavigationAdapterRegistry;
  readonly browserRelayHealth: BrowserRelayHealthReader;
}

const adapterRegistry: NavigationAdapterRegistry = createNavigationAdapterRegistry();

/**
 * Priority Q entrypoint.
 *
 * Dispatch strategy:
 * - text/file: VS Code editor reveal path
 * - markdown-preview: accordo_preview_internal_focusThread
 * - slide: accordo.presentation.internal.focusThread(uri, threadId, blockId)
 * - diagram: accordo_diagram_focusThread(threadId, uri)
 * - browser: accordo_browser.focusThread(threadId), with health-aware fallback messaging
 */
export async function navigateToThread(
  thread: CommentThread,
  env: NavigationEnv,
  _registry?: NavigationAdapterRegistry,
): Promise<void> {
  const plan = buildNavigationDispatchPlan(thread);

  switch (plan.target) {
    case "text": {
      const anchor = thread.anchor;
      if (anchor.kind !== "text") break;
      const uri = anchor.uri;
      const visible = env.visibleTextEditorUris();
      const isMd = uri.endsWith(".md");
      if (isMd && visible.includes(uri)) {
        // Already open in text editor — reveal the range
        await env.showTextDocument(
          parseUri(uri),
          { selection: anchor.range as unknown as vscode.Range },
        );
      } else if (isMd) {
        // .md not open in text editor — open in text editor (not preview)
        await env.showTextDocument(
          parseUri(uri),
          { selection: anchor.range as unknown as vscode.Range },
        );
      } else {
        // Non-.md file — always use text editor
        await env.showTextDocument(
          parseUri(uri),
          { selection: anchor.range as unknown as vscode.Range },
        );
      }
      // Expand the gutter widget after showing the document
      await env.executeCommand(
        "accordo_comments_internal_expandThread",
        thread.id,
      );
      return;
    }

    case "file": {
      const anchor = thread.anchor;
      if (anchor.kind !== "file") break;
      await env.showTextDocument(parseUri(anchor.uri));
      return;
    }

    case "slide": {
      // Try primary focus command; on fail fall back to goto then retry
      try {
        if (plan.primaryCommand && plan.primaryArgs.length > 0) {
          await env.executeCommand(plan.primaryCommand, ...plan.primaryArgs);
          return;
        }
      } catch {
        // fall through to goto
      }
      // Goto the deck
      if (plan.fallbackCommand) {
        try {
          await env.executeCommand(plan.fallbackCommand, ...(plan.fallbackArgs ?? []));
          // Wait 2s then retry focus
          await env.delay(2000);
          if (plan.primaryCommand && plan.primaryArgs.length > 0) {
            await env.executeCommand(plan.primaryCommand, ...plan.primaryArgs);
          }
        } catch {
          // fallback failed — show warning
          await env.showWarningMessage("Deck opened. Navigation may be incomplete.");
        }
      }
      return;
    }

    case "markdown-preview":
    case "diagram":
    case "browser": {
      // Delegate to navigateWithPlan for surface dispatch
      const deps: NavigationRouterDeps = {
        env,
        registry: adapterRegistry,
        browserRelayHealth: {
          readHealth: async () => ({ connected: false }),
        },
      };
      await navigateWithPlan(deps, thread);
      return;
    }

    case "unknown-surface":
    default: {
      // Fall back to showTextDocument if possible
      const uri =
        thread.anchor.kind === "text" ? thread.anchor.uri :
        thread.anchor.kind === "file" ? thread.anchor.uri :
        null;
      if (uri) {
        await env.showTextDocument(parseUri(uri));
      }
      return;
    }
  }
}

/**
 * Phase C dispatch implementation using the NavigationDispatchPlan.
 * Handles browser surface health check before dispatch.
 */
export async function navigateWithPlan(
  deps: NavigationRouterDeps,
  thread: CommentThread,
): Promise<void> {
  const { env, browserRelayHealth } = deps;
  const plan = buildNavigationDispatchPlan(thread);

  // Browser surface: probe health before dispatch
  if (plan.target === "browser") {
    const health = await browserRelayHealth.readHealth();
    if (!health.connected) {
      const msg = plan.disconnectedMessage ?? "Browser extension not connected.";
      await env.showInformationMessage(msg);
      return;
    }
  }

  // Surface with primary command
  if (plan.primaryCommand && plan.primaryArgs.length > 0) {
    try {
      await env.executeCommand(plan.primaryCommand, ...plan.primaryArgs);
    } catch {
      // For diagram/browser surfaces, graceful fallback with message
      if (plan.disconnectedMessage) {
        await env.showInformationMessage(plan.disconnectedMessage);
      }
    }
    return;
  }

  // Slide: handle fallback retry path
  if (plan.target === "slide" && plan.fallbackCommand) {
    try {
      await env.executeCommand(plan.fallbackCommand, ...(plan.fallbackArgs ?? []));
    } catch {
      // fallback failed — show warning that deck is open
      await env.showWarningMessage("Deck opened. Navigation may be incomplete.");
      return;
    }
    // Delay then retry focus
    await env.delay(2000);
    if (plan.primaryCommand && plan.primaryArgs.length > 0) {
      await env.executeCommand(plan.primaryCommand, ...plan.primaryArgs);
    }
  }
}

/**
 * Exposes module-level registry for tests and cross-extension wiring.
 */
export function getAdapterRegistry(): NavigationAdapterRegistry {
  return adapterRegistry;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Parse a string URI into a vscode.Uri. Uses vscode.Uri.parse at runtime. */
function parseUri(uriString: string): vscode.Uri {
  // Dynamic import to avoid type-only import of vscode that would prevent
  // using it as a value. The require is fine here because this module is
  // only ever imported by the VS Code extension host, never in unit tests.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vscodeApi = require("vscode") as typeof import("vscode");
  return vscodeApi.Uri.parse(uriString);
}