import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { AccordoCommentSDK } from "@accordo/comment-sdk";
import { HANDWRITING_FONT_FAMILY } from "../core/excalidraw-fonts.js";
import { DrawingCommentOverlayController } from "./comment-overlay-controller.js";
import { exportScene } from "./export-scene.js";
import { sameViewport, viewportFromAppState, type ExcalidrawViewportState } from "./viewport.js";
import {
  clearBoot,
  ensureExcalidrawFontsLoaded,
  initialViewport,
  readInitialScene,
  restoreInitialElements,
  setBoot,
  withFontReadyVisibility,
} from "./bootstrap.js";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

const vscode = acquireVsCodeApi();

function DrawingApp({ restored, generatedFromMermaid }: { restored: readonly ExcalidrawElement[]; generatedFromMermaid: boolean }) {
  const { initialData, handleApi, handleChange, handlePointerDown } = useDrawingAppController(restored, generatedFromMermaid);

  return React.createElement(Excalidraw, {
    initialData,
    onPointerDown: handlePointerDown,
    excalidrawAPI: handleApi,
    onChange: handleChange,
  });
}

function useDrawingAppController(restored: readonly ExcalidrawElement[], generatedFromMermaid: boolean): {
  initialData: ExcalidrawInitialDataState;
  handleApi: (api: ExcalidrawImperativeAPI) => void;
  handleChange: (elements: readonly ExcalidrawElement[], appState?: Record<string, unknown>) => void;
  handlePointerDown: () => void;
} {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const overlayRef = useRef<DrawingCommentOverlayController | null>(null);
  const isReadyRef = useRef(false);
  const lastJsonRef = useRef<string>("");
  const lastViewportRef = useRef<ExcalidrawViewportState | null>(null);
  const updateTimerRef = useRef<number | null>(null);
  const restoredRef = useRef<readonly ExcalidrawElement[]>(restored);
  const initialData = useInitialData(restoredRef, lastJsonRef);
  const handleApi = useHandleApi(apiRef, overlayRef, restoredRef, generatedFromMermaid, isReadyRef, lastJsonRef, lastViewportRef);
  const handleChange = useHandleChange(apiRef, overlayRef, isReadyRef, lastJsonRef, lastViewportRef, updateTimerRef);
  const handlePointerDown = useHandwritingPointerDown(apiRef);
  useHostMessageLifecycle(apiRef, overlayRef);
  return { initialData, handleApi, handleChange, handlePointerDown };
}

function useInitialData(
  restoredRef: React.MutableRefObject<readonly ExcalidrawElement[]>,
  lastJsonRef: React.MutableRefObject<string>,
): ExcalidrawInitialDataState {
  return useMemo<ExcalidrawInitialDataState>(() => {
    const restored = restoredRef.current;
    lastJsonRef.current = JSON.stringify(restored);
    return {
      elements: restored,
      appState: initialViewport(restored),
      scrollToContent: true,
    };
  }, []);
}

function useHandleApi(
  apiRef: React.MutableRefObject<ExcalidrawImperativeAPI | null>,
  overlayRef: React.MutableRefObject<DrawingCommentOverlayController | null>,
  restoredRef: React.MutableRefObject<readonly ExcalidrawElement[]>,
  generatedFromMermaid: boolean,
  isReadyRef: React.MutableRefObject<boolean>,
  lastJsonRef: React.MutableRefObject<string>,
  lastViewportRef: React.MutableRefObject<ExcalidrawViewportState | null>,
): (api: ExcalidrawImperativeAPI) => void {
  return useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    initOverlay(api, overlayRef);
    reportSceneReady(api, restoredRef.current, generatedFromMermaid, isReadyRef, lastJsonRef, lastViewportRef);
  }, [generatedFromMermaid]);
}

function useHandleChange(
  apiRef: React.MutableRefObject<ExcalidrawImperativeAPI | null>,
  overlayRef: React.MutableRefObject<DrawingCommentOverlayController | null>,
  isReadyRef: React.MutableRefObject<boolean>,
  lastJsonRef: React.MutableRefObject<string>,
  lastViewportRef: React.MutableRefObject<ExcalidrawViewportState | null>,
  updateTimerRef: React.MutableRefObject<number | null>,
): (elements: readonly ExcalidrawElement[], appState?: Record<string, unknown>) => void {
  return useCallback((elements: readonly ExcalidrawElement[], appState?: Record<string, unknown>) => {
    handleSceneChange(elements, appState, {
      isReadyRef,
      lastJsonRef,
      lastViewportRef,
      apiRef,
      overlayRef,
      updateTimerRef,
    });
  }, []);
}

function useHandwritingPointerDown(apiRef: React.MutableRefObject<ExcalidrawImperativeAPI | null>): () => void {
  return useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const appState = api.getAppState();
    if (appState.currentItemFontFamily === HANDWRITING_FONT_FAMILY) return;
    api.updateScene({ appState: { currentItemFontFamily: HANDWRITING_FONT_FAMILY } });
  }, []);
}

function useHostMessageLifecycle(
  apiRef: React.MutableRefObject<ExcalidrawImperativeAPI | null>,
  overlayRef: React.MutableRefObject<DrawingCommentOverlayController | null>,
): void {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => handleHostMessage(event, apiRef, overlayRef);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      overlayRef.current?.destroy();
      overlayRef.current = null;
    };
  }, []);
}

