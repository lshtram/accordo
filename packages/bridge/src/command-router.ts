/**
 * Bridge Command Router
 *
 * Routes Hub → Bridge invoke/cancel messages to the correct tool handler.
 * Manages in-flight invocation tracking, timeout enforcement,
 * and optional confirmation dialogs.
 *
 * Requirements: requirements-bridge.md §5.2
 */

import type {
  InvokeMessage,
  CancelMessage,
  ResultMessage,
} from "@accordo/bridge-types";
import type { ExtensionRegistry } from "./extension-registry.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * An in-flight invocation being tracked by the router.
 */
export interface InFlightInvocation {
  /** Invocation ID (from InvokeMessage) */
  id: string;
  /** Tool name */
  tool: string;
  /** When the invocation started (Date.now()) */
  startedAt: number;
  /** Timeout handle for deadline enforcement */
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  /** Whether the invocation has been cancelled */
  cancelled: boolean;
  /** Whether the invocation has completed (result sent) */
  completed: boolean;
}

/**
 * Callback for showing a confirmation dialog to the user.
 * Returns true if user confirmed, false if rejected.
 */
export type ConfirmationDialogFn = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<boolean>;

/**
 * Callback for sending results back to Hub via WsClient.
 */
export type SendResultFn = (result: ResultMessage) => void;

/**
 * Callback for sending cancel acknowledgement to Hub.
 */
export type SendCancelledFn = (id: string, late: boolean) => void;

// ── CommandRouter ────────────────────────────────────────────────────────────

/**
 * Routes InvokeMessage and CancelMessage from Hub to local tool handlers.
 *
 * Invoke flow (requirements-bridge.md §5.2):
 * 1. Look up handler by tool name in extension registry
 * 2. If not found → send error result
 * 3. If requiresConfirmation → show dialog, reject if user cancels
 * 4. Start timeout timer
 * 5. Call handler(args)
 * 6. On success → send success result
 * 7. On error → send error result
 * 8. On timeout → send timeout error
 *
 * Cancel flow:
 * 1. Look up in-flight invocation by ID
 * 2. If not found or completed → send late cancellation
 * 3. If found and running → mark cancelled, dismiss confirmation, send cancelled
 */
export class CommandRouter {
  private inflight = new Map<string, InFlightInvocation>();
  private sendResultFn: SendResultFn | null = null;
  private sendCancelledFn: SendCancelledFn | null = null;
  private confirmationFn: ConfirmationDialogFn | null = null;

  constructor(private registry: ExtensionRegistry) {}

  /**
   * Set the function used to send result messages to Hub.
   */
  setSendResultFn(fn: SendResultFn): void {
    this.sendResultFn = fn;
  }

  /**
   * Set the function used to send cancelled acknowledgements.
   */
  setSendCancelledFn(fn: SendCancelledFn): void {
    this.sendCancelledFn = fn;
  }

  /**
   * Set the confirmation dialog function.
   * In real Bridge this is vscode.window.showWarningMessage.
   */
  setConfirmationFn(fn: ConfirmationDialogFn): void {
    this.confirmationFn = fn;
  }

  /**
   * Handle an invoke message from Hub.
   * Routes to the correct handler, enforces timeout, handles confirmation.
   *
   * @param message - The invoke message from Hub
   */
  async handleInvoke(message: InvokeMessage): Promise<void> {
    // Step 1: Look up handler and tool definition
    const handler = this.registry.getHandler(message.tool);
    const toolDef = this.registry.getTool(message.tool);

    if (!handler || !toolDef) {
      this.sendResultFn?.({
        type: "result",
        id: message.id,
        success: false,
        error: `Unknown tool: ${message.tool}`,
      });
      return;
    }

    // Step 2+3: Confirmation dialog
    if (toolDef.requiresConfirmation && this.confirmationFn) {
      const confirmed = await this.confirmationFn(message.tool, message.args);
      if (!confirmed) {
        this.sendResultFn?.({
          type: "result",
          id: message.id,
          success: false,
          error: "User rejected",
        });
        return;
      }
    }

    // Step 4: Track in-flight
    const invocation: InFlightInvocation = {
      id: message.id,
      tool: message.tool,
      startedAt: Date.now(),
      timeoutTimer: null,
      cancelled: false,
      completed: false,
    };
    this.inflight.set(message.id, invocation);

    // Steps 5-9: Timeout + handler race
    await new Promise<void>((resolve) => {
      // Timeout timer
      invocation.timeoutTimer = setTimeout(() => {
        invocation.timeoutTimer = null;
        if (!invocation.completed && !invocation.cancelled) {
          invocation.completed = true;
          this.inflight.delete(message.id);
          this.sendResultFn?.({
            type: "result",
            id: message.id,
            success: false,
            error: `Tool invocation timed out: ${message.tool}`,
          });
        }
        resolve();
      }, message.timeout);

      // Handler execution
      Promise.resolve(handler(message.args))
        .then((data) => {
          if (invocation.timeoutTimer !== null) {
            clearTimeout(invocation.timeoutTimer);
            invocation.timeoutTimer = null;
          }
          if (!invocation.completed && !invocation.cancelled) {
            invocation.completed = true;
            this.inflight.delete(message.id);
            this.sendResultFn?.({
              type: "result",
              id: message.id,
              success: true,
              data: data as Record<string, unknown>,
            });
          }
          resolve();
        })
        .catch((err: unknown) => {
          if (invocation.timeoutTimer !== null) {
            clearTimeout(invocation.timeoutTimer);
            invocation.timeoutTimer = null;
          }
          if (!invocation.completed && !invocation.cancelled) {
            invocation.completed = true;
            this.inflight.delete(message.id);
            this.sendResultFn?.({
              type: "result",
              id: message.id,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          resolve();
        });
    });
  }

  /**
   * Handle a cancel message from Hub.
   * Cancels in-flight invocation if still running.
   *
   * @param message - The cancel message from Hub
   */
  handleCancel(message: CancelMessage): void {
    const inv = this.inflight.get(message.id);

    if (!inv || inv.completed || inv.cancelled) {
      // Not found or already done → late cancel
      this.sendCancelledFn?.(message.id, true);
      return;
    }

    // In-flight cancel
    if (inv.timeoutTimer !== null) {
      clearTimeout(inv.timeoutTimer);
      inv.timeoutTimer = null;
    }
    inv.cancelled = true;
    this.inflight.delete(message.id);
    this.sendCancelledFn?.(message.id, false);
  }

  /**
   * Get the number of currently in-flight invocations.
   */
  getInflightCount(): number {
    return this.inflight.size;
  }

  /**
   * Get an in-flight invocation by ID (for testing).
   */
  getInflight(id: string): InFlightInvocation | undefined {
    return this.inflight.get(id);
  }

  /**
   * Cancel all in-flight invocations. Used during shutdown.
   */
  cancelAll(): void {
    for (const [, inv] of this.inflight) {
      if (inv.timeoutTimer) clearTimeout(inv.timeoutTimer);
      inv.cancelled = true;
    }
    this.inflight.clear();
  }
}
