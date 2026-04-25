export async function decodeImage(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

export async function paintRedactionRectangles(
  dataUrl: string,
  bboxes: Array<{ x: number; y: number; width: number; height: number }>,
): Promise<string> {
  if (bboxes.length === 0) return dataUrl;

  const bitmap = await decodeImage(dataUrl);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  ctx.fillStyle = "black";
  for (const bbox of bboxes) {
    const x = Math.max(0, Math.round(bbox.x));
    const y = Math.max(0, Math.round(bbox.y));
    const w = Math.min(canvas.width - x, Math.round(bbox.width));
    const h = Math.min(canvas.height - y, Math.round(bbox.height));
    if (w > 0 && h > 0) ctx.fillRect(x, y, w, h);
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = (): void => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("FileReader result is not a string"));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
