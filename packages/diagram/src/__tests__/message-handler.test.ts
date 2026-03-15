/**
 * A16 — Message handler tests (Phase B — all RED until Phase C)
 *
 * Tests cover applyHostMessage() and detectNodeMutations() in
 * webview/message-handler.ts.
 * No VSCode mocks required — message-handler.ts is a pure Node.js module.
 *
 * Source: diag_workplan.md §4.16
 */

// API checklist:
// ✓ applyHostMessage — 6 tests (WF-01..WF-06)
// ✓ detectNodeMutations — 3 tests (WF-07..WF-09)

import { describe, it, expect, vi } from "vitest";
import {
  applyHostMessage,
  detectNodeMutations,
} from "../webview/message-handler.js";
import type {
  ExcalidrawHandle,
  WebviewUI,
  ExcalidrawExportFns,
} from "../webview/message-handler.js";
import type { ExcalidrawAPIElement } from "../webview/scene-adapter.js";
import type { HostToWebviewMessage } from "../webview/protocol.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHandle(): ExcalidrawHandle & {
  updateScene: ReturnType<typeof vi.fn>;
  getSceneElements: ReturnType<typeof vi.fn>;
  getAppState: ReturnType<typeof vi.fn>;
} {
  return {
    updateScene: vi.fn(),
    getSceneElements: vi.fn().mockReturnValue([]),
    getAppState: vi.fn().mockReturnValue({}),
  };
}

function makeUI(): WebviewUI & {
  postMessage: ReturnType<typeof vi.fn>;
  showToast: ReturnType<typeof vi.fn>;
  showErrorOverlay: ReturnType<typeof vi.fn>;
  clearErrorOverlay: ReturnType<typeof vi.fn>;
} {
  return {
    postMessage: vi.fn(),
    showToast: vi.fn(),
    showErrorOverlay: vi.fn(),
    clearErrorOverlay: vi.fn(),
  };
}

function makeExportFns(): ExcalidrawExportFns & {
  exportToSvg: ReturnType<typeof vi.fn>;
  exportToBlob: ReturnType<typeof vi.fn>;
} {
  return {
    exportToSvg: vi.fn().mockResolvedValue("<svg />"),
    exportToBlob: vi.fn().mockResolvedValue("base64png=="),
  };
}

const ELEMENTS: ExcalidrawAPIElement[] = [
  {
    id: "exc-1",
    type: "rectangle",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    roughness: 1,
    fontFamily: 1,
    customData: { mermaidId: "auth" },
  },
];

// ── applyHostMessage ──────────────────────────────────────────────────────────

describe("applyHostMessage", () => {
  it("WF-01: host:load-scene calls api.updateScene with elements and appState", () => {
    const api = makeHandle();
    const ui = makeUI();
    const exportFns = makeExportFns();
    const msg = {
      type: "host:load-scene",
      elements: ELEMENTS,
      appState: { zoom: { value: 1 } },
    } as unknown as HostToWebviewMessage;

    applyHostMessage(msg, api, ui, exportFns);

    expect(api.updateScene).toHaveBeenCalledWith({
      elements: ELEMENTS,
      appState: { zoom: { value: 1 } },
    });
  });

  it("WF-02: host:load-scene calls ui.clearErrorOverlay()", () => {
    const api = makeHandle();
    const ui = makeUI();
    const exportFns = makeExportFns();
    const msg = {
      type: "host:load-scene",
      elements: [],
      appState: {},
    } as unknown as HostToWebviewMessage;

    applyHostMessage(msg, api, ui, exportFns);

    expect(ui.clearErrorOverlay).toHaveBeenCalledOnce();
  });

  it("WF-03: host:request-export svg → calls exportToSvg and posts canvas:export-ready", async () => {
    const api = makeHandle();
    const ui = makeUI();
    const exportFns = makeExportFns();
    const msg = {
      type: "host:request-export",
      format: "svg",
    } as HostToWebviewMessage;

    await applyHostMessage(msg, api, ui, exportFns);

    expect(exportFns.exportToSvg).toHaveBeenCalled();
    expect(ui.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "canvas:export-ready",
        format: "svg",
        data: "<svg />",
      }),
    );
  });

  it("WF-04: host:request-export png → calls exportToBlob and posts canvas:export-ready", async () => {
    const api = makeHandle();
    const ui = makeUI();
    const exportFns = makeExportFns();
    const msg = {
      type: "host:request-export",
      format: "png",
    } as HostToWebviewMessage;

    await applyHostMessage(msg, api, ui, exportFns);

    expect(exportFns.exportToBlob).toHaveBeenCalled();
    expect(ui.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "canvas:export-ready",
        format: "png",
        data: "base64png==",
      }),
    );
  });

  it("WF-05: host:toast calls ui.showToast(message)", () => {
    const api = makeHandle();
    const ui = makeUI();
    const exportFns = makeExportFns();
    const msg = {
      type: "host:toast",
      message: "Updated by agent",
    } as HostToWebviewMessage;

    applyHostMessage(msg, api, ui, exportFns);

    expect(ui.showToast).toHaveBeenCalledWith("Updated by agent");
  });

  it("WF-06: host:error-overlay calls ui.showErrorOverlay(message)", () => {
    const api = makeHandle();
    const ui = makeUI();
    const exportFns = makeExportFns();
    const msg = {
      type: "host:error-overlay",
      message: "Unexpected identifier at line 3",
    } as HostToWebviewMessage;

    applyHostMessage(msg, api, ui, exportFns);

    expect(ui.showErrorOverlay).toHaveBeenCalledWith(
      "Unexpected identifier at line 3",
    );
  });
});

// ── detectNodeMutations ───────────────────────────────────────────────────────

describe("detectNodeMutations", () => {
  const BASE_EL: ExcalidrawAPIElement = {
    id: "exc-1",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    roughness: 1,
    fontFamily: 1,
    customData: { mermaidId: "auth" },
  };

  it("WF-07: x/y changed → { type:'moved', nodeId, x, y }", () => {
    const prev = [BASE_EL];
    const next = [{ ...BASE_EL, x: 200, y: 300 }];

    expect(detectNodeMutations(prev, next)).toEqual([
      { type: "moved", nodeId: "auth", x: 200, y: 300 },
    ]);
  });

  it("WF-08: width/height changed → { type:'resized', nodeId, w, h }", () => {
    const prev = [BASE_EL];
    const next = [{ ...BASE_EL, width: 200, height: 80 }];

    expect(detectNodeMutations(prev, next)).toEqual([
      { type: "resized", nodeId: "auth", w: 200, h: 80 },
    ]);
  });

  it("WF-09: element with empty customData.mermaidId is skipped", () => {
    const bgEl: ExcalidrawAPIElement = {
      ...BASE_EL,
      id: "cluster-bg",
      customData: { mermaidId: "" },
    };
    const prev = [bgEl];
    const next = [{ ...bgEl, x: 999, y: 999 }];

    expect(detectNodeMutations(prev, next)).toEqual([]);
  });
});
