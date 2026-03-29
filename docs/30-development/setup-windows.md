# Windows Setup Guide

This guide covers everything needed to run Accordo IDE on Windows from a fresh install.
All issues discovered during Windows testing are documented here with their root causes.

---

## 1. Prerequisites

| Tool | Minimum | Install |
|---|---|---|
| Node.js | 20.x | https://nodejs.org — use the LTS installer |
| pnpm | 9.x | `npm install -g pnpm` |
| VS Code | 1.100.0 | https://code.visualstudio.com |
| Git | any | https://git-scm.com |

> **Important:** Use the Node.js LTS installer (not nvm or fnm) for the initial setup. The VS Code extension host uses Electron's bundled Node, not your shell Node — this matters for paths.

---

## 2. Build & Install

```powershell
git clone https://github.com/lshtram/accordo.git
cd accordo
pnpm install
pnpm build
```

Open the `accordo` folder in VS Code, press **F5** to launch the Extension Development Host.

---

## 3. Presentations (Slidev)

### Why it failed out of the box
- **Wrong package name:** the extension previously spawned `npx slidev` — that package doesn't exist on npm. The correct package is `@slidev/cli`.
- **Windows spawn failure:** `spawn("npx", ...)` without `shell: true` fails on Windows because `npx` is a CMD script (`npx.cmd`), not a native binary. Node.js `spawn` cannot find CMD scripts without `shell: true`.
- **Short timeout:** the default 60-second wait was too short for `npx @slidev/cli` to download on a cold npm cache (~50 MB of Vite/Node modules, 2–4 min on slow connections). Raised to 180 seconds.
- **Theme not found:** Slidev exits with code 1 when `@slidev/theme-default` isn't installed locally and stdin is not a TTY (non-interactive). The fix installs it automatically with `npm install --prefix . @slidev/theme-default` before Slidev starts. The `--prefix .` flag pins the install to the deck directory so it doesn't go into the pnpm workspace root (which pnpm manages separately).

### Current status (all fixed)
No user action needed. On first open, the extension:
1. Reads the deck front-matter, detects `theme: default`
2. Runs `npm install --prefix . @slidev/theme-default` in the deck directory
3. Spawns `npx @slidev/cli` with `shell: true` (finds `npx.cmd` on Windows)
4. Shows a "Downloading @slidev/cli (first use only)…" hint if the server isn't ready after 5 seconds

### Optional: install @slidev/cli globally for faster first-open
```powershell
npm install -g @slidev/cli
```

---

## 4. Voice — TTS (Text-to-Speech)

TTS works **out of the box** on Windows with no manual install steps.

### How it works
The extension uses `kokoro-js` (ONNX-based TTS, runs fully locally). On first use, it auto-downloads the `onnx-community/Kokoro-82M-ONNX` model (~300 MB) from Hugging Face and caches it at `%USERPROFILE%\.cache\huggingface`. Subsequent calls use the cached model.

Audio playback on Windows uses:
```powershell
(New-Object Media.SoundPlayer 'C:\...\output.wav').PlaySync()
```
This requires no additional installs.

### `self is not defined` — fixed
`@huggingface/transformers` (used by `kokoro-js`) references the browser global `self`. Electron's bundled Node (the VS Code extension host environment) doesn't define it. The fix polyfills it before the dynamic import:
```typescript
if (typeof globalThis["self"] === "undefined") {
  globalThis["self"] = globalThis;
}
```

### Optional: faster TTS with Sherpa-ONNX (C++ runtime, ~3–6× faster)
Sherpa uses a pre-downloaded C++ model instead of the JS ONNX runtime:
1. Download the Kokoro model: `onnx-community/kokoro-en-v0_19`  
2. Place it at `%USERPROFILE%\.accordo\models\kokoro-en-v0_19\model.onnx`  
3. Reload VS Code — the extension auto-detects and uses Sherpa

---

## 5. Voice — STT (Speech-to-Text / Dictation)

STT requires **manual installation** of two things: the whisper.cpp binary and a model file. TTS works independently — you can use read-aloud without installing Whisper.

### Step 1: Install whisper.cpp binary

**Option A — Scoop (recommended)**
```powershell
# Install Scoop if not already installed
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
irm get.scoop.sh | iex

scoop install whisper-cpp
```
The binary will be available as `whisper-cpp` on PATH.

**Option B — Pre-built binary from GitHub**
1. Go to https://github.com/ggerganov/whisper.cpp/releases
2. Download the latest Windows release zip (e.g. `whisper-blas-bin-x64.zip`)
3. Extract — you'll get `main.exe` (the transcription binary)
4. Rename it to `whisper.exe` and add its directory to your PATH, or note the full path

**Option C — Build from source**
```powershell
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
cmake -B build
cmake --build build --config Release
# Binary is at: build\bin\Release\main.exe
```

### Step 2: Download a model file

```powershell
# Create models directory
mkdir "$env:APPDATA\whisper\models"

# Download the base English model (~150 MB)
Invoke-WebRequest `
  -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" `
  -OutFile "$env:APPDATA\whisper\models\ggml-base.en.bin"
```

The extension auto-discovers models in `%APPDATA%\whisper\models` and several other common Windows locations. No VS Code setting changes needed if you use this path.

### Step 3: Configure VS Code settings (only if using a custom path)

Open VS Code Settings (`Ctrl+,`) and search for "accordo voice":

```json
{
  "accordo.voice.whisperPath": "whisper-cpp",
  "accordo.voice.whisperModelFolder": "C:\\Users\\yourname\\AppData\\Roaming\\whisper\\models"
}
```

> Use double backslashes or forward slashes in JSON paths.

### Step 4: Install Sox for microphone recording

```powershell
scoop install sox
```

Or download a Windows installer from https://sourceforge.net/projects/sox/

### Verify STT is working

After installing, reload the Extension Development Host. The "Accordo — Voice" output channel should show:
```
[whisper] isAvailable: OK — binary=whisper model=C:\Users\...\ggml-base.en.bin
availability: stt=true tts=true
```

---

## 6. `spawn` on Windows — root cause reference

Several Accordo features spawn child processes. On Windows, Node.js `spawn` cannot find CMD scripts (`.cmd` extension) without `shell: true`. Native `.exe` binaries work without it. The affected cases in Accordo:

| Command | Issue | Fix |
|---|---|---|
| `npx` → `npx.cmd` | CMD script, not a binary | `shell: true` |
| `npm` → `npm.cmd` | CMD script, not a binary | `shell: true` |
| `whisper.exe` | Native binary | No fix needed |
| `sox.exe` | Native binary | No fix needed |
| `powershell` | Native binary | No fix needed |

---

## 7. `pnpm` workspace and npm installs

When Accordo installs Slidev themes (`npm install --prefix . @slidev/theme-default`), it uses `--prefix .` to pin the install to the deck directory. Without this, npm walks up the directory tree, finds the pnpm workspace `package.json`, and installs into the workspace root — which pnpm may overwrite on the next `pnpm install`.

---

## 8. Troubleshooting

### "The theme was not found and cannot prompt for installation"
The theme pre-install step ran but the theme landed in the workspace root, not the deck dir. This is fixed with `--prefix .`. If you still see it, delete `demo/node_modules` and reload.

### "Waiting for presentation server…" never resolves
Check the "Accordo — Slidev" output channel. Common causes:
- Port already in use (try reloading)
- `@slidev/cli` download still in progress (wait up to 3 minutes on first use)
- Deck file path has spaces — use a path without spaces

### "tts: pre-warm failed — ReferenceError: self is not defined"
This is fixed in the current build (polyfill added). Rebuild with `pnpm --filter accordo-voice build` and reload.

### Voice output channel shows `stt=false tts=true`
Expected on a fresh Windows install where whisper.cpp is not yet installed. TTS (read-aloud) still works.

### Model not found even after placing it in `%APPDATA%\whisper\models`
Check the exact path. The extension looks for `*.bin` files:
```powershell
ls "$env:APPDATA\whisper\models"  # should list ggml-base.en.bin
```
If the folder is different, set `accordo.voice.whisperModelFolder` in VS Code settings.
