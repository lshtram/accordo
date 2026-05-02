/**
 * browser-comment-sync-store.ts
 *
 * Phase C implementation for browser-extension canonical v2 sync store.
 *
 * Canonical store key: "accordo:browser-comments-sync:v2"
 *
 * This module manages the full-state browser comment sync document that is
 * the single source of truth for browser-visible comment state. All active
 * reads go through this store (NOT legacy comments:{url} keys).
 *
 * Storage injection seam: tests can call configureBrowserCommentSyncStorage(storage)
 * to replace the internal storage adapter.
 */

export const CANONICAL_BROWSER_COMMENT_SYNC_KEY = "accordo:browser-comments-sync:v2";

// ── Types ────────────────────────────────────────────────────────────────────────────

export interface SyncMeta {
  lastSentBrowserRevision: number;
  lastAckedBrowserRevision: number;
  lastPersistedAccordoRevision: number;
  nextBrowserRevision: number;
}

export interface ChromeBrowserCommentSyncDocument {
  meta: SyncMeta;
  pages: BrowserCommentSyncPage[];
}

export interface BrowserCommentSyncPage {
  pageUrl: string;
  threads: BrowserCommentSyncThread[];
}

export interface BrowserCommentSyncThread {
  id: string;
  anchorKey: string;
  pageUrl: string;
  status: "open" | "resolved";
  deletedAt?: string;
  comments: BrowserCommentSyncComment[];
  createdAt: string;
  lastActivity: string;
}

export interface BrowserCommentSyncComment {
  id: string;
  threadId: string;
  createdAt: string;
  author: { kind: "user" | "agent"; name: string };
  body: string;
  anchorKey: string;
  status: "open" | "resolved";
  deletedAt?: string;
}

/**
 * Storage adapter interface — allows injection of fake storage in tests.
 * Default implementation: in-memory module variable.
 * Real implementation: chrome.storage.local backed adapter.
 */
export interface BrowserCommentSyncStorage {
  loadDocument(): ChromeBrowserCommentSyncDocument;
  saveDocument(doc: ChromeBrowserCommentSyncDocument): void;
}

// ── Default in-memory storage ─────────────────────────────────────────────────

function createEmptyDocument(): ChromeBrowserCommentSyncDocument {
  return {
    meta: {
      lastSentBrowserRevision: 0,
      lastAckedBrowserRevision: 0,
      lastPersistedAccordoRevision: 0,
      nextBrowserRevision: 1,
    },
    pages: [],
  };
}

/** Module-level document store — used by the default storage adapter */
let _document: ChromeBrowserCommentSyncDocument = createEmptyDocument();

/** Default in-memory adapter — actually persists to module-level _document */
let _storage: BrowserCommentSyncStorage = {
  loadDocument: () => _document,
  saveDocument: (doc: ChromeBrowserCommentSyncDocument) => {
    _document = doc;
  },
};

/**
 * Injection seam for tests. Call with a fakeStorage to observe reads/writes.
 */
export function configureBrowserCommentSyncStorage(storage: BrowserCommentSyncStorage): void {
  _storage = storage;
}

/**
 * Expose stored meta for test observation.
 */
export function getStoredMeta(): SyncMeta {
  return { ..._storage.loadDocument().meta };
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Apply a merged response from Accordo (emittedBy: "vscode-accordo").
 *
 * Updates meta tracking fields from the response values:
 *   - lastSentBrowserRevision = response.browserRevision
 *   - lastAckedBrowserRevision = response.browserRevision
 *   - lastPersistedAccordoRevision = response.accordoRevision
 *   - nextBrowserRevision = max(existing, response.browserRevision + 1)
 *
 * Does NOT persist the full state document — only updates meta.
 * The canonical state is persisted via persistMergedBrowserCommentSyncState.
 */
export async function applyMergedBrowserCommentSyncState(response: {
  schemaVersion: string;
  browserRevision: number;
  accordoRevision: number;
  emittedBy: string;
  generatedAt: string;
  pages: ChromeBrowserCommentSyncDocument["pages"];
}): Promise<void> {
  const doc = _storage.loadDocument();
  const updatedMeta: SyncMeta = {
    lastSentBrowserRevision: response.browserRevision,
    lastAckedBrowserRevision: response.browserRevision,
    lastPersistedAccordoRevision: response.accordoRevision,
    nextBrowserRevision: Math.max(doc.meta.nextBrowserRevision, response.browserRevision + 1),
  };
  _storage.saveDocument({
    ...doc,
    meta: updatedMeta,
    // Pages come from the Accordo response — use those
    pages: response.pages as ChromeBrowserCommentSyncDocument["pages"],
  });
}

/**
 * Persist the full browser state to canonical Chrome storage.
 * Updates meta.lastSentBrowserRevision = state.browserRevision
 *        meta.lastPersistedAccordoRevision = state.accordoRevision
 *
 * Called by the runner after receiving Accordo's merged response.
 */
export async function persistMergedBrowserCommentSyncState(state: {
  schemaVersion: string;
  browserRevision: number;
  accordoRevision: number;
  emittedBy: string;
  generatedAt: string;
  pages: ChromeBrowserCommentSyncDocument["pages"];
}): Promise<void> {
  const doc = _storage.loadDocument();
  const updatedMeta: SyncMeta = {
    ...doc.meta,
    lastSentBrowserRevision: state.browserRevision,
    lastPersistedAccordoRevision: state.accordoRevision,
    nextBrowserRevision: Math.max(doc.meta.nextBrowserRevision, state.browserRevision + 1),
  };
  _storage.saveDocument({
    ...doc,
    meta: updatedMeta,
    pages: state.pages as ChromeBrowserCommentSyncDocument["pages"],
  });
}

/**
 * Load the stored canonical document (meta + full-state snapshot).
 */
export function loadBrowserCommentSyncDocument(): ChromeBrowserCommentSyncDocument {
  return _storage.loadDocument();
}

/**
 * Read active (non-tombstoned) threads for a page from canonical v2 store.
 * Does NOT read legacy comments:{url} keys.
 * Tombstoned threads and comments are filtered out.
 */
export async function getActiveBrowserThreadsForPage(
  pageUrl: string,
): Promise<Array<{
  id: string;
  anchorKey: string;
  pageUrl: string;
  status: string;
  deletedAt?: string;
  comments: Array<{
    id: string;
    threadId: string;
    createdAt: string;
    author: { kind: "user" | "agent"; name: string };
    body: string;
    anchorKey: string;
    status: string;
    deletedAt?: string;
  }>;
  createdAt: string;
  lastActivity: string;
}>> {
  const doc = _storage.loadDocument();
  const page = doc.pages.find((p) => p.pageUrl === pageUrl);
  if (!page) return [];
  return page.threads
    .filter((t) => !t.deletedAt)
    .map((t) => ({
      ...t,
      comments: t.comments.filter((c) => !c.deletedAt),
    }));
}
