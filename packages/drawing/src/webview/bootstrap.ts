import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { EXCALIDRAW_FONTS, HANDWRITING_FONT_FAMILY } from "../core/excalidraw-fonts.js";
import { annotateManagedElements } from "./managed-metadata.js";

export type InitialScene = {
  elements?: readonly ExcalidrawElement[];
  appState?: Record<string, unknown>;
  hostElementCount?: number;
  accordoSource?: {
    kind?: string;
    content?: string;
    path?: string;
  } | null;
  accordoSourceContent?: string;
  sourcePath?: string;
};

export type RestoredScene = {
  elements: readonly ExcalidrawElement[];
  generatedFromMermaid: boolean;
};

type DrawingWindow = Window & {
  __accordoDrawingScene?: InitialScene;
  __virgilFontUri?: string;
  __cascadiaFontUri?: string;
  __assistantFontUri?: string;
};

export function setBoot(message: string, isError = false): void {
  const boot = document.getElementById("drawing-boot");
  if (!boot) return;
  boot.className = isError ? "error" : "";
  boot.textContent = message;
}

export function clearBoot(): void {
  document.getElementById("drawing-boot")?.remove();
}

export function readInitialScene(): InitialScene {
  const win = window as DrawingWindow;
  if (win.__accordoDrawingScene) return win.__accordoDrawingScene;
  const raw = document.getElementById("drawing-scene")?.textContent;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as InitialScene;
  } catch {
    return {};
  }
}

export async function ensureExcalidrawFontsLoaded(): Promise<void> {
  const win = window as DrawingWindow;
  const fontSpecs = EXCALIDRAW_FONTS.map(({ family, windowKey }) => {
    const uri = win[windowKey as keyof DrawingWindow];
    return { family, uri: typeof uri === "string" ? uri : undefined };
  });

  await Promise.allSettled(fontSpecs.map(async ({ family, uri }) => {
    if (uri) {
      const face = new FontFace(family, `url(${uri}) format("woff2")`);
      const loaded = await face.load();
      document.fonts.add(loaded);
      return;
    }

    await document.fonts.load(`16px "${family}"`);
  }));

  await Promise.race([
    document.fonts.ready,
    new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
  ]);
}

export function withFontReadyVisibility<T>(promise: Promise<T>): Promise<T> {
  const root = document.getElementById("excalidraw-root");
  if (root) {
    root.style.visibility = "hidden";
  }
  return promise.finally(() => {
    if (root) {
      root.style.visibility = "visible";
    }
  });
}

export function initialViewport(elements: readonly ExcalidrawElement[]): Record<string, unknown> {
  if (elements.length === 0) return {};
  const minX = Math.min(...elements.map((el) => Number(el.x ?? 0)));
  const minY = Math.min(...elements.map((el) => Number(el.y ?? 0)));
  return {
    scrollX: 120 - minX,
    scrollY: 120 - minY,
    zoom: { value: 1 },
  };
}

export async function restoreInitialElements(): Promise<RestoredScene> {
  const scene = readInitialScene();
  if (scene.accordoSource?.kind === "mermaid" && typeof scene.accordoSource.content === "string") {
    setBoot("Converting Mermaid with mermaid-to-excalidraw...");
    const result = await parseMermaidToExcalidraw(scene.accordoSource.content, { startOnLoad: false });
    return {
      elements: annotateManagedElements(
        forceHandwritingFont(
          convertToExcalidrawElements(result.elements, { regenerateIds: false }) as readonly ExcalidrawElement[],
        ),
        scene.accordoSource.content,
        scene.accordoSource.path ?? scene.sourcePath ?? "",
      ),
      generatedFromMermaid: true,
    };
  }
  const elements = scene.elements ?? [];
  const sourceContent = scene.accordoSourceContent;
  const sourcePath = scene.sourcePath ?? "";
  if (elements.every(isFullExcalidrawElement)) {
    return {
      elements: annotateManagedElements(forceHandwritingFont(elements), sourceContent, sourcePath),
      generatedFromMermaid: false,
    };
  }
  return {
    elements: annotateManagedElements(
      forceHandwritingFont(
        convertToExcalidrawElements(
          elements as Parameters<typeof convertToExcalidrawElements>[0],
          { regenerateIds: false },
        ) as readonly ExcalidrawElement[],
      ),
      sourceContent,
      sourcePath,
    ),
    generatedFromMermaid: false,
  };
}

function forceHandwritingFont(elements: readonly ExcalidrawElement[]): readonly ExcalidrawElement[] {
  return elements.map((element) => {
    if (element.type !== "text") return element;
    if (element.fontFamily === HANDWRITING_FONT_FAMILY) return element;
    return {
      ...element,
      fontFamily: HANDWRITING_FONT_FAMILY,
    };
  });
}

function isFullExcalidrawElement(element: ExcalidrawElement): boolean {
  return typeof element.version === "number"
    && typeof element.versionNonce === "number"
    && typeof element.isDeleted === "boolean";
}
