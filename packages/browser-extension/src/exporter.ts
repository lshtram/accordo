/**
 * M80-EXPORT — Export Layer
 *
 * Exporter interface and ClipboardExporter implementation.
 * Formats threads as Markdown or JSON and copies to clipboard.
 */

import type { BrowserCommentThread, ExportPayload, ExportResult, Exporter } from "./types.js";

/**
 * Filters out soft-deleted threads and comments from a payload.
 */
function filterActive(threads: BrowserCommentThread[]): BrowserCommentThread[] {
  return threads
    .filter((t) => !t.deletedAt)
    .map((t) => ({
      ...t,
      comments: t.comments.filter((c) => !c.deletedAt),
    }));
}

/**
 * Formats an ExportPayload as a Markdown string.
 * Excludes soft-deleted threads and comments.
 */
export function formatAsMarkdown(payload: ExportPayload): string {
  const active = filterActive(payload.threads);
  const lines: string[] = [];

  lines.push(`## Accordo Export`);
  lines.push(`**URL:** ${payload.url}`);
  lines.push(`**Exported at:** ${payload.exportedAt}`);
  lines.push("");

  for (const thread of active) {
    lines.push(`### ${thread.anchorKey} (${thread.status})`);
    for (const comment of thread.comments) {
      lines.push(`- **${comment.author.name}**: ${comment.body}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Clipboard exporter — copies Markdown or JSON to the clipboard via
 * navigator.clipboard.writeText.
 *
 * Implements the Exporter interface (BR-F-70).
 */
export class ClipboardExporter implements Exporter {
  readonly name = "clipboard";

  async export(
    payload: ExportPayload,
    format: "markdown" | "json" = "markdown"
  ): Promise<ExportResult> {
    let text: string;

    if (format === "json") {
      const filtered: ExportPayload = {
        ...payload,
        threads: filterActive(payload.threads),
      };
      text = JSON.stringify(filtered, null, 2);
    } else {
      text = formatAsMarkdown(payload);
    }

    await navigator.clipboard.writeText(text);

    return {
      success: true,
      summary: `Exported ${filterActive(payload.threads).length} thread(s) as ${format}`,
    };
  }
}
