#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, join } from "node:path";
import { spawn } from "node:child_process";

const [deckPathArg] = process.argv.slice(2);

if (!deckPathArg) {
  throw new Error("Usage: node scripts/check-marp-slide-fit.mjs <deck.md>");
}

const deckPath = resolve(deckPathArg);

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("exit", (code) => {
      if (code === 0) return resolveRun({ stdout, stderr });
      rejectRun(new Error(stderr || `${command} exited with code ${code ?? -1}`));
    });
    child.on("error", rejectRun);
  });
}

const workDir = await mkdtemp(join(tmpdir(), "accordo-marp-fit-"));
const debugHtmlPath = join(workDir, `${basename(deckPath, ".md")}.debug.html`);
const probeHtmlPath = join(workDir, `${basename(deckPath, ".md")}.fit-check.html`);

try {
  await run("pnpm", [
    "dlx",
    "tsx",
    "scripts/export-marp-standalone.ts",
    deckPath,
    debugHtmlPath,
  ]);

  const html = await readFile(debugHtmlPath, "utf8");
  const probeScript = `
<script>
window.addEventListener('load', function () {
  try {
    var slides = Array.from(document.querySelectorAll('svg[data-marpit-svg]'));
    var results = slides.map(function (slide, index) {
      slides.forEach(function (s) { s.classList.remove('active'); });
      slide.classList.add('active');
      var section = slide.querySelector('foreignObject > section');
      var titleEl = section && section.querySelector('h1');
      var title = titleEl ? (titleEl.textContent || '').trim() : 'Slide ' + (index + 1);
      var clientHeight = section ? section.clientHeight : 0;
      var scrollHeight = section ? section.scrollHeight : 0;
      var clientWidth = section ? section.clientWidth : 0;
      var scrollWidth = section ? section.scrollWidth : 0;
      return {
        index: index + 1,
        title: title,
        clientHeight: clientHeight,
        scrollHeight: scrollHeight,
        clientWidth: clientWidth,
        scrollWidth: scrollWidth,
        overflowY: scrollHeight > clientHeight + 1,
        overflowX: scrollWidth > clientWidth + 1,
      };
    });
    document.body.setAttribute('data-fit-report', encodeURIComponent(JSON.stringify(results)));
    document.body.setAttribute('data-fit-ready', 'true');
  } catch (error) {
    document.body.setAttribute('data-fit-error', String(error && error.message ? error.message : error));
    document.body.setAttribute('data-fit-ready', 'true');
  }
});
</script>`;

  await writeFile(probeHtmlPath, html.replace("</body>", `${probeScript}</body>`), "utf8");

  const { stdout } = await run("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--allow-file-access-from-files",
    "--virtual-time-budget=3000",
    "--dump-dom",
    `file://${probeHtmlPath}`,
  ]);

  const errorMatch = stdout.match(/data-fit-error="([^"]+)"/);
  if (errorMatch?.[1]) {
    throw new Error(errorMatch[1]);
  }

  const reportMatch = stdout.match(/data-fit-report="([^"]+)"/);
  if (!reportMatch?.[1]) {
    throw new Error("Failed to extract fit report from probe HTML");
  }

  const report = JSON.parse(decodeURIComponent(reportMatch[1]));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