function initOverlay(
  api: ExcalidrawImperativeAPI,
  overlayRef: React.MutableRefObject<DrawingCommentOverlayController | null>,
): void {
  const root = document.getElementById("excalidraw-root");
  if (!root || overlayRef.current) return;
  const sdk = new AccordoCommentSDK();
  const overlay = new DrawingCommentOverlayController({
    container: root,
    sdk,
    postMessage: (message) => vscode.postMessage(message),
    debug: (event, data) => vscode.postMessage({ type: "drawing:debug", event, data }),
    getSceneElements: () => api.getSceneElements() as unknown as Array<{ id: string; type: string; x: number; y: number; width?: number; height?: number; points?: number[][]; customData?: { accordo?: unknown } }>,
    getViewport: () => viewportFromAppState(api.getAppState() as Record<string, unknown>),
  });
  overlay.init();
  overlayRef.current = overlay;
  vscode.postMessage({ type: "drawing:debug", event: "webview:overlay-created" });
}

function reportSceneReady(
  api: ExcalidrawImperativeAPI,
  restored: readonly ExcalidrawElement[],
  generatedFromMermaid: boolean,
  isReadyRef: React.MutableRefObject<boolean>,
  lastJsonRef: React.MutableRefObject<string>,
  lastViewportRef: React.MutableRefObject<ExcalidrawViewportState | null>,
): void {
  window.setTimeout(() => {
    const accepted = api.getSceneElements();
    lastJsonRef.current = JSON.stringify(accepted);
    lastViewportRef.current = viewportFromAppState(api.getAppState() as Record<string, unknown>);
    isReadyRef.current = true;
    clearBoot();
    vscode.postMessage({ type: "drawing:debug", event: "webview:scene-ready", data: { acceptedCount: accepted.length } });
    vscode.postMessage({ type: "scene:ready", hostElementCount: readInitialScene().hostElementCount, elementCount: restored.length, acceptedCount: accepted.length });
    if (generatedFromMermaid) {
      vscode.postMessage({ type: "scene:update-elements", elements: accepted, generated: true });
    }
  }, 0);
}

function handleSceneChange(
  elements: readonly ExcalidrawElement[],
  appState: Record<string, unknown> | undefined,
  refs: {
    isReadyRef: React.MutableRefObject<boolean>;
    lastJsonRef: React.MutableRefObject<string>;
    lastViewportRef: React.MutableRefObject<ExcalidrawViewportState | null>;
    apiRef: React.MutableRefObject<ExcalidrawImperativeAPI | null>;
    overlayRef: React.MutableRefObject<DrawingCommentOverlayController | null>;
    updateTimerRef: React.MutableRefObject<number | null>;
  },
): void {
  if (!refs.isReadyRef.current) return;
  const json = JSON.stringify(elements);
  const elementsChanged = json !== refs.lastJsonRef.current;
  const nextViewport = viewportFromAppState(appState ?? (refs.apiRef.current?.getAppState() as Record<string, unknown> | undefined) ?? {});
  const viewportChanged = refs.lastViewportRef.current === null || !sameViewport(refs.lastViewportRef.current, nextViewport);
  if (!elementsChanged && !viewportChanged) return;
  refs.lastViewportRef.current = nextViewport;
  if (viewportChanged) refs.overlayRef.current?.onViewportChanged();
  if (!elementsChanged) return;
  refs.lastJsonRef.current = json;
  if (refs.updateTimerRef.current !== null) window.clearTimeout(refs.updateTimerRef.current);
  refs.overlayRef.current?.refreshScene();
  refs.updateTimerRef.current = window.setTimeout(() => {
    refs.updateTimerRef.current = null;
    vscode.postMessage({ type: "scene:update-elements", elements: JSON.parse(json) });
  }, 300);
}

function handleHostMessage(
  event: MessageEvent,
  apiRef: React.MutableRefObject<ExcalidrawImperativeAPI | null>,
  overlayRef: React.MutableRefObject<DrawingCommentOverlayController | null>,
): void {
  const data = event.data as { type?: string; requestId?: string; format?: "png" | "svg" } | undefined;
  if (overlayRef.current?.handleHostMessage(data) === true) return;
  if (!data || data.type !== "export:request" || typeof data.requestId !== "string") return;
  const api = apiRef.current;
  if (!api) {
    vscode.postMessage({ type: "export:result", requestId: data.requestId, ok: false, error: "excalidraw API not ready" });
    return;
  }
  void exportScene(api, data.format === "svg" ? "svg" : "png")
    .then((base64) => {
      vscode.postMessage({ type: "export:result", requestId: data.requestId, ok: true, dataBase64: base64 });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      vscode.postMessage({ type: "export:result", requestId: data.requestId, ok: false, error: message });
    });
}

const rootEl = document.getElementById("excalidraw-root");
if (!rootEl) {
  throw new Error("Accordo drawing webview: #excalidraw-root element not found");
}

try {
  setBoot("Mounting Accordo Drawing...");
  withFontReadyVisibility(ensureExcalidrawFontsLoaded())
    .then(() => restoreInitialElements())
    .then((scene) => {
      createRoot(rootEl).render(React.createElement(DrawingApp, { restored: scene.elements, generatedFromMermaid: scene.generatedFromMermaid }));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      setBoot(`Accordo Drawing failed to convert:\n${message}`, true);
      vscode.postMessage({ type: "scene:error", message });
    });
} catch (error: unknown) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  setBoot(`Accordo Drawing failed to mount:\n${message}`, true);
  vscode.postMessage({ type: "scene:error", message });
}
