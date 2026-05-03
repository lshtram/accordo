import type { CommentIntent, CommentStatus, SurfaceType } from "@accordo/bridge-types";
import type { GroupMode } from "./panel-filters.js";

/** M45-WVC-01, M45-WVC-08: bounded host error vocabulary. */
export type CommentsPanelErrorCode =
  | "unknown-message"
  | "invalid-payload"
  | "invalid-command-scope"
  | "missing-thread-id"
  | "thread-not-found"
  | "command-failed";

/** M45-WVC-09: interaction source used for keyboard/mouse parity assertions. */
export type CommentsPanelInteractionSource = "mouse" | "keyboard" | "programmatic";

/** M45-WVC-02: command scope is explicit in the contract. */
export type CommentsPanelGlobalCommandId =
  | "accordo.commentsPanel.refresh"
  | "accordo.commentsPanel.filterByStatus"
  | "accordo.commentsPanel.filterByIntent"
  | "accordo.commentsPanel.clearFilters"
  | "accordo.commentsPanel.groupBy"
  | "accordo.commentsPanel.deleteAllBrowserComments";

/** M45-WVC-02: thread-scoped commands always require a thread id. */
export type CommentsPanelThreadCommandId =
  | "accordo.commentsPanel.navigateToAnchor"
  | "accordo.commentsPanel.resolve"
  | "accordo.commentsPanel.reopen"
  | "accordo.commentsPanel.reply"
  | "accordo.commentsPanel.delete";

/** M45-WVC-10: direct filter-control messages from webview (no command wiring needed). */
export type CommentsPanelFilterMessage =
  | { readonly type: "panel:set-status-filter"; readonly status: "open" | "resolved" | undefined; readonly source: CommentsPanelInteractionSource }
  | { readonly type: "panel:set-group-mode"; readonly groupMode: GroupMode; readonly source: CommentsPanelInteractionSource }
  | { readonly type: "panel:set-author-filter"; readonly authorKind: "user" | "agent" | undefined; readonly source: CommentsPanelInteractionSource }
  | { readonly type: "panel:clear-filters"; readonly source: CommentsPanelInteractionSource }
  | { readonly type: "panel:submit-reply"; readonly threadId: string; readonly body: string; readonly source: CommentsPanelInteractionSource };

export interface CommentsPanelViewModel {
  readonly generatedAt: string;
  readonly filtersSummary: string;
  readonly groupMode: GroupMode;
  readonly groups: readonly CommentsPanelGroupViewModel[];
  readonly totalThreadCount: number;
  readonly openThreadCount: number;
  readonly resolvedThreadCount: number;
}

export interface CommentsPanelGroupViewModel {
  readonly groupId: string;
  readonly kind: "file" | "status" | "activity";
  readonly label: string;
  readonly count: number;
  readonly expanded: boolean;
  readonly threads: readonly CommentsPanelThreadViewModel[];
}

export interface CommentsPanelThreadViewModel {
  readonly threadId: string;
  readonly uri: string;
  readonly title: string;
  readonly subtitle: string;
  readonly preview: string;
  readonly status: CommentStatus;
  readonly intent?: CommentIntent;
  readonly surfaceType?: SurfaceType;
  readonly stale: boolean;
  readonly replyCount: number;
  readonly expanded: boolean;
  readonly comments: readonly CommentsPanelCommentViewModel[];
}

export interface CommentsPanelCommentViewModel {
  readonly commentId: string;
  readonly authorName: string;
  readonly authorKind: "user" | "agent";
  readonly body: string;
  readonly createdAt: string;
  readonly intent?: CommentIntent;
}

/** M45-WV-06: ephemeral UI state lives in the provider, not in the store. */
export interface CommentsPanelUiState {
  readonly expandedThreadIds: ReadonlySet<string>;
  readonly collapsedGroupIds: ReadonlySet<string>;
}

export type CommentsPanelHostMessage =
  | { readonly type: "panel:state"; readonly model: CommentsPanelViewModel }
  | {
      readonly type: "panel:error";
      readonly code: CommentsPanelErrorCode;
      readonly message: string;
      readonly recoverable: boolean;
    };

/** M45-WVC-01..06: explicit webview→host actions. */
export type CommentsPanelWebviewMessage =
  | { readonly type: "panel:ready"; readonly apiVersion: "1" }
  | {
      readonly type: "panel:toggle-group";
      readonly groupId: string;
      readonly source: CommentsPanelInteractionSource;
    }
  | {
      readonly type: "panel:toggle-thread";
      readonly threadId: string;
      readonly source: CommentsPanelInteractionSource;
    }
  | {
      readonly type: "panel:invoke-global-command";
      readonly commandId: CommentsPanelGlobalCommandId;
      readonly source: CommentsPanelInteractionSource;
    }
  | {
      readonly type: "panel:invoke-thread-command";
      readonly commandId: CommentsPanelThreadCommandId;
      readonly threadId: string;
      readonly source: CommentsPanelInteractionSource;
    }
  | CommentsPanelFilterMessage;
