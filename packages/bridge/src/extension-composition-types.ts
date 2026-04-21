import type { IDEState } from "@accordo/bridge-types";
import type { Services } from "./extension-service-factory.js";
import type { BootstrapResult } from "./extension-bootstrap.js";
import type { WsClient } from "./ws-client.js";

export interface Disposable {
  dispose(): void;
}

export type Event<T> = (
  listener: (e: T) => unknown,
  thisArgs?: unknown,
  disposables?: Disposable[],
) => Disposable;

export interface ExtensionState {
  wsClient: WsClient | null;
  currentHubToken: string;
  currentHubPort: number;
}

export interface CompositionDeps {
  readonly bootstrap: BootstrapResult;
  readonly services: Services;
  readonly state: ExtensionState;
  readonly showQuickPick?: (
    items: Array<{ label: string }>,
    options: { canPickMany: boolean; title: string },
  ) => Promise<unknown>;
}

export interface ComposedBridgeAPI {
  registerTools(
    extensionId: string,
    tools: ReadonlyArray<{ readonly name: string; readonly handler: (args: Record<string, unknown>) => Promise<unknown> }>,
  ): Disposable;
  publishState(extensionId: string, state: Record<string, unknown>): void;
  getState(): IDEState;
  isConnected(): boolean;
  onConnectionStatusChanged: Event<boolean>;
  invokeTool(toolName: string, args: Record<string, unknown>, timeout?: number): Promise<unknown>;
}
