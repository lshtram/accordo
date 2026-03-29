# Testing Guide — Session 10A: `accordo-voice` (M50-SP through M50-EXT)

**Date:** Session 10A + continuation  
**Package:** `packages/voice/` (`accordo-voice`)  
**Total automated tests:** 211  
**Commits:** `1136d65` → `789b506`

---

## 1. Automated Tests (CI Gate)

Run before any manual testing:

```bash
pnpm --filter accordo-voice test
```

Expected output: `Tests  211 passed (211)`. If any fail, do not proceed to manual verification.

---

## 2. Provider Status

### Whisper.cpp (STT) ✅ Installed

- Binary: `/opt/homebrew/bin/whisper` (whisper.cpp, native arm64)
- Model: `/usr/local/share/whisper/ggml-base.en.bin`
- Default VS Code settings (`accordo.voice.whisperPath: "whisper"`, `accordo.voice.whisperModelFolder: "/usr/local/share/whisper"`, `accordo.voice.whisperModel: "ggml-base.en.bin"`) match the installation — no configuration change needed.

### kokoro-js (TTS) ✅ Installed

- Version: `1.2.1` (declared in `packages/voice/package.json`)
- Located at: `packages/voice/node_modules/kokoro-js`
- All voice `.bin` files present (af_sarah, am_adam, bf_emma, bm_george, etc.)
- `KokoroTTS` and `TextSplitterStream` export correctly — confirmed by dynamic import check

> Previously used (and confirmed working) in the `theia-openspace` project on this machine.

---

## 3. Setup Prerequisites for Manual Testing

1. Build the workspace: `pnpm build` (or press **Cmd+Shift+B** in VS Code).
2. Press **F5** from the **root workspace** — this uses `.vscode/launch.json` which loads Bridge, Editor, Comments, Md-Viewer, Slidev, **and Voice** all together into a single Extension Development Host window.
   - The configuration is named **"Launch Bridge + Editor + Voice (Extension Development Host)"**.
   - Do NOT press F5 from inside a package folder — that won't load the other extensions.
3. A new VS Code window (the EDH) opens with this repo as its workspace.
4. Wait ~3 seconds for all extensions to activate.
5. Confirm: **Voice** status bar item appears on the bottom-right of the EDH window.

---

## 4. Internal Modules (automated tests only)

These modules have no user-visible UI. Verify via `pnpm --filter accordo-voice test`.

| Module | What it covers | Tests |
|---|---|---|
| M50-SP | Provider interfaces (`SttProvider`, `TtsProvider`) | — |
| M50-WA | WhisperCppAdapter: WAV building, binary lifecycle, cancellation | 14 |
| M50-KA | KokoroAdapter: lazy load, synthesize, trim-silence, dispose | 15 |
| M50-FSM | SessionFsm, AudioFsm, NarrationFsm state transitions and guards | 36 |
| M50-WAV | WAV buffer construction; `playPcmAudio` subprocess lifecycle | 12 |
| M50-TC | `cleanTextForNarration`: markdown → speech text (6 modes) | 20 |
| M50-SS | `splitIntoSentences`: boundary detection | 8 |
| M50-VC | `VoiceVocabulary`: abbreviation expansion, persistence | 12 |

---

## 5. UI Test: Extension Activation (M50-EXT)

**Goal:** Confirm the extension loads, status bar appears, and the correct notification fires based on provider availability.

### 5.1 With both providers installed (current state)

1. Open Extension Development Host.
2. Wait ~2 seconds for activation.
3. **Expected status bar (bottom-right):** `🔊 Voice: Ready`
4. No warning notification.
5. Open **View → Output** → select channel **"Accordo Voice"** — confirm providers available logged.

### 5.2 Degraded state (kokoro-js removed or unavailable)

1. Temporarily rename or remove `packages/voice/node_modules/kokoro-js`.
2. Reload Extension Development Host.
3. **Expected status bar:** `🔇 Voice: Off`
4. **Expected notification:** Warning toast — *"Accordo Voice: providers not available. Install Whisper.cpp and kokoro-js."*

### 5.3 Without Bridge extension

