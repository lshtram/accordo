/**
 * sw-lifecycle.ts — Service worker lifecycle management
 *
 * Handles:
 * - chrome.runtime.onMessage listener registration
 * - chrome.runtime.onInstalled initialization
 * - chrome.webNavigation.onCommitted navigation reset
 * - chrome.commands.onCommand keyboard shortcut handling
 * - Periodic full-sync with VS Code's comment store
 * - Broadcast of COMMENTS_UPDATED to tabs
 * - Relay bridge forwarding helper
 */

import { toggleCommentsMode, getCommentsMode, loadCommentsModeFromStorage } from "./state-machine.js";
import { normalizeUrl } from "./store.js";
import { handleRelayAction, type RelayActionRequest, type RelayActionResponse } from "./relay-actions.js";
import { RelayBridgeClient } from "./relay-bridge.js";
import { RelayTransport, type RelayTransportEvents, type TransportState } from "./relay-transport.js";
import { DEFAULT_RELAY_CONFIG, getRelayConfig } from "./relay-config.js";
import { MESSAGE_TYPES } from "./constants.js";
import { handleNavigationReset } from "./relay-actions.js";
import type { SwMessage, SwResponse } from "./sw-router.js";
import { setRelayClient } from "./relay-comment-handlers.js";

const RELAY_TOKEN_STORAGE_KEY = "relayToken";

/**
 * Create a RelayTransport configured with a tokenProvider that reads
 * from chrome.storage.local. This enables the transport to use the
 * latest token on every reconnect.
 */
function createTransport(): RelayTransport {
  const transportEvents: RelayTransportEvents = {
    onMessage: (data: string) => {
      // Message handling is done by RelayBridgeClient through its own handler
      void data;
    },
    onStateChange: (state: TransportState) => {
      void state;
    },
    onError: (error: string) => {
      void error;
    },
  };

  const config = {
    ...DEFAULT_RELAY_CONFIG,
    tokenProvider: async (): Promise<string | undefined> => {
      try {
        const result = await chrome.storage.local.get([RELAY_TOKEN_STORAGE_KEY]);
        return result[RELAY_TOKEN_STORAGE_KEY] as string | undefined;
      } catch {
        return undefined;
      }
    },
  };

  return new RelayTransport(config, transportEvents);
}

// ── Broadcast helper ────────────────────────────────────────────────────────

function isNoReceiverError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? String(err);
  return msg.includes("Receiving end does not exist") || msg.includes("Could not establish connection");
}

export async function broadcastCommentsUpdated(url?: string): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const normalized = url ? normalizeUrl(url) : undefined;
  // Type predicate narrows tab.id to number (not undefined) for the map callback.
  const httpTabs = tabs.filter((tab): tab is chrome.tabs.Tab & { id: number } => {
    if (!tab.id || !tab.url) return false;
    if (!tab.url.startsWith("http://") && !tab.url.startsWith("https://")) return false;
    if (normalized && normalizeUrl(tab.url) !== normalized) return false;
    return true;
  });
  await Promise.all(
    httpTabs.map(async (tab) => {
      try {
        chrome.tabs.sendMessage(tab.id, {
            type: MESSAGE_TYPES.COMMENTS_UPDATED,
            payload: { url: normalized },
          }).catch(() => {/* tab may not have listener */});
        } catch {
          // ignore send errors
        }
      }),
  );

  try {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.COMMENTS_UPDATED, payload: { url: normalized } });
  } catch {
    // Popup/content runtime listeners may not exist; safe to ignore.
  }
}

// ── Relay action with broadcast ─────────────────────────────────────────────

export async function handleRelayActionWithBroadcast(req: RelayActionRequest): Promise<RelayActionResponse> {
  const response = await handleRelayAction(req);
  if (
    response.success
    && ["create_comment", "reply_comment", "delete_comment", "delete_thread", "resolve_thread", "reopen_thread", "notify_comments_updated"].includes(req.action)
  ) {
    const pageUrl = (response.data as { pageUrl?: string; url?: string } | undefined)?.pageUrl
      ?? (response.data as { pageUrl?: string; url?: string } | undefined)?.url;
    await broadcastCommentsUpdated(pageUrl);
  }
  return response;
}

// ── Relay bridge instance ───────────────────────────────────────────────────
// Created early so forwardToAccordoBrowser can reference it.
// Started in bootstrap (service-worker.ts) after registerListeners().
const relayTransport = createTransport();
export const relayBridge = new RelayBridgeClient(handleRelayActionWithBroadcast, relayTransport);
// P-5: Wire relay client into the adapter factory so handlers can use selectAdapter()
setRelayClient(relayBridge);

// Wire transport inbound messages to the bridge's pending-request handler.
// The transport is created before relayBridge, so we wire the callback here
// after both are available. This enables response routing in transport mode.
relayTransport.events.onMessage = (data: string): void => {
  relayBridge.handleTransportMessage(data);
};

