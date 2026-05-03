#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const rawArgs = process.argv.slice(2);
const positionalArgs = [];
let style = "vivid";

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];
  if (arg === "--style") {
    style = rawArgs[index + 1] || style;
    index += 1;
    continue;
  }
  if (arg.startsWith("--style=")) {
    style = arg.slice("--style=".length) || style;
    continue;
  }
  positionalArgs.push(arg);
}

const [inputPathArg, outputPathArg] = positionalArgs;

if (!inputPathArg || !outputPathArg) {
  throw new Error(
    "Usage: node scripts/render-mermaid-asset.mjs [--style vivid|calm|neutral] <input.mmd> <output.svg>",
  );
}

const inputPath = resolve(inputPathArg);
const outputPath = resolve(outputPathArg);
const mermaidJsPath = resolve(
  "packages/marp/node_modules/mermaid/dist/mermaid.min.js",
);

const chartStyles = {
  vivid: {
    background: "#0b1220",
    primaryColor: "#5eead4",
    primaryTextColor: "#0b1220",
    primaryBorderColor: "#14b8a6",
    lineColor: "#f59e0b",
    secondaryColor: "#3b82f6",
    tertiaryColor: "#ef4444",
    textColor: "#e5e7eb",
    pie1: "#3b82f6",
    pie2: "#10b981",
    pie3: "#f59e0b",
    pie4: "#ef4444",
    pie5: "#a855f7",
    pie6: "#14b8a6",
  },
  calm: {
    background: "#0f172a",
    primaryColor: "#bfdbfe",
    primaryTextColor: "#0f172a",
    primaryBorderColor: "#93c5fd",
    lineColor: "#94a3b8",
    secondaryColor: "#34d399",
    tertiaryColor: "#fbbf24",
    textColor: "#e5e7eb",
    pie1: "#60a5fa",
    pie2: "#34d399",
    pie3: "#fbbf24",
    pie4: "#f87171",
    pie5: "#c084fc",
    pie6: "#22d3ee",
  },
  neutral: {
    background: "#111827",
    primaryColor: "#e5e7eb",
    primaryTextColor: "#111827",
    primaryBorderColor: "#d1d5db",
    lineColor: "#d1d5db",
    secondaryColor: "#6b7280",
    tertiaryColor: "#374151",
    textColor: "#f3f4f6",
    pie1: "#9ca3af",
    pie2: "#6b7280",
    pie3: "#d1d5db",
    pie4: "#4b5563",
    pie5: "#374151",
    pie6: "#1f2937",
  },
};

const styleKey = chartStyles[style] ? style : "vivid";
if (!chartStyles[style]) {
  process.stderr.write(
    `Unknown style '${style}'. Falling back to '${styleKey}'.\n`,
  );
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      rejectRun(new Error(stderr || `${command} exited with code ${code ?? -1}`));
    });
    child.on("error", rejectRun);
  });
}

const source = await readFile(inputPath, "utf8");
const escapedSource = source
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

const workDir = await mkdtemp(join(tmpdir(), "accordo-mermaid-"));
const htmlPath = join(workDir, "render.html");

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="file://${mermaidJsPath}"></script>
</head>
<body>
  <div id="container"></div>
  <script id="result" type="text/plain"></script>
  <pre id="source" style="display:none">${escapedSource}</pre>
  <script>
    (async function () {
      try {
        const source = document.getElementById('source').textContent || '';
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'base',
          themeVariables: ${JSON.stringify(chartStyles[styleKey])},
          flowchart: { htmlLabels: false },
        });
        const { svg } = await mermaid.render('accordo-mermaid-svg', source, document.getElementById('container'));
        document.getElementById('result').textContent = svg;
        document.body.setAttribute('data-render-status', 'ok');
      } catch (error) {
        document.body.setAttribute('data-render-status', 'error');
        document.body.setAttribute('data-render-error', String(error && error.message ? error.message : error));
      }
    })();
  </script>
</body>
</html>`;

await writeFile(htmlPath, html, "utf8");

try {
  const { stdout } = await run("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--allow-file-access-from-files",
    "--virtual-time-budget=3000",
    "--dump-dom",
    `file://${htmlPath}`,
  ]);

  const statusMatch = stdout.match(/data-render-status="([^"]+)"/);
  const status = statusMatch?.[1];
  if (status !== "ok") {
    const errorMatch = stdout.match(/data-render-error="([^"]*)"/);
    throw new Error(errorMatch?.[1] || "Mermaid rendering failed");
  }

  const svgMatch = stdout.match(/<script id="result" type="text\/plain">([\s\S]*?)<\/script>/);
  const svg = svgMatch?.[1]
    ?.replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
  if (!svg || !svg.startsWith("<svg")) {
    throw new Error("Failed to extract rendered SVG from browser output");
  }

  await writeFile(outputPath, svg + "\n", "utf8");
  process.stdout.write(`${outputPath}\n`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
