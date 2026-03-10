/**
 * VoicePanelProvider — VS Code WebviewView for voice visualization.
 *
 * M50-VP
 */

import type * as vscode from "vscode";
import type { SessionState, AudioState, NarrationState } from "../core/fsm/types.js";

/** Callbacks from the webview UI → extension. M50-VP-10 */
export interface VoicePanelCallbacks {
  onMicToggle?: () => void;
  onStopNarration?: () => void;
  onTestTts?: () => void;
  onTestStt?: () => void;
}

// ── nonce generator ────────────────────────────────────────────────────────────

function generateNonce(length = 20): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ── HTML template ─────────────────────────────────────────────────────────────

function buildHtml(nonce: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    body { margin: 0; padding: 8px; background: #1e1e1e; color: #ccc; font-family: sans-serif; }
    #status { font-size: 12px; margin-bottom: 6px; }
    canvas { display: block; width: 100%; height: 60px; background: #111; border-radius: 4px; }
    #controls { margin-top: 8px; display: flex; gap: 8px; }
    button { border: none; border-radius: 50%; cursor: pointer; padding: 8px 14px; }
    #mic-btn { background: #3c3c3c; color: #fff; }
    #mic-btn.recording { background: #c00; }
    #stop-btn { background: #3c3c3c; color: #fff; display: none; }
  </style>
</head>
<body>
  <div id="status" role="status">Voice Off</div>
  <canvas id="waveform" width="320" height="60" aria-label="Voice waveform"></canvas>
  <div id="controls">
    <button id="mic-btn" title="Toggle dictation recording">Mic</button>
    <button id="stop-btn" title="Stop narration">Stop</button>
    <button id="test-tts-btn" title="Play TTS smoke test">Test TTS</button>
    <button id="test-stt-btn" title="Run STT smoke test">Test STT</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const micBtn  = document.getElementById('mic-btn');
    const stopBtn = document.getElementById('stop-btn');
    const testTtsBtn = document.getElementById('test-tts-btn');
    const testSttBtn = document.getElementById('test-stt-btn');
    const canvas  = document.getElementById('waveform');
    const ctx     = canvas.getContext('2d');
    const BARS    = 32;
    let bars      = new Array(BARS).fill(0);

    function drawBars(color) {
      const w = canvas.width / BARS;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      bars.forEach((v, i) => {
        const h = Math.max(2, v * canvas.height);
        ctx.fillStyle = color || '#555';
        ctx.fillRect(i * w + 1, (canvas.height - h) / 2, w - 2, h);
      });
    }

    micBtn.addEventListener('click',         () => vscode.postMessage({ type: 'micToggle' }));
    stopBtn.addEventListener('click',     () => vscode.postMessage({ type: 'stopNarration' }));
    testTtsBtn.addEventListener('click',  () => vscode.postMessage({ type: 'testTts' }));
    testSttBtn.addEventListener('click',  () => vscode.postMessage({ type: 'testStt' }));

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'volumeData') {
        bars = msg.data.slice(0, BARS).map(v => Math.min(1, Math.max(0, v)));
        drawBars('#4fc3f7');
      } else if (msg.type === 'stateChange') {
        const s = msg.session, a = msg.audio, n = msg.narration;
        if (s === 'inactive') {
          document.getElementById('status').textContent = 'Voice Off';
          bars = new Array(BARS).fill(0); drawBars();
        } else if (a === 'listening') {
          document.getElementById('status').textContent = '● REC';
          micBtn.classList.add('recording');
        } else if (n === 'playing') {
          document.getElementById('status').textContent = '▶ Speaking';
          stopBtn.style.display = '';
          micBtn.classList.remove('recording');
        } else if (n === 'paused') {
          document.getElementById('status').textContent = '⏸ Paused';
        } else {
          document.getElementById('status').textContent = 'Voice Ready';
          stopBtn.style.display = 'none';
          micBtn.classList.remove('recording');
          bars = new Array(BARS).fill(0); drawBars();
        }
      }
    });
    drawBars();
  </script>
</body>
</html>`;
}

// ── VoicePanelProvider ────────────────────────────────────────────────────────

/** M50-VP-01 */
export class VoicePanelProvider implements vscode.WebviewViewProvider {
  static readonly VIEW_TYPE = "accordo-voice-panel";

  private _view: vscode.WebviewView | undefined;
  private readonly _callbacks: VoicePanelCallbacks;

  constructor(callbacks?: VoicePanelCallbacks) {
    this._callbacks = callbacks ?? {};
  }

  /** M50-VP-02 */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    const nonce = generateNonce();
    webviewView.webview.html = buildHtml(nonce);

    webviewView.webview.onDidReceiveMessage((msg: { type: string }) => {
      if (msg.type === "micToggle") this._callbacks.onMicToggle?.();
      else if (msg.type === "stopNarration") this._callbacks.onStopNarration?.();
      else if (msg.type === "testTts") this._callbacks.onTestTts?.();
      else if (msg.type === "testStt") this._callbacks.onTestStt?.();
    });
  }

  /**
   * Push a message to the webview.
   * M50-VP-08 / M50-VP-09
   */
  postMessage(msg: { type: string } & Record<string, unknown>): void {
    this._view?.webview.postMessage(msg);
  }

  /** M50-VP-12 */
  dispose(): void {
    this._view = undefined;
  }
}
