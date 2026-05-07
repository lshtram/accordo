import { exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";

export async function exportScene(api: ExcalidrawImperativeAPI, format: "png" | "svg"): Promise<string> {
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
