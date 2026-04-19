/**
 * NavigationRouter — Anchor-aware navigation dispatch for the Comments Panel.
 *
 * Priority Q Phase A:
 * - keep one canonical routing function (`navigateToThread`)
 * - describe dispatch through typed plans and local abstractions
 * - provide import-clean stubs only (no runtime behavior yet)
 */

import type * as vscode from "vscode";
import type { CommentThread } from "@accordo/bridge-types";
import type { NavigationAdapterRegistry } from "@accordo/capabilities";
import {
  createNavigationAdapterRegistry,
} from "@accordo/capabilities";
import type { BrowserRelayHealthReader } from "./browser-relay-health.js";
import { buildNavigationDispatchPlan } from "./navigation-contract.js";

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
 * Dispatch strategy (design intent):
 * - text/file: VS Code editor reveal path
 * - markdown-preview: accordo_preview_internal_focusThread
 * - slide: accordo.presentation.internal.focusThread(uri, threadId, blockId)
 * - diagram: accordo_diagram_focusThread(threadId, uri)
 * - browser: accordo_browser.focusThread(threadId), with health-aware fallback messaging
 */
export async function navigateToThread(
  thread: CommentThread,
  env: NavigationEnv,
  registry?: NavigationAdapterRegistry,
): Promise<void> {
  void thread;
  void env;
  void registry;
  throw new Error("not implemented");
}

/**
 * Phase A planner stub for the future dispatch implementation.
 */
export async function navigateWithPlan(
  deps: NavigationRouterDeps,
  thread: CommentThread,
): Promise<void> {
  void deps;
  void buildNavigationDispatchPlan(thread);
  throw new Error("not implemented");
}

/**
 * Exposes module-level registry for tests and cross-extension wiring.
 */
export function getAdapterRegistry(): NavigationAdapterRegistry {
  return adapterRegistry;
}
