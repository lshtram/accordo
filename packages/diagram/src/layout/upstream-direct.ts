/**
 * upstream-direct — bypass the dagre pipeline and render upstream output.
 *
 * Uses `@excalidraw/mermaid-to-excalidraw` to parse Mermaid directly into
 * Excalidraw element skeletons.
 */

type ExcalidrawElementSkeleton = Record<string, unknown>;

let shimApplied = false;

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function numberAttr(el: any, name: string, fallback = 0): number {
  const raw = el.getAttribute?.(name);
  return raw == null ? fallback : Number(raw);
}

function emptyBox(): BBox {
  return { x: 0, y: 0, width: 0, height: 0 };
}

function unionBoxes(boxes: BBox[]): BBox {
  if (boxes.length === 0) return emptyBox();
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function parsePoints(raw: string | null | undefined): BBox {
  if (!raw) return emptyBox();
  const coords = raw
    .trim()
    .split(/\s+/)
    .map((part) => part.split(",").map(Number))
    .filter((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (coords.length === 0) return emptyBox();
  const xs = coords.map(([x]) => x);
  const ys = coords.map(([, y]) => y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function parsePath(raw: string | null | undefined): BBox {
  if (!raw) return emptyBox();
  const nums = Array.from(raw.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi), (m) => Number(m[0]));
  if (nums.length < 2) return emptyBox();
  const coords: Array<[number, number]> = [];
  for (let i = 0; i < nums.length - 1; i += 2) {
    coords.push([nums[i], nums[i + 1]]);
  }
  const xs = coords.map(([x]) => x);
  const ys = coords.map(([, y]) => y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function estimateBBox(el: any, svgElementCtor: unknown): BBox {
  const tag = (el.tagName ?? "").toLowerCase();
  switch (tag) {
    case "rect":
    case "foreignobject":
    case "image":
      return {
        x: numberAttr(el, "x"),
        y: numberAttr(el, "y"),
        width: numberAttr(el, "width"),
        height: numberAttr(el, "height"),
      };
    case "circle": {
      const r = numberAttr(el, "r");
      const cx = numberAttr(el, "cx");
      const cy = numberAttr(el, "cy");
      return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
    }
    case "ellipse": {
      const rx = numberAttr(el, "rx");
      const ry = numberAttr(el, "ry");
      const cx = numberAttr(el, "cx");
      const cy = numberAttr(el, "cy");
      return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
    }
    case "line": {
      const x1 = numberAttr(el, "x1");
      const y1 = numberAttr(el, "y1");
      const x2 = numberAttr(el, "x2");
      const y2 = numberAttr(el, "y2");
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    }
    case "polygon":
    case "polyline":
      return parsePoints(el.getAttribute?.("points"));
    case "path":
      return parsePath(el.getAttribute?.("d"));
    case "text":
    case "tspan": {
      const x = numberAttr(el, "x");
      const y = numberAttr(el, "y");
      const text = el.textContent ?? "";
      return { x, y, width: Math.max(text.length * 8, 1), height: 16 };
    }
    default: {
      const ctor = svgElementCtor as { new (...args: unknown[]): unknown } | undefined;
      const children = Array.from(el.children ?? [])
        .filter((c) => (ctor ? c instanceof ctor : true))
        .map((c) => estimateBBox(c, svgElementCtor))
        .filter((b) => b.width > 0 || b.height > 0);
      return unionBoxes(children);
    }
  }
}

function applySvgPolyfills(win: Record<string, unknown>): void {
  if (shimApplied) return;
  const svgCtor = win.SVGElement as { prototype?: Record<string, unknown> } | undefined;
  if (!svgCtor?.prototype) return;
  const textCtor = win.SVGTextElement as { prototype?: Record<string, unknown> } | undefined;
  const tspanCtor = win.SVGTSpanElement as { prototype?: Record<string, unknown> } | undefined;

  const getBBox = function (this: unknown): BBox {
    return estimateBBox(this, win.SVGElement);
  };
  const getTextLength = function (this: { textContent?: string | null }): number {
    return Math.max((this.textContent ?? "").length * 8, 1);
  };

  Object.defineProperty(svgCtor.prototype, "getBBox", { configurable: true, value: getBBox });
  Object.defineProperty(svgCtor.prototype, "getComputedTextLength", {
    configurable: true,
    value: getTextLength,
  });
  Object.defineProperty(svgCtor.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function () {
      const box = getBBox.call(this);
      return {
        ...box,
        top: box.y,
        left: box.x,
        right: box.x + box.width,
        bottom: box.y + box.height,
        toJSON: () => box,
      };
    },
  });
  if (textCtor?.prototype) {
    Object.defineProperty(textCtor.prototype, "getBBox", { configurable: true, value: getBBox });
    Object.defineProperty(textCtor.prototype, "getComputedTextLength", { configurable: true, value: getTextLength });
  }
  if (tspanCtor?.prototype) {
    Object.defineProperty(tspanCtor.prototype, "getBBox", { configurable: true, value: getBBox });
    Object.defineProperty(tspanCtor.prototype, "getComputedTextLength", { configurable: true, value: getTextLength });
  }
  shimApplied = true;
}

async function applyNodeShim(): Promise<void> {
  if (shimApplied) return;
  const g = globalThis as Record<string, unknown>;
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost",
    contentType: "text/html",
    includeNodeLocations: false,
    runScripts: "outside-only",
  });
  const { window } = dom;
  g.window = window as unknown as typeof globalThis;
  g.document = window.document as unknown as Document;
  applySvgPolyfills(window as unknown as Record<string, unknown>);
}

/**
 * Parse Mermaid source via upstream library into Excalidraw skeletons.
 */
export async function renderUpstreamDirect(
  source: string,
): Promise<ExcalidrawElementSkeleton[]> {
  await applyNodeShim();

  const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
  const result = await parseMermaidToExcalidraw(source);
  return result.elements as ExcalidrawElementSkeleton[];
}
