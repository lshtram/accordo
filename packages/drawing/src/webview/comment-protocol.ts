import type { CommentThread } from "@accordo/bridge-types";
import type {
  HostMessage as CommentSdkHostMessage,
  SdkThread,
  WebviewMessage as CommentSdkWebviewMessage,
} from "@accordo/comment-sdk";

/**
 * SSOT owner: @accordo/comment-sdk defines the canonical webview comment protocol.
 * Drawing re-exports those message types and keeps any store-shape conversion on
 * the host side before posting to the webview.
 */
export type DrawingCommentWebviewMessage = CommentSdkWebviewMessage;

export type DrawingCommentHostMessage = CommentSdkHostMessage;

export type { SdkThread };

/**
 * Host-side seam only: raw store-backed threads fetched from packages/comments
 * before conversion to canonical SdkThread[] HostMessage payloads.
 */
export interface DrawingCommentStoreSnapshot {
  readonly uri: string;
  readonly threads: readonly CommentThread[];
}
