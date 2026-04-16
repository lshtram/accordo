/**
 * demo-voice-script.js
 * Runs a 4-step voice demo script via the Accordo Hub MCP endpoint.
 * Monitors audio process count throughout.
 *
 * @deprecated 2026-04-16: This script uses the now-removed built-in scripting engine.
 * accordo_script_run is no longer registered. This file is kept for reference only.
 */

import WebSocket from "../packages/hub/node_modules/ws/index.js";

const HUB_PORT = 3099;
const HUB_TOKEN = "dev-token";

// 4-step demo: open slide, talk, open code, talk
const DEMO_SCRIPT = {
  label: "Voice + Code Demo",
  errPolicy: "continue",
  steps: [
    {
      type: "speak",
      text: "Welcome to the AudioQueue demo. Today we are testing the new singleton audio player that prevents process explosions.",
      block: true,
    },
    {
      type: "command",
      command: "markdown.showPreview",
      args: { "resourceUri": "file:///data/projects/accordo/demo/tool-pipeline.deck.md" },
    },
    {
      type: "delay",
      ms: 2000,
    },
    {
      type: "speak",
      text: "Here is the tool pipeline slide deck. This presentation explains how an AI agent's request flows through the Hub.",
      block: true,
    },
    {
      type: "command",
      command: "vscode.open",
      args: { "uri": "file:///data/projects/accordo/packages/voice/src/core/audio/audio-queue.ts" },
    },
    {
      type: "delay",
      ms: 1500,
    },
    {
      type: "speak",
      text: "This is the audio queue implementation. It maintains a single persistent audio player process for the entire VS Code session. PCM chunks are enqueued and played sequentially in FIFO order.",
      block: true,
    },
    {
      type: "command",
      command: "accordo.voice.testTts",
      args: {},
    },
    {
      type: "delay",
      ms: 3000,
    },
    {
      type: "speak",
      text: "The TTS smoke test confirms the audio pipeline is working end to end. All audio processes remain contained at one.",
      block: true,
    },
  ],
};

function checkProcesses() {
  const { execSync } = require("child_process");
  try {
    const aplay = parseInt(execSync("pgrep -c aplay 2>/dev/null || echo 0").toString().trim());
    const afplay = parseInt(execSync("pgrep -c afplay 2>/dev/null || echo 0").toString().trim());
    return { aplay, afplay };
  } catch {
    return { aplay: 0, afplay: 0 };
  }
}

function sendJson(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function runStep(ws, step, index) {
  return new Promise((resolve) => {
    const procCount = checkProcesses();
    console.log(`[step ${index + 1}] ${step.type}: "${step.text ?? step.command ?? ""}" | aplay=${procCount.aplay} afplay=${procCount.afplay}`);
    
    sendJson(ws, {
      jsonrpc: "2.0",
      id: index + 1,
      method: "tools/call",
      params: {
        name: "accordo_script_run",
        arguments: { script: DEMO_SCRIPT },
      },
    });
    
    // Poll process count every 500ms during step
    const interval = setInterval(() => {
      const count = checkProcesses();
      if (count.aplay > 1 || count.afplay > 1) {
        console.log(`  ⚠️  PROCESS SPIKE: aplay=${count.aplay} afplay=${count.afplay}`);
      } else if (count.aplay > 0 || count.afplay > 0) {
        console.log(`  → aplay=${count.aplay} afplay=${count.afplay} (normal)`);
      }
    }, 500);
    
    // Listen for response
    const onMessage = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === index + 1) {
          ws.removeListener("message", onMessage);
          clearInterval(interval);
          resolve(msg.result ?? msg);
        }
      } catch {}
    };
    ws.on("message", onMessage);
    
    // Timeout
    setTimeout(() => {
      ws.removeListener("message", onMessage);
      clearInterval(interval);
      resolve({ timedOut: true });
    }, 30000);
  });
}

async function main() {
  console.log("=== AudioQueue Demo Process Monitor ===\n");
  
  const baseline = checkProcesses();
  console.log(`Baseline: aplay=${baseline.aplay} afplay=${baseline.afplay}\n`);
  
  const ws = new WebSocket(`ws://localhost:${HUB_PORT}`, {
    headers: { Authorization: `Bearer ${HUB_TOKEN}` },
  });
  
  ws.on("open", async () => {
    console.log("Connected to Hub\n");
    
    // Initialize
    sendJson(ws, { jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "demo", version: "1.0.0" } } });
    await new Promise(r => ws.once("message", r));
    
    // Send tools/list to populate tool registry
    sendJson(ws, { jsonrpc: "2.0", id: 999, method: "tools/list", params: {} });
    
    // Run each step
    for (let i = 0; i < DEMO_SCRIPT.steps.length; i++) {
      await runStep(ws, DEMO_SCRIPT.steps[i], i);
    }
    
    const final = checkProcesses();
    console.log(`\nFinal: aplay=${final.aplay} afplay=${final.afplay}`);
    console.log("\n=== Demo complete ===");
    ws.close();
    process.exit(0);
  });
  
  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
    process.exit(1);
  });
}

main().catch(console.error);