/**
 * PanelFilters — Manages active filter state for the custom Comments Panel.
 *
 * Source: requirements-comments-panel.md §3 M45-FLT
 */

import type * as vscode from "vscode";
import type {
  CommentThread,
  CommentAnchorSurface,
  CommentIntent,
  SurfaceType,
} from "@accordo/bridge-types";

export type GroupMode = "by-status" | "by-file" | "by-activity";

export interface CommentPanelFilterState {
  status?: "open" | "resolved";
  intent?: CommentIntent;
  authorKind?: "user" | "agent";
  surfaceType?: SurfaceType;
  staleOnly?: boolean;
  groupMode?: GroupMode;
  searchQuery?: string;
}

export interface StaleChecker {
  isThreadStale(threadId: string): boolean;
}

export const FILTER_PERSISTENCE_KEY = "accordo.commentsPanel.filters";

const VALID_STATUSES = new Set<string>(["open", "resolved"]);
const VALID_INTENTS = new Set<string>(["fix", "explain", "refactor", "review", "design", "question"]);
const VALID_AUTHOR_KINDS = new Set<string>(["user", "agent"]);
const VALID_SURFACE_TYPES = new Set<string>(["diagram", "image", "pdf", "markdown-preview", "slide", "browser"]);
const VALID_GROUP_MODES = new Set<string>(["by-status", "by-file", "by-activity"]);

export class PanelFilters {
  private _state: CommentPanelFilterState;
  private readonly _memento: vscode.Memento;

  constructor(memento: vscode.Memento) {
    this._memento = memento;
    const raw = memento.get<unknown>(FILTER_PERSISTENCE_KEY, {});
    this._state = PanelFilters._validate(raw);
  }

  private static _validate(raw: unknown): CommentPanelFilterState {
    if (typeof raw !== "object" || raw === null) return {};
    const r = raw as Record<string, unknown>;
    return {
      status: VALID_STATUSES.has(r.status as string)
        ? (r.status as "open" | "resolved") : undefined,
      intent: VALID_INTENTS.has(r.intent as string)
        ? (r.intent as CommentIntent) : undefined,
      authorKind: VALID_AUTHOR_KINDS.has(r.authorKind as string)
        ? (r.authorKind as "user" | "agent") : undefined,
      surfaceType: VALID_SURFACE_TYPES.has(r.surfaceType as string)
        ? (r.surfaceType as SurfaceType) : undefined,
      staleOnly: r.staleOnly === true,
      groupMode: VALID_GROUP_MODES.has(r.groupMode as string)
        ? (r.groupMode as GroupMode) : "by-file",
      searchQuery: typeof r.searchQuery === "string" && r.searchQuery.trim().length > 0
        ? r.searchQuery.trim() : undefined,
    };
  }

  private _persist(): void {
    void this._memento.update(FILTER_PERSISTENCE_KEY, this._state);
  }

  apply(threads: readonly CommentThread[], store?: StaleChecker): CommentThread[] {
    return threads.filter(t => {
      if (this._state.status && t.status !== this._state.status) return false;
      if (this._state.intent && t.comments[0]?.intent !== this._state.intent) return false;
      if (this._state.authorKind && t.comments.at(-1)?.author.kind !== this._state.authorKind) return false;
      if (this._state.surfaceType) {
        if (t.anchor.kind !== "surface") return false;
        if ((t.anchor as CommentAnchorSurface).surfaceType !== this._state.surfaceType) return false;
      }
      if (this._state.searchQuery && !matchesSearchQuery(t, this._state.searchQuery)) return false;
      if (this._state.staleOnly && (!store || !store.isThreadStale(t.id ?? ""))) return false;
      return true;
    });
  }

  setStatus(value: "open" | "resolved" | undefined): void {
    this._state = { ...this._state, status: value };
    this._persist();
  }

  setIntent(value: CommentIntent | undefined): void {
    this._state = { ...this._state, intent: value };
    this._persist();
  }

  setAuthorKind(value: "user" | "agent" | undefined): void {
    this._state = { ...this._state, authorKind: value };
    this._persist();
  }

  setSurfaceType(value: SurfaceType | undefined): void {
    this._state = { ...this._state, surfaceType: value };
    this._persist();
  }

  setStaleOnly(value: boolean): void {
    this._state = { ...this._state, staleOnly: value };
    this._persist();
  }

  setSearchQuery(value: string | undefined): void {
    const query = value?.trim();
    this._state = { ...this._state, searchQuery: query ? query : undefined };
    this._persist();
  }

  clear(): void {
    this._state = {
      status: undefined,
      intent: undefined,
      authorKind: undefined,
      surfaceType: undefined,
      staleOnly: false,
      searchQuery: undefined,
      groupMode: this._state.groupMode ?? "by-status",
    };
    this._persist();
  }

  getSummary(): string {
    const parts: string[] = [];
    if (this._state.status) parts.push(this._state.status);
    if (this._state.intent) parts.push(`${this._state.intent} intent`);
    if (this._state.authorKind) parts.push(`last author: ${this._state.authorKind}`);
    if (this._state.surfaceType) parts.push(`surface: ${this._state.surfaceType}`);
    if (this._state.searchQuery) parts.push(`search: ${this._state.searchQuery}`);
    if (this._state.staleOnly) parts.push("stale only");
    return parts.join(", ");
  }

  isActive(): boolean {
    return !!(
      this._state.status ||
      this._state.intent ||
      this._state.authorKind ||
      this._state.surfaceType ||
      this._state.searchQuery ||
      this._state.staleOnly
    );
  }

  get groupMode(): GroupMode {
    return this._state.groupMode ?? "by-file";
  }

  get status(): "open" | "resolved" | undefined {
    return this._state.status;
  }

  get searchQuery(): string {
    return this._state.searchQuery ?? "";
  }

  setGroupMode(value: GroupMode): void {
    this._state = { ...this._state, groupMode: value };
    this._persist();
  }
}

function matchesSearchQuery(thread: CommentThread, query: string): boolean {
  const needle = query.toLocaleLowerCase();
  const fields = [
    thread.id ?? "",
    thread.anchor.uri,
    thread.status,
    thread.anchor.kind,
    thread.anchor.kind === "surface" ? thread.anchor.surfaceType : "",
    ...thread.comments.flatMap((comment) => [
      comment.author.name,
      comment.author.kind,
      comment.body,
      comment.intent ?? "",
      comment.createdAt,
    ]),
  ];
  return fields.some((field) => field.toLocaleLowerCase().includes(needle));
}