1. Disable `accordo-bridge` in the Extension Development Host.
2. Reload.
3. **Expected:** Status bar appears normally, no error notification.
4. Voice commands remain available; tools are silently not registered (no Bridge to receive them).

---

## 6. UI Test: Status Bar (M50-SB)

**Goal:** Verify the status bar item reflects all voice states.

**Location:** VS Code status bar, right side.

### State walkthrough (requires both providers)

| Trigger | Expected status bar text |
|---|---|
| Extension loaded, voice disabled | `🔇 Voice: Off` |
| Run **Configure Voice** command → enable voice | `🔊 Voice: Ready` |
| Start dictation (§8) | `⏺ Voice: Recording…` (red highlight) |
| Release mic, transcribing | `⟳ Voice: Transcribing…` |
| Agent runs `readAloud` | `▶ Voice: Narrating…` |
| Run **Pause Narration** command | `⏸ Voice: Paused` |
| STT error occurs | `✘ Voice: Error` |

### Click behaviour

- Click while **idle/ready** → opens Settings UI filtered to `accordo.voice`
- Click while **narrating** → stops narration immediately

### Tooltip

Hover over the status bar item → tooltip reads:
```
Voice: af_sarah | Speed: 1.0 | Mode: narrate-off
```
(values reflect the current policy)

---

## 7. UI Test: Voice Panel (M50-VP)

**Goal:** Verify the Voice webview panel opens and all UI elements are present and functional.

### Opening the panel

1. In the EDH window: **View → Open View…** → type `Voice` → select **"Voice"** (under Accordo Voice).
   - Or: **Cmd+Shift+P** → type `Open View` → `Voice`.
   - The panel docks in the bottom panel area by default.
2. **Expected panel contents:**
   - A waveform canvas (32 animated bars)
   - A circular **Hold to speak** mic button
   - A **Stop** button (hidden when not narrating)
   - A status label showing the current state

### Mic push-to-talk

**Mouse:** Click and hold the mic button in the Voice panel.

**Keyboard alternative:** `Cmd+Alt+V` calls `accordo.voice.startDictation` but the command is currently a stub — actual recording starts via the mic button in the panel, or by asking the agent (`accordo_voice_dictation { "action": "start" }`).

1. Click and hold the mic button in the panel.
2. **Expected:** Status bar → `⏺ Voice: Recording…`; panel label reads "Recording…"
3. Release the mic button.
4. **Expected:** Status bar → `⟳ Voice: Transcribing…`; label reads "Transcribing…"
5. After transcription: label returns to idle state.

### Stop narration button

1. Trigger narration (Read Aloud command or ask agent).
2. While audio plays: **Stop** button becomes visible in the panel.
3. Click **Stop** → audio stops immediately; status bar returns to `🔊 Voice: Ready`.

### Waveform animation

- While recording: canvas bars animate in response to microphone volume.
- While idle: bars are static at baseline.

### Security check

1. Right-click inside the webview → **Inspect Element**.
2. Find the `<meta http-equiv="Content-Security-Policy">` tag.
3. Confirm `script-src` contains `nonce-<random>` with **no** `unsafe-inline` or `unsafe-eval`.
4. Confirm the `<script>` tag carries a matching `nonce="<same-value>"` attribute.

---

## 8. UI Test: Commands and Keybindings (M50-EXT)

All commands are accessible via **Command Palette** (`Cmd+Shift+P`) — search "Voice".

| Command | Palette name | Keybinding | Status |
|---|---|---|---|
| `accordo.voice.startDictation` | Start Dictation | `Cmd+Alt+V` | Stub — actual recording via panel or agent |
| `accordo.voice.readAloud` | Read Selection Aloud | `Cmd+Alt+R` | Stub — actual synthesis via agent |
| `accordo.voice.stopNarration` | Stop Narration | `Escape` (when narrating) | **Functional** — stops narration FSM |
| `accordo.voice.pauseNarration` | Pause Narration | — | **Functional** — pauses narration FSM |
| `accordo.voice.resumeNarration` | Resume Narration | — | **Functional** — resumes narration FSM |
| `accordo.voice.configure` | Configure Voice | — | **Functional** — opens Settings for `accordo.voice` |

### Steps