// ── Forwarder to accordo-browser ────────────────────────────────────────────
/**
 * Forward a mutation action to accordo-browser through the WebSocket relay.
 * accordo-browser will call the unified comment_* tools to persist the action
 * to VS Code's CommentStore, which updates the Comments Panel.
 *
 * This is fire-and-forget for the Chrome popup — the local chrome.storage.local
 * write is the primary store for popup rendering. If accordo-browser is
 * unreachable, the popup still works (offline-first).
 */
export async function forwardToAccordoBrowser(
  action: "create_comment" | "reply_comment" | "resolve_thread" | "reopen_thread" | "delete_comment" | "delete_thread",
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await relayBridge.send(action, payload, 5000);
    if (!result.success) {
    }
  } catch {
    // Non-fatal — Chrome local storage is primary; accordo-browser is secondary sync.
  }
}

// ── Event listeners ─────────────────────────────────────────────────────────

export function registerListeners(
  handleMessage: (message: SwMessage, sender: chrome.runtime.MessageSender) => Promise<SwResponse>,
): void {
  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      handleMessage(message as SwMessage, sender).then((resp) => {
        sendResponse(resp);
      }).catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
      return true; // keep channel open for async response
    },
  );

  chrome.webNavigation.onCommitted.addListener((details) => {
    // B2-SV-005: Reset snapshot version counter on top-level frame navigations.
    // The content script's SnapshotStore is inherently reset because Chrome
    // destroys and re-injects the content script on navigation. The service
    // worker's local counter must also be reset to stay in sync.
    if (details.frameId === 0) {
      handleNavigationReset();
    }
  });

  chrome.commands.onCommand.addListener((command: string): void => {
    if (command === "toggle-comments-mode") {
      void (async (): Promise<void> => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          return;
        }
        const tabId = tab.id;
        await toggleCommentsMode(tabId);
        const isOn = getCommentsMode(tabId);
        void chrome.action.setBadgeText({ text: isOn ? "ON" : "", tabId });
        void chrome.action.setBadgeBackgroundColor({ color: isOn ? "#4a90d9" : "#888", tabId });
        const msgType = isOn ? "comments-mode-on" : "comments-mode-off";
        try {
          await chrome.tabs.sendMessage(tabId, { type: msgType });
        } catch (err) {
          if (!isNoReceiverError(err)) {
          }
        }
      })();
    }
  });
}

export async function onInstalled(
  _details: chrome.runtime.InstalledDetails,
): Promise<void> {
  await chrome.storage.local.set({
    settings: { commentsMode: false, userName: "Guest" },
  });
}

// ── Periodic full-sync ──────────────────────────────────────────────────────
/**
 * Poll VS Code's comment store version every 30 seconds.
 * If the version changed since last sync, refresh all tab threads via GET_THREADS.
 * This reconciles drift that can occur when notify_comments_updated is missed
 * (e.g. extension was unloaded or WS was temporarily disconnected).
 */
const SYNC_INTERVAL_MS = 30_000;
const SYNC_STORAGE_KEY = "commentsSyncState";

interface SyncState {
  version: number;
  lastSyncedAt: string;
}

async function getStoredSyncState(): Promise<SyncState> {
  const result = await chrome.storage.local.get(SYNC_STORAGE_KEY);
  const stored = result[SYNC_STORAGE_KEY] as SyncState | undefined;
  return stored ?? { version: -1, lastSyncedAt: new Date(0).toISOString() };
}

async function setStoredSyncState(state: SyncState): Promise<void> {
  await chrome.storage.local.set({ [SYNC_STORAGE_KEY]: state });
}

export async function checkAndSync(): Promise<void> {
  try {
    // P1-3: Rehydrate in-memory mode map from storage before checking tabs.
    // After SW restart, the in-memory map is empty; without this, tabs with
    // Comments Mode ON would be silently skipped.
    await loadCommentsModeFromStorage();

    const result = await relayBridge.send("get_comments_version", {}, 5000);
    if (!result.success || typeof result.data !== "object") return;

    const { version } = result.data as { version: number };
    const prev = await getStoredSyncState();
    if (version !== prev.version) {
      await setStoredSyncState({ version, lastSyncedAt: new Date().toISOString() });
      // Refresh all tabs that have Comments Mode on
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (!tab.id || !tab.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) continue;
        const isOn = getCommentsMode(tab.id);
        if (!isOn) continue;
        try {
          await chrome.tabs.sendMessage(tab.id, { type: "COMMENTS_UPDATED", payload: { url: tab.url } });
        } catch {
          // Tab may not have content script injected — non-fatal
        }
      }
    }
  } catch {
    // Non-fatal — periodic sync errors are logged but don't crash the worker
  }
}

let _syncIntervalId: ReturnType<typeof setInterval> | null = null;

export function startPeriodicSync(): void {
  if (_syncIntervalId) return;
  // Run an immediate sync on start
  void checkAndSync();
  _syncIntervalId = setInterval(() => { void checkAndSync(); }, SYNC_INTERVAL_MS);
}

export function stopPeriodicSync(): void {
  if (_syncIntervalId) {
    clearInterval(_syncIntervalId);
    _syncIntervalId = null;
  }
}
