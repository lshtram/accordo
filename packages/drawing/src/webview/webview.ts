import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, convertToExcalidrawElements, exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

type InitialScene = {
  elements?: readonly ExcalidrawElement[];
  appState?: Record<string, unknown>;
  hostElementCount?: number;
  accordoSource?: {
    kind?: string;
    content?: string;
  } | null;
};

type RestoredScene = {
  elements: readonly ExcalidrawElement[];
  generatedFromMermaid: boolean;
};

const vscode = acquireVsCodeApi();

function setBoot(message: string, isError = false): void {
  const boot = document.getElementById("drawing-boot");
  if (!boot) return;
  boot.className = isError ? "error" : "";
  boot.textContent = message;
}

function clearBoot(): void {
  document.getElementById("drawing-boot")?.remove();
}

function readInitialScene(): InitialScene {
  const win = window as Window & { __accordoDrawingScene?: InitialScene };
  if (win.__accordoDrawingScene) return win.__accordoDrawingScene;
  const raw = document.getElementById("drawing-scene")?.textContent;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as InitialScene;
  } catch {
    return {};
  }
}

function initialViewport(elements: readonly ExcalidrawElement[]): Record<string, unknown> {
  if (elements.length === 0) return {};
  const minX = Math.min(...elements.map((el) => Number(el.x ?? 0)));
  const minY = Math.min(...elements.map((el) => Number(el.y ?? 0)));
  return {
    scrollX: 120 - minX,
    scrollY: 120 - minY,
    zoom: { value: 1 },
  };
}

async function restoreInitialElements(): Promise<RestoredScene> {
  const scene = readInitialScene();
  if (scene.accordoSource?.kind === "mermaid" && typeof scene.accordoSource.content === "string") {
    setBoot("Converting Mermaid with mermaid-to-excalidraw...");
    const result = await parseMermaidToExcalidraw(scene.accordoSource.content, { startOnLoad: false });
    return {
      elements: convertToExcalidrawElements(result.elements, { regenerateIds: false }) as readonly ExcalidrawElement[],
      generatedFromMermaid: true,
    };
  }
  const elements = scene.elements ?? [];
  if (elements.every(isFullExcalidrawElement)) {
    return { elements, generatedFromMermaid: false };
  }
  return {
    elements: convertToExcalidrawElements(
      elements as Parameters<typeof convertToExcalidrawElements>[0],
      { regenerateIds: false },
    ) as readonly ExcalidrawElement[],
    generatedFromMermaid: false,
  };
}

function isFullExcalidrawElement(element: ExcalidrawElement): boolean {
  return typeof element.version === "number"
    && typeof element.versionNonce === "number"
    && typeof element.isDeleted === "boolean";
}

function DrawingApp({ restored, generatedFromMermaid }: { restored: readonly ExcalidrawElement[]; generatedFromMermaid: boolean }) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const isReadyRef = useRef(false);
  const lastJsonRef = useRef<string>("");
  const updateTimerRef = useRef<number | null>(null);
  const restoredRef = useRef<readonly ExcalidrawElement[]>(restored);
  const initialData = useMemo<ExcalidrawInitialDataState>(() => {
    const restored = restoredRef.current;
    lastJsonRef.current = JSON.stringify(restored);
    return {
      elements: restored,
      appState: initialViewport(restored),
      scrollToContent: true,
    };
  }, []);

  const handleApi = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    const restored = restoredRef.current;
    window.setTimeout(() => {
      const accepted = api.getSceneElements();
      lastJsonRef.current = JSON.stringify(accepted);
      isReadyRef.current = true;
      clearBoot();
      vscode.postMessage({ type: "scene:ready", hostElementCount: readInitialScene().hostElementCount, elementCount: restored.length, acceptedCount: accepted.length });
      if (generatedFromMermaid) {
        vscode.postMessage({ type: "scene:update-elements", elements: accepted, generated: true });
      }
    }, 0);
  }, [generatedFromMermaid]);

  const handleChange = useCallback((elements: readonly ExcalidrawElement[]) => {
    if (!isReadyRef.current) return;
    const json = JSON.stringify(elements);
    if (json === lastJsonRef.current) return;
    lastJsonRef.current = json;
    if (updateTimerRef.current !== null) {
      window.clearTimeout(updateTimerRef.current);
    }
    updateTimerRef.current = window.setTimeout(() => {
      updateTimerRef.current = null;
      vscode.postMessage({ type: "scene:update-elements", elements: JSON.parse(json) });
    }, 300);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; requestId?: string; format?: "png" | "svg" } | undefined;
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
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  return React.createElement(Excalidraw, {
    initialData,
    excalidrawAPI: handleApi,
    onChange: handleChange,
  });
}

async function exportScene(api: ExcalidrawImperativeAPI, format: "png" | "svg"): Promise<string> {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();

  if (format === "svg") {
    const svg = await exportToSvg({
      elements,
      appState,
      files,
      exportPadding: 16,
    });
    const xml = new XMLSerializer().serializeToString(svg);
    return bytesToBase64(new TextEncoder().encode(xml));
  }

  const blob = await exportToBlob({
    elements,
    appState,
    files,
    mimeType: "image/png",
    quality: 1,
    exportPadding: 16,
  });
  const buffer = await blob.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

const rootEl = document.getElementById("excalidraw-root");
if (!rootEl) {
  throw new Error("Accordo drawing webview: #excalidraw-root element not found");
}

try {
  setBoot("Mounting Accordo Drawing...");
  restoreInitialElements()
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