1. Press `Cmd+Shift+P` → type "Configure Voice" → Enter.
   **Expected:** Settings UI opens, filtered to `accordo.voice.*` settings.
2. Trigger narration via the agent, then press `Escape`.
   **Expected:** Narration stops, status bar returns to `🔊 Voice: Ready`.
3. `Cmd+Alt+V` and `Cmd+Alt+R` are registered (no error) but are no-ops until wired to direct recording/synthesis in a future milestone.

---

## 9. UI Test: Settings (M50-EXT)

1. Open **Settings** (`Cmd+,`) → search `accordo.voice`.
2. Confirm all settings are visible with correct defaults:

| Setting | Default value |
|---|---|
| `accordo.voice.whisperPath` | `whisper` |
| `accordo.voice.whisperModelFolder` | `/usr/local/share/whisper` |
| `accordo.voice.whisperModel` | `ggml-base.en.bin` |
| `accordo.voice.voice` | `af_sarah` (dropdown, 7 options) |
| `accordo.voice.speed` | `1.0` (range 0.5–2.0) |
| `accordo.voice.language` | `en-US` |
| `accordo.voice.narrationMode` | `narrate-off` (dropdown) |

3. Change `accordo.voice.voice` to `am_adam` → trigger a Read Aloud → voice should change.

---

## 10. UI Test: MCP Tools via Agent (M50-DT / M50-RA / M50-DI / M50-POL)

These tools are invoked by the AI agent. Requires an active agent session with Bridge connected.

### Discover (M50-DT)

Ask: *"What is the current voice state?"*  
Agent calls `accordo_voice_discover`.  
**Expected:** Response includes `sessionState`, `audioState`, `sttAvailable: true`, `ttsAvailable: true/false`.

### Read Aloud (M50-RA)

Ask: *"Read this aloud: Hello, this is a test."*  
**Expected:** Audio plays; status bar shows `▶ Voice: Narrating…` then returns to ready.

### Dictation (M50-DI)

Ask: *"Start dictation."*  
**Expected:** Status bar → `⏺ Voice: Recording…`

Ask: *"Stop dictation and insert the text at my cursor."*  
**Expected:** Transcript inserted at cursor in the active editor.

### Set Policy (M50-POL)

Ask: *"Set narration speed to 1.5 and mode to narrate-everything."*  
**Expected:** Status bar tooltip updates to `Speed: 1.5 | Mode: narrate-everything`.

---

## 11. End-to-End Scenario

**Prerequisites:** Both providers installed, Bridge connected.

1. Open a markdown file with headings and code blocks.
2. Select a paragraph → press `Cmd+Alt+R` (**Read Selection Aloud**).
3. **Expected:** Code block replaced with *"There's a code snippet shown on screen."* and audio plays. Status bar → `▶ Voice: Narrating…`
4. While playing: click **Stop** button in the Voice panel.
5. **Expected:** Audio stops, status bar → `🔊 Voice: Ready`.
6. Press `Cmd+Alt+V` (**Start Dictation**) → speak a sentence → wait.
7. **Expected:** Transcript returned to agent / visible in Output channel.
8. Ask agent: *"Set narration to summary mode."*
9. Select the full file → `Cmd+Alt+R`.
10. **Expected:** Only headings and first sentences spoken; code blocks skipped.

---

## 12. Test Coverage Summary

