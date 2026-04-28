import type { PageToolError } from "./page-tool-types.js";

export function isPageToolError(result: unknown): result is PageToolError {
  return typeof result === "object" && result !== null && typeof (result as { error?: unknown }).error === "string";
}

export function isFoundResult(result: unknown): result is { found: boolean } {
  return typeof result === "object" && result !== null && typeof (result as { found?: unknown }).found === "boolean";
}

export function normalizeComparableUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function normalizeComparableText(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}
