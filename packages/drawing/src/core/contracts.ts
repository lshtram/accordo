import type { SdkThread } from "@accordo/comment-sdk";
import type { SceneElement } from "./types.js";

export const PLACEMENT_GRID_PX = 40;
export const PLACEMENT_MAIN_GAP_PX = 160;
export const PLACEMENT_CROSS_GAP_PX = 120;
export const PLACEMENT_COMPONENT_GAP_PX = 240;
export const PLACEMENT_COLLISION_MARGIN_PX = 24;
export const PLACEMENT_SEARCH_MAX_STEPS = 24;

export interface DrawingPair {
  mmdPath: string;
  excalidrawPath: string;
}

export type SourceOfTruth = "mmd" | "excalidraw";

export interface MergePlan {
  preserved: SceneElement[];
  updated: SceneElement[];
  added: SceneElement[];
  removed: SceneElement[];
  orphaned: SceneElement[];
  unmanaged: SceneElement[];
  placementEngine: "accordo" | "bootstrap";
  counts: {
    preserved: number;
    added: number;
    updated: number;
    removed: number;
    orphaned: number;
  };
}

export interface MergeReport {
  merged: true;
  path: string;
  scenePath: string;
  placementEngine: "accordo" | "bootstrap";
  counts: MergePlan["counts"];
}

export interface CreateReport {
  created: true;
  path: string;
  scenePath: string;
  bootstrapEngine: "mermaid-to-excalidraw" | "empty";
  opened: boolean;
}

export interface QueryReport {
  path: string;
  scenePath: string;
  sourceType: "flowchart" | "unsupported" | "invalid";
  status: "in-sync" | "needs-merge" | "source-invalid" | "scene-invalid";
  counts: {
    managed: number;
    unmanaged: number;
    orphaned: number;
  };
  orphans?: Array<{
    elementId: string;
    orphanReason: string;
  }>;
}

export interface PatchReport extends MergeReport {
  patched: true;
}

export interface RenderReport {
  rendered: true;
  path: string;
  format: "png" | "svg";
  outputPath: string;
}

export interface DrawingPanelLike {
  mmdPath: string;
  requestExport: (format: "png" | "svg") => Promise<Buffer>;
  /** Comment parity seam: focus one thread inside the live drawing surface. */
  focusCommentThread?: (threadId: string) => Promise<void>;
  /**
   * Comment parity seam: push canonical SDK threads into the live drawing
   * surface after host-side store-thread conversion.
   */
  syncCommentThreads?: (threads: readonly SdkThread[]) => Promise<void>;
}

export interface DrawingToolContext {
  workspaceRoot: string;
  getPanel: (path: string) => DrawingPanelLike | undefined;
  ensurePanelOpen?: (path: string) => Promise<void>;
  hasVisiblePanelTab?: (path: string) => boolean;
}
