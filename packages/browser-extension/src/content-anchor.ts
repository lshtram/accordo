export function normalizeAnchorFingerprint(text: string): string {
  const raw = text
    .toLowerCase()
    .slice(0, 20)
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return raw || "text";
}

export interface ParsedAnchorKey {
  tagName: string;
  siblingIndex: number;
  fingerprint: string;
  offsetX?: number;
  offsetY?: number;
}

function escapeSelectorValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}

export function findAnchorElementByKey(anchorKey: string): Element | null {
  const existing = document.querySelector(`[data-anchor="${escapeSelectorValue(anchorKey)}"]`);
  if (existing) return existing;

  const parsed = parseAnchorKey(anchorKey);
  if (!parsed) return null;

  const { tagName, siblingIndex, fingerprint } = parsed;

  const candidates = Array.from(document.getElementsByTagName(tagName));
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const idx = Array.from(candidate.parentElement?.children ?? []).indexOf(candidate);
    if (idx !== siblingIndex) continue;
    if (normalizeAnchorFingerprint(candidate.textContent ?? "") === fingerprint) {
      candidate.setAttribute("data-anchor", anchorKey);
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (normalizeAnchorFingerprint(candidate.textContent ?? "") === fingerprint) {
      candidate.setAttribute("data-anchor", anchorKey);
      return candidate;
    }
  }

  return null;
}

export function parseAnchorKey(anchorKey: string): ParsedAnchorKey | null {
  const [tagName, siblingIndexRaw, fingerprintWithOffset] = anchorKey.split(":");
  if (!tagName || siblingIndexRaw === undefined || !fingerprintWithOffset) return null;

  const siblingIndex = Number(siblingIndexRaw);
  if (!Number.isInteger(siblingIndex) || siblingIndex < 0) return null;

  const [fingerprint, offsetRaw] = fingerprintWithOffset.split("@");
  if (!fingerprint) return null;

  let offsetX: number | undefined;
  let offsetY: number | undefined;
  if (offsetRaw) {
    const [xRaw, yRaw] = offsetRaw.split(",");
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      offsetX = x;
      offsetY = y;
    }
  }

  return { tagName, siblingIndex, fingerprint, offsetX, offsetY };
}

export function getAnchorPagePosition(anchorKey: string, anchorElement: Element): { x: number; y: number } {
  const rect = anchorElement.getBoundingClientRect();
  const parsed = parseAnchorKey(anchorKey);
  const genericOffset = ((): { x: number; y: number } | null => {
    const at = anchorKey.lastIndexOf("@");
    if (at <= 0) return null;
    const [xRaw, yRaw] = anchorKey.slice(at + 1).split(",");
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  })();

  if ((parsed && parsed.offsetX !== undefined && parsed.offsetY !== undefined) || genericOffset) {
    const offsetX = parsed?.offsetX ?? genericOffset?.x ?? 0;
    const offsetY = parsed?.offsetY ?? genericOffset?.y ?? 0;
    const clampedX = Math.max(0, Math.min(offsetX, rect.width || offsetX));
    const clampedY = Math.max(0, Math.min(offsetY, rect.height || offsetY));
    return {
      x: rect.left + window.scrollX + clampedX - 12,
      y: rect.top + window.scrollY + clampedY + 4,
    };
  }

  return {
    x: rect.right + window.scrollX - 12,
    y: rect.top + window.scrollY + 4,
  };
}

/**
 * Parse viewport-percentage anchor keys generated from Hub normalized coordinates.
 * Format: body:<x>%x<y>% (example: body:42%x63%).
 */
export function parseViewportAnchorKey(anchorKey: string): { xPct: number; yPct: number } | null {
  const m = /^body:(\d{1,3})%x(\d{1,3})%$/.exec(anchorKey);
  if (!m) return null;
  const xPct = Number(m[1]);
  const yPct = Number(m[2]);
  if (!Number.isFinite(xPct) || !Number.isFinite(yPct)) return null;
  return {
    xPct: Math.max(0, Math.min(100, xPct)),
    yPct: Math.max(0, Math.min(100, yPct)),
  };
}

/**
 * Resolve a viewport-percentage key to page coordinates.
 */
export function getViewportAnchorPagePosition(anchorKey: string): { x: number; y: number } | null {
  const parsed = parseViewportAnchorKey(anchorKey);
  if (!parsed) return null;
  return {
    x: window.scrollX + Math.round((window.innerWidth * parsed.xPct) / 100) - 12,
    y: window.scrollY + Math.round((window.innerHeight * parsed.yPct) / 100) + 4,
  };
}