| Module | What is tested | Automated tests |
|---|---|---|
| M50-SP | Provider interfaces | — |
| M50-WA | WhisperCppAdapter | 14 |
| M50-KA | KokoroAdapter | 15 |
| M50-FSM | SessionFsm / AudioFsm / NarrationFsm | 36 |
| M50-WAV | WAV buffer + playback subprocess | 12 |
| M50-TC | Text cleaner (6 modes) | 20 |
| M50-SS | Sentence splitter | 8 |
| M50-VC | Voice vocabulary | 12 |
| M50-DT | `accordo_voice_discover` | 6 |
| M50-RA | `accordo_voice_readAloud` | 13 |
| M50-DI | `accordo_voice_dictation` | 12 |
| M50-POL | `accordo_voice_setPolicy` | 13 |
| M50-SB | VoiceStatusBar | 14 |
| M50-VP | VoicePanelProvider | 16 |
| M50-EXT | Extension activation + wiring | 14 |
| **Total** | | **211** |
ENDOFFILE`, and this is the output of running that command instead:
voice >  cat > /Users/Shared/dev/accordo/docs/testing-guide-voice-10a.md << 'END
OFFILE'
heredoc> # Testing Guide — Session 10A: `accordo-voice` (M50-SP through M50-EXT)

heredoc> 
heredoc> **Date:** Session 10A + continuation  
heredoc> **Package:** `packages/voice/` (`accordo-voice`)  
heredoc> **Total automated tests:** 211  
heredoc> **Commits:** `1136d65` → `789b506`
heredoc> 
heredoc> ---
heredoc> 
heredoc> ## 1. Automated Tests (CI Gate)
heredoc> 
heredoc> Run before any manual testing:
heredoc> 
heredoc> ```bash
heredoc> pnpm --filter accordo-voice test
heredoc> ```
heredoc> 
heredoc> Expected output: `Tests  211 passed (211)`. If any fail, do not proceed
 to manual verification.
heredoc> 
heredoc> ---
heredoc> 
heredoc> ## 2. Provider Status
heredoc> 
heredoc> ### Whisper.cpp (STT) ✅ Installed
heredoc> 
heredoc> - Binary: `/opt/homebrew/bin/whisper` (whisper.cpp, native arm64)
heredoc> - Model: `/usr/local/share/whisper/ggml-base.en.bin`
heredoc> - Default VS Code settings (`accordo.voice.whisperPath: "whisper"`, `ac
cordo.voice.whisperModelFolder: "/usr/local/share/whisper"`, `accordo.voice.whis
perModel: "ggml-base.en.bin"`) match the installation — no configuration change 
needed.
heredoc> 
heredoc> ### kokoro-js (TTS) ❌ Not installed
heredoc> 
heredoc> `kokoro-js` is an optional run# Testing Guide — Session 10A: `accordo-v
oice` (M50-SP through M50-EXT)
heredoc> 
heredoc> **Do 
heredoc> **Date:** Session 10A + continuation  
heredoc> **Package:** `packages/voice/` (sta**Package:** `packages/voice/` (`acc
ogr**Total automated tests:** 211  
heredoc> **Commits:** `11ar**Commits:** `1136d65` → `789nd
heredoc> ---
heredoc> 
heredoc> ## 1. Automated Tests (CI Gatstartup.
heredoc> Run before any manual testinges 
heredoc> ```bash
heredoc> pnpm --filter accordthepnpm spa```
heredoc> 
heredoc> Expecteild`
heredoc> 2. Open VS Code 
heredoc> Eten
heredoc> ---
heredoc> 
heredoc> ## 2. Provider Status
heredoc> 
heredoc> ### Whisper.cpp (STT) ✅ Installed
heredoc> 
heredoc> - Binary: `/opt/homebrew/binfro
heredoc> #`pa
heredoc> ### Whisper.cpp (STnfi
heredoc> - Binary: `/opt/homebrew/bin/whisus - Model: `/usr/local/share/whisper/
ggml-base.en.bin`
heredoc> - Default Va - Default VS Code settings (`accordo.voice.whisperPgh
heredoc> ### kokoro-js (TTS) ❌ Not installed
heredoc> 
heredoc> `kokoro-js` is an optional run# Testing Guide — Session 10A: `accordo-v
oice` (M50-SP through M50-EXT)
heredoc> 
heredoc> **Do 
heredoc> **Date:** Session 10A + continuation  
heredoc> **Package:** `packages/voice/` (sta**Package:** `, `
heredoc> `kokoro-js` is an optional run# Tesspe
heredoc> **Do 
heredoc> **Date:** Session 10A + continuation  
heredoc> **Package:** `packages/voice/` (sta**Package:** `packagesynthesiz** tri
m-silence, dispose | 15 |
heredoc> | M50-F**Commits:** `11ar**Commits:** `1136d65` → `789nd
heredoc> ---
heredoc> 
heredoc> ## 1. Automated Tests (CI Gatstartup.
heredoc> Run beforeuc---
heredoc> 
heredoc> ## 1. Automated Tests (CI Gatstartup.
heredoc> Run bef M
heredoc> #-TCRun before any manual testinges 
heredoc> ``` <ffffffff>``bash
heredoc> pnpm --filter accordthe
heredoc> |pnpm SS 
heredoc> Expecteild`
heredoc> 2. Open VS Code 
heredoc> Etedet2. Open VS |Eten
heredoc> ---
heredoc> 
heredoc> ## 2.ic---ca
heredoc> #lar
heredoc> ### Whisper.cpp (STans
heredoc> - Binary: `/opt/homebrew/binfro
heredoc> #. U#`pa
heredoc> ### Whisper.cpp (STnfi
heredoc> - M5###XT- Binary: `/opt/homm th- Default Va - Default VS Code settings
 (`accordo.voice.whisperPgh
heredoc> ### kokoro-js (TTS) id### kokoro-js (TTS) ❌ Not installed
heredoc> 
heredoc> `kokoro-js` is an optionalta
heredoc> `kokoro-js` is an optional run# Tesost
heredoc> **Do 
heredoc> **Date:** Session 10A + continuation  
heredoc> **Package:** `packages/voice/` (sta**Package:** `, `
heredoc> `ko*Ex**Daed**Package:** `packages/voice/` (sta**Ac`kokoro-js` is an op
tional run# Tesspe
heredoc> **Do 
heredoc> **Dateer**Do 
heredoc> **Date:** Session 10A + continu<ffffffff>*Datp**Package:** `packages/vo
ice/` (sta**ic| M50-F**Commits:** `11ar**Commits:** `1136d65` → `789nd
heredoc> ---
heredoc> 
heredoc> ## 1. Automated Tests (CI Gatstll---
heredoc> 
heredoc> ## 1. Automated Tests (CI Gatstartup.
heredoc> Run beforeuc--nt
heredoc> #ostRun beforeuc---
heredoc> 
heredoc> ## 1. Automated TesVo
heredoc> ## 1. Automat NoRun bef M
heredoc> #-TCRun before any manual nn#-TCRun  p``` <ffffffff>``bashlability conf
irmed.
heredoc> 
heredoc> ### pnpm --fout B|pnpm SS 
heredoc> Expecteild`
heredoc> saExpecteior2. Open VS iEtedet2. Open V D---
heredoc> 
heredoc> ## 2.ic---ca
heredoc> #lael
heredoc> #d.
heredoc> #lar
heredoc> ### Whed### S- Binary: `/opt/homebma#. U#`pa
heredoc> ### Whisper.cpp (STnf V### Whimm- M5###XT- Binary: `/; ### kokoro-js (T
TS) id### kokoro-js (TTS) ❌ Not installed
heredoc> 
heredoc> `kokoro-js` is an optionalta
heredoc> `kokoro50
heredoc> `kokoroGoal:** Verify the status bar item reflects all voice`kokoro-js`
 is an optional Co**Do 
heredoc> **Date:** Session 10A + continu w**Dahr**Package:** `packages/voice/` (
sta**gg`ko*Ex**Daed**Package:** `packages/voice/` (sta**Acon**Do 
heredoc> **Dateer**Do 
heredoc> **Date:** Session 10A + continu<ffffffff>*Datp**Package:** `packages/vo
ice/le**Dace**Date:** Sece---
heredoc> 
heredoc> ## 1. Automated Tests (CI Gatstll---
heredoc> 
heredoc> ## 1. Automated Tests (CI Gatstartup.
heredoc> Run beforeuc--nt
heredoc> #ostRun beforeuc---
heredoc> 
heredoc> ## 1. Automated <ffffffff># |
heredoc> 
heredoc> ## 1. Automated Tests (CI Gatstartce:Run beforg…` |
heredoc> | Run **Pause Narrati#ostRun beforeu`<ffffffff>## 1. Automated T|
heredoc> |## 1. Automat NoRun `<ffffffff>-TCRun before any manuaCl
heredoc> ### pnpm --fout B|pnpm SS 
heredoc> Expecteild`
heredoc> saExpecteior2. Open VS iEtedlteExpecteild`
heredoc> saExpecteior2Click while **
heredoc> ## 2.ic---ca
heredoc> #lael
heredoc> #d.
heredoc> #lar
heredoc> ### Whed### S-
heredoc> 
heredoc> ##lael
heredoc> #d.
heredoc> #
heredoc> H#d.
heredoc>  o#lr ### s### Whisper.cpp (STnf V### Whimm- M5###XT- : 
heredoc> `kokoro-js` is an optionalta
heredoc> `kokoro50
heredoc> `kokoroGoal:** Verify the status bar item reflects all voice`kokoro-js`
 il (M50-VP)
heredoc> 
heredoc> **Goal:** Verify the`kokoroGeb**Date:** Session 10A + continu w**Dahr**
Package:** `packages/voice/` (sta**gg`ko*Ex**Daed**Ppe**Dateer**Do 
heredoc> **Date:** Session 10A + continu<ffffffff>*Datp**Package:** `packages/vo
ice/le**Dace**Date:** Sece---
heredoc> 
heredoc> ## 1. Automated Tests (CI ****Date:** Sek*
heredoc> ## 1. Automated Tests (CI Gatstll---
heredoc> 
heredoc> ## 1. Automated Tests (CI Gatstartup.
heredoc> Run beforeuc--nthe
heredoc> ## 1. Automated Tests (CI Gatstartk
heredoc> 
heredoc> Run lick and hold the mic button.
heredoc> 2. *#ostRun beforeuat
heredoc> ## 1. Automated <ffffffff>ce
heredoc> ## 1. Automated Testl l| Run **Pause Narrati#ostRun beforeu`<ffffffff>#
# 1. Automat
heredoc> 4|## 1. Automat NoRun `<ffffffff>-TCRun before any manuaCl
heredoc> ### pn<ffffffff><ffffffff>### pnpm --fout B|pnpm SS 
heredoc> Expecteild`
heredoc> saExpecteriExpecteild`
heredoc> saExpecteior2dlsaExpectei##saExpecteior2Click while **
heredoc> ## 2.ic---ca
heredoc> ti## 2.ic---ca
heredoc> #lael
heredoc> #d.
heredoc> #laas#lael
heredoc> #d.
heredoc> #. #d.
heredoc> e #ldi###la
heredoc> ##lael
heredoc> #d.
heredoc> #but#d.
heredoc> #ec#mes v o#bl`kokoro-js` is an optionalta
heredoc> `kokoro50
heredoc> `kokoroGoal:** Via`kokoro50
heredoc> `kokoroGoal:** Ve ``kokoroGce
heredoc> **Goal:** Verify the`kokoroGeb**Date:** Session 10A + continu w**Dahr**
Package:**nse**Date:** Session 10A + continu<ffffffff>*Datp**Package:** `package
s/voice/le**Dace**Date:** Sece---
heredoc> 
heredoc> ## 1. Automated Tests (CI ****Date:** Sek*em
heredoc> ## 1. Automated Tests (CI ****Date:** Sek*
heredoc> ## 1. Automated Tests (CI Gatstll---
heredoc> 
heredoc> ## 1. Auto` c## 1. Automated Tests (CI Gatstll---
heredoc> 
heredoc> ## af
heredoc> ## 1. Automated Tests (CI GatstartirmRun beforeuc--nthe
heredoc> ## 1. Automateching## 1. Automated Tlu
heredoc> Run lick and hold the mic button.t: 2. *#ostRun beforeuat
heredoc> ## 1. AutoT)
heredoc> 
heredoc> All commands are acc## 1. Automated Tesnd4|## 1. Automat NoRun `<ffffff
ff>-TCRun before any manuaCl
heredoc> ### pn<ffffffff><ffffffff>### pnpm --fout K### pn<ffffffff><ffffffff>##
# pnpm --fout B|pnpm SS 
heredoc> Expecteild`
heredoc> sacoExpecteild`
heredoc> saExpecteriExpecteild DsaExpecter `saExpecteior2dlsaExpeoc## 2.ic---ca
heredoc> ti## 2.ic---ca
heredoc> #lael
heredoc> #d.
heredoc> #laas#lael
heredoc> #d.
heredoc> loti## 2.ic--lt#lael
heredoc> #d.
heredoc> #laha#d.
heredoc> le#lion |
heredoc> | `acco#.o.voice.s##lael
heredoc> #d.on` | Sto#bNa#ec#men `kokoro50
heredoc> `kokoroGoal:** Via`kokoro50
heredoc> `kont`kokoroG`a`kokoroGoal:** Ve ``kokoron`**Goal:** Verify the`kokoroG
<ffffffff><ffffffff>
heredoc> ## 1. Automated Tests (CI ****Date:** Sek*em
heredoc> ## 1. Automated Tests (CI ****Date:** Sek*
heredoc> ## 1. Automated Tests (CI Gatstll---
heredoc> 
heredoc> ## 1. Auto` c## 1. Automated Tests (CI Gatstll---the## 1. Automated Tes
ts (CI ****Date:** Sek*
heredoc> ti## 1. Automated Tests (CI Gatstll---
heredoc> 
heredoc> ## ar
heredoc> ## 1. Auto` c## 1. Automated Testspea
heredoc> ## af
heredoc> ## 1. Automated Tests (CI Gatstartirm**Stop ## 1at## 1. Automateching##
 1. Automatedct some text in the edRun lick and hold the mic button.t:pect## 1. 
AutoT)
heredoc> 
heredoc> All commands are acc## 1. Automated Tesnd4.
heredoc> 
heredoc> All comman UI### pn<ffffffff><ffffffff>### pnpm --fout K### pn<ffffffff
><ffffffff>### pnpm --fout B|pnpm SS 
heredoc> Expecteild`
heredoc> sacoExpecteild`
heredoc> saonExpecteild`
heredoc> sacoExpecteild`
heredoc> saExpecteriExpecteild DsaExpecttsacoExpectulsaExpecteriExp|-ti## 2.ic--
-ca
heredoc> #lael
heredoc> #d.
heredoc> #laas#lael
heredoc> #d.
heredoc> loti## 2.ic--lt#lael
heredoc> #d.
heredoc> #lahpe#lael
heredoc> #d.
heredoc> #la | `/usr/loc#d.
heredoc> loti#whlope#d.
heredoc> #laha#d.
heredoc> le#lioce#lhile#lionel| `acco#l-#d.on` | Sto#bNa#ec#mendo`kokoroGoal:** 
Via`kokoro50
heredoc> `kondo`kon7 options) |
heredoc> | `accordo.## 1. Autod` | `1.0` (range 0.5–2.0) |
heredoc> | `accordo.voice.language` | `en-## 1. Automated Tests (CI ****Date:** 
Sek*
heredoc> rr## 1. Automated Tests (CI Gatstll---
heredoc> 
heredoc> ## .v
heredoc> ## 1. Auto` c## 1. Automated Testsr ati## 1. Automated Tests (CI Gatstl
l---
heredoc> 
heredoc> ## ar
heredoc> ## 1. Auto` c## 1. Automated Testspea
heredoc> ## af
heredoc> ## RA
heredoc> ## ar
heredoc> ## 1. Auto` c## 1. Automated T in## 1d ## af
heredoc> ## 1. Automated Tests (CI Gatsag## 1se
heredoc> All commands are acc## 1. Automated Tesnd4.
heredoc> 
heredoc> All comman UI### pn<ffffffff><ffffffff>### pnpm --fout K### pn<ffffffff
><ffffffff>### pnpm --falls `accordo_voice_discover`.  
heredoc> **Expected:** Response
heredoc> All comman UI### pn<ffffffff><ffffffff>### pnpm --fout K###ttAExpecteil
d`
heredoc> sacoExpecteild`
heredoc> saonExpecteild`
heredoc> sacoExpecteild`
heredoc> saExpecteriAssacoExpectthsaonExpecteildo,sacoExpecteildt.saExpecteriExp
d:#lael
heredoc> #d.
heredoc> #laas#lael
heredoc> #d.
heredoc> loti## 2.ic--lt#lael
heredoc> #d.
heredoc> #lahpe#lael
heredoc> #d.
heredoc> #la | `o #d.
heredoc> y.#l###d.
heredoc> loti#onloM5#d.
heredoc> #lahpe#lael
heredoc> #d. d#lta#d.
heredoc> #la | **Expeloti#whlope#d.
heredoc> #lr #laha#d.
heredoc> le#le:le#liocin`kondo`kon7 options) |
heredoc> | `accordo.## 1. Autod` | `1.0` (range 0.5–2.xpected:** Tra| `accordo.#
# 1. Autour| `accordo.voice.language` | `en-## 1. Automated T)
heredoc> rr## 1. Automated Tests (CI Gatstll---
heredoc> 
heredoc> ## .v
heredoc> ## 1. Auto` c## 1. Automatedxp
heredoc> ## .v
heredoc> ## 1. Auto` c## 1. Automated To `## 1d:
heredoc> ## ar
heredoc> ## 1. Auto` c## 1. Automated Testspea
heredoc> ## af
heredoc> ## RA
heredoc> ## ar
heredoc> ## 1. Auto`equ## 1es## af
heredoc> ## RA
heredoc> ## ar
heredoc> ## 1. Auto` c## 1. c## Rct## a
heredoc> 1## 1en## 1. Automated Tests (CI Gatsag## 1se
heredoc> All ckAll commands are acc## 1. Automated Tmd
heredoc> All comman UI### pn<ffffffff><ffffffff>### pnpm --fout K###xpe**Expecte
d:** Response
heredoc> All comman UI### pn<ffffffff><ffffffff>### pnpm --fout K###ttAExpecteil
d`
heredoc> sacoExpectayAll comman UI### pn<ffffffff><ffffffff><ffffffff> sacoExpec
teild`
heredoc> saonExpecteild`
heredoc> sacoExpecteild`
heredoc> saExpebusaonEin the VoicsacoExpecteildExsaExpecteriAsso #d.
heredoc> #laas#lael
heredoc> #d.
heredoc> loti## 2.ic--lt#lael
heredoc> #d.
heredoc> #lahpe#lael
heredoc> #d.
heredoc> #la | `o #d.
heredoc> y.#lat#ln*#d.
heredoc> loti#ealoa #d.
heredoc> #lahpe#lael
heredoc> #d.7.#l*E#d.
heredoc> #la |  T#lnsy.#l###d.
heredoc> lneloti#onlnt#lahpe#lael
heredoc> # O#d. d#lta#ne#la | **Expge#lr #laha#d.
heredoc> le#le:le#liummle#le:le#li
heredoc> 9| `accordo.## 1. Autod` | `1.0` (ranR`rr## 1. Automated Tests (CI Gats
tll---
heredoc> 
heredoc> ## .v
heredoc> ## 1. Auto` c## 1. Automatedxp
heredoc> ## .v
heredoc> ## 1. Auto` c## 1. Automated To `## 1d:
heredoc> ## ar
heredoc> ## 1. i
heredoc> ## .v
heredoc> ## 1. Auto` c## 1. Automatedxp|--## 1 M## .v
heredoc> ## 1. Auto` c## 1. Auto <ffffffff># 1
heredoc> |#M50-WA | WhisperCppAdapter | 14 |
heredoc> | M50## 1| ## af
heredoc> ## RA
heredoc> ## ar
heredoc> ## 1. Auto`equ## 1si## Rm ## adi## 1 /## RA
heredoc> ## ar
heredoc> ## 1. Auto` 50## a |## 1 b1## r + playback subprocess | 1All ckAll comm
ands are acc## 1. Automated Tm
heredoc> |All comman UI### pn<ffffffff><ffffffff>### pnpm --fout K###xpe VAll co
mman UI### pn<ffffffff><ffffffff>### pnpm --fout K###ttAExpecteild`
heredoc> sacoExpec| sacoRA | `accordo_voice_readAloud` | 13 |
heredoc> | M50-DI | `acsaonExpecteild`
heredoc> sacoExpecteild`
heredoc> saExpebusaonEin to_sacoExpecteildy`saExpebusaonEiSB#laas#lael
heredoc> #d.
heredoc> loti## 2.ic--lt#lael
heredoc> #d.
heredoc> #lahpe#lael
heredoc> #d.
heredoc> #l6 #d.
heredoc> loti#XTlo E#d.
heredoc> #lahpe#lael
heredoc> #d. +#lir#d.
heredoc> #la | 
heredoc> |#l*Ty.#lat#ln*#**loti#ealoa #FF#lah