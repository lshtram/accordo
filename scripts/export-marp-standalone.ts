#!/usr/bin/env -S pnpm dlx tsx

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MarpRenderer } from "../packages/marp/src/marp-renderer.js";
import { buildStandaloneMarpHtml } from "../packages/marp/src/marp-webview-html.js";

const [deckPathArg, outputPathArg] = process.argv.slice(2);

if (!deckPathArg || !outputPathArg) {
  throw new Error(
    "Usage: pnpm dlx tsx scripts/export-marp-standalone.ts <deck.md> <output.html>",
  );
}

const deckPath = resolve(deckPathArg);
const outputPath = resolve(outputPathArg);

function rewriteDeckAssetUrisForBrowser(html: string, deckFsPath: string): string {
  const deckDir = dirname(deckFsPath);

  const toFileAssetUri = (rawSrc: string): string => {
    if (
      rawSrc.startsWith("http://") ||
      rawSrc.startsWith("https://") ||
      rawSrc.startsWith("data:") ||
      rawSrc.startsWith("blob:") ||
      rawSrc.startsWith("file:")
    ) {
      return rawSrc;
    }

    const [pathPart, suffix = ""] = String(rawSrc).split(/([?#].*)/, 2);
    const absolutePath = pathPart.startsWith("/")
      ? pathPart
      : resolve(deckDir, pathPart);

    return `${pathToFileURL(absolutePath).toString()}${suffix}`;
  };

  return html.replace(/(<img\b[^>]*\bsrc=)(["'])([^"']+)\2/gi, (_m, prefix, quote, src) => {
    return `${prefix}${quote}${toFileAssetUri(src)}${quote}`;
  }).replace(
    /(background-image\s*:\s*url\((?:&quot;|"|'))([^"')]+)((?:&quot;|"|')\))/gi,
    (_m, prefix, src, suffix) => `${prefix}${toFileAssetUri(src)}${suffix}`,
  );
}

async function main(): Promise<void> {
  const markdown = await readFile(deckPath, "utf8");
  const renderer = new MarpRenderer();
  const renderResult = renderer.render(markdown);
  const browserRenderResult = {
    ...renderResult,
    html: rewriteDeckAssetUrisForBrowser(renderResult.html, deckPath),
  };

  const mermaidJsUri = pathToFileURL(resolve("packages/marp/node_modules/mermaid/dist/mermaid.min.js")).toString();
  const standaloneHtml = buildStandaloneMarpHtml({
    renderResult: browserRenderResult,
    title: `Marp Standalone - ${deckPath.split("/").pop() ?? "deck"}`,
    mermaidJsUri,
  });

  await writeFile(outputPath, standaloneHtml, "utf8");
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error instanceof Error ? error.message : error)}\n`);
  process.exit(1);
});
