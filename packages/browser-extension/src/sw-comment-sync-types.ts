import type { BrowserComment, BrowserCommentThread } from "./types.js";

export interface HubComment {
  id: string;
  threadId: string;
  createdAt: string;
  author: { kind: "user" | "agent"; name: string; agentId?: string };
  body: string;
  intent?: string;
  status: "open" | "resolved";
  resolutionNote?: string;
  context?: {
    surfaceMetadata?: Record<string, string>;
  };
}

export interface HubCommentThread {
  id: string;
  anchor: {
    kind: "text" | "surface" | "file" | "browser";
    uri: string;
    range?: { startLine: number; startChar: number; endLine: number; endChar: number };
    surfaceType?: string;
    coordinates?:
      | { type: "normalized"; x: number; y: number }
      | { type: "block"; blockId?: string; blockType?: string };
  };
  status: "open" | "resolved";
  commentCount: number;
  lastActivity: string;
  lastAuthor: string;
  firstComment: HubComment;
  comments: HubComment[];
  retention?: string;
  createdAt: string;
}

export type { BrowserComment, BrowserCommentThread };
