# Accordo Script — Requirements

**Module series:** M52 (`accordo-script`)  
**Session:** 10D  
**Status:** COMPLETE — Phase F  
**Date:** 2026-03-11  
**Architecture ref:** `docs/voice-architecture.md` ADR-04 (separation rationale), `docs/architecture.md` §13

---

## 1. Goal

Give the agent (and the human) the ability to program multi-step IDE experiences as
a single declarative script: speak text aloud, show subtitles, navigate to a file,
highlight code, trigger any VS Code command, and wait between steps — all without
further MCP round-trips.

Scripts are authored by the agent in one shot and executed autonomously by
`accordo-script`. The modality is designed to be **voice-optional**: if
`accordo-voice` is installed, `speak` steps synthesise audio; without it, the
same step shows a subtitle banner and continues. This means automated demos,
code walkthroughs, and teaching sequences work on any machine regardless of audio
setup.

**Key extensibility principle:** The `command` step type calls
`vscode.commands.executeCommand` with any command ID. Because every Accordo
modality (comments, presentations, diagrams, browser, …) registers VS Code
commands for its user-facing operations, the `command` step provides full
scriptability of all present and future modalities with zero changes to
`accordo-script` itself.

---

## 2. Scope

### In scope (Session 10D)
- `NarrationScript` JSON format + structural validation
- `ScriptRunner` — sequential step executor with cancellation and error policy
- `ScriptSubtitleBar` — status bar subtitle display (voice fallback + explicit subtitle steps)
- Three MCP tools: `accordo_script_run`, `accordo_script_stop`, `accordo_script_status`
- Extension wiring in a new `accordo-script` VS Code extension
- Small prerequisite addition to `accordo-voice`: `accordo.voice.speakText` command

### Out of scope
- Parallel step execution (all steps are sequential)
- Conditional branching / loops within a script
- Script persistence / named script library
- Subtitle WebviewPanel (status bar sufficient for MVP)
- Scripted walkthroughs UI editor (future)

---

## 3. New Package

**`packages/script/`** — `accordo-script` VS Code extension.

```
packages/script/
├── package.json              # accordo-script VS Code extension manifest
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── extension.ts          # activate / deactivate
    ├── script-types.ts       # NarrationScript, ScriptStep types + validateScript()
    ├── script-runner.ts      # ScriptRunner class
    ├── subtitle-bar.ts       # ScriptSubtitleBar
    └── tools/
        ├── run-script.ts     # createRunScriptTool()
        ├── stop-script.ts    # createStopScriptTool()
        └── script-status.ts  # createScriptStatusTool()
```

Extension manifest key fields:
- `name`: `accordo-script`
- `extensionKind`: `["workspace"]`
- `activationEvents`: `["onStartupFinished"]`
- `extensionDependencies`: `["accordo.accordo-bridge"]`
- VS Code commands: `accordo.script.stop`

---

## 4. Script Format — M52-FMT

### 4.1 NarrationScript type

```typescript
interface NarrationScript {
  /**
   * Ordered list of steps to execute sequentially.
   * M52-FMT-01: 1 ≤ steps.length ≤ 200
   */
  steps: ScriptStep[];

  /**
   * Error policy. Default: "abort".
   * "abort"  — first step error stops the whole script and reports the error.
   * "skip"   — step errors are logged; execution continues with the next step.
   */
  errPolicy?: "abort" | "skip";

  /** Human-readable label, shown in status bar and tool response. */
  label?: string;
}
```

### 4.2 ScriptStep union

```typescript
type ScriptStep =
  | SpeakStep
  | SubtitleStep
  | CommandStep
  | DelayStep
  | HighlightStep
  | ClearHighlightsStep;
```

#### SpeakStep
Synthesise text using the voice extension (if available) or fall back to the
subtitle bar.

```typescript
interface SpeakStep {
  type: "speak";

  /** Text to speak aloud. Non-empty, ≤ 10 000 chars. */
  text: string;

  /** Voice ID override (e.g. "am_adam"). Uses voice policy default if absent. */
  voice?: string;

  /**
   * Playback speed override (0.5–2.0). Uses voice policy default if absent.
   * M52-FMT-04: if present, must be 0.5–2.0 inclusive.
   */
  speed?: number;

  /**
   * Whether to wait for TTS playback to finish before the next step.
   * Default: true.  block: false starts TTS and immediately moves on.
   */
  block?: boolean;
}
```

**Fallback behaviour (M52-SR-07):**  
When voice extension is not available or TTS is not installed:
`durationMs = Math.max(2000, wordCount * 250)`, show subtitle for that duration.

#### SubtitleStep
Show text in the subtitle bar without any TTS, for a fixed duration.

```typescript
interface SubtitleStep {
  type: "subtitle";

  /** Text to display. Non-empty, ≤ 500 chars. */
  text: string;

  /**
   * How long to show the subtitle (ms).
   * Default: Math.max(2000, wordCount * 250).
   */
  durationMs?: number;
}
```

#### CommandStep
Execute any VS Code command by ID.  
**This is the primary extensibility point** — scripts can call commands from
any installed Accordo modality (or any VS Code extension) without changes to
`accordo-script`.

```typescript
interface CommandStep {
  type: "command";

  /**
   * VS Code command ID (e.g. "accordo.presentation.goto", "vscode.open",
   * "accordo.diagram.goto" [future]).
   * M52-FMT-05: non-empty string.
   */
  command: string;

  /**
   * Arguments passed verbatim to vscode.commands.executeCommand.
   * Must be JSON-serialisable.
   */
  args?: unknown;
}
```

#### DelayStep
Pause execution for a fixed number of milliseconds.

```typescript
interface DelayStep {
  type: "delay";

  /**
   * Milliseconds to wait. 1–30 000 (max 30 s per step).
   * M52-FMT-02: ms > 30 000 is a validation error.
   */
  ms: number;
}
```

#### HighlightStep
Scroll to and decorate a range of lines in a file.

```typescript
interface HighlightStep {
  type: "highlight";

  /**
   * File path — workspace-relative or absolute.
   * M52-FMT-06: non-empty string.
   */
  file: string;

  /**
   * 1-based start line. M52-FMT-07: ≥ 1.
   */
  startLine: number;

  /**
   * 1-based end line (inclusive). M52-FMT-07: ≥ startLine.
   * M52-FMT-08: endLine − startLine ≤ 500.
   */
  endLine: number;

  /**
   * Auto-clear the decoration after this many ms.
   * Absent: decoration persists until a clear-highlights step or end of script.
   */
  durationMs?: number;
}
```

#### ClearHighlightsStep
Remove all script-managed decorations.

```typescript
interface ClearHighlightsStep {
  type: "clear-highlights";
}
```

### 4.3 Validation rules (M52-FMT requirements)

| ID | Rule |
|---|---|
| M52-FMT-01 | `steps` array length 1–200 |
| M52-FMT-02 | `delay.ms` 1–30 000 |
| M52-FMT-03 | `speak.text` non-empty, ≤ 10 000 chars |
| M52-FMT-04 | `speak.speed`, if present, 0.5–2.0 |
| M52-FMT-05 | `command.command` non-empty string |
| M52-FMT-06 | `highlight.file` non-empty string |
| M52-FMT-07 | `highlight.startLine` ≥ 1; `endLine` ≥ `startLine` |
| M52-FMT-08 | `highlight.endLine − startLine` ≤ 500 |
| M52-FMT-09 | Sum of all `delay.ms` values ≤ 300 000 (5 min total) |
| M52-FMT-10 | `validateScript()` returns `ValidationResult { valid: boolean; errors: string[] }` |
| M52-FMT-11 | `speak.text` length ≤ 10 000 |
| M52-FMT-12 | `subtitle.text` non-empty, ≤ 500 chars |

### 4.4 `validateScript()` signature

```typescript
function validateScript(raw: unknown): ValidationResult;

interface ValidationResult {
  valid: boolean;
  errors: string[];  // empty when valid
}
```

`raw` is an arbitrary `unknown` value (as received from the MCP tool argument).
The function parses and validates the entire structure, accumulating all errors
before returning. It does NOT throw.

---

## 5. ScriptRunner — M52-SR

### 5.1 State machine

```
idle  ──run()──►  running  ──completed──►  completed
                     │
                   stop()  ──►  stopping  ──►  stopped
                     │
                   error   ──────────────────►  error
```

`stop()` is safe to call from any state. If called in `completed` / `stopped` /
`error`, it is a no-op.

### 5.2 Dependencies (injectable interface)

```typescript
interface ScriptRunnerDeps {
  /**
   * Execute a VS Code command. Wraps vscode.commands.executeCommand.
   * Injectable so tests don't need a real VS Code environment.
   */
  executeCommand(command: string, args?: unknown): Promise<unknown>;

  /**
   * Synthesise and speak text via the voice extension.
   * Absent when voice extension is not available.
   */
  speakText?: (
    text: string,
    opts: { voice?: string; speed?: number; block: boolean },
  ) => Promise<void>;

  /**
   * Show a subtitle in the status bar for the given duration.
   */
  showSubtitle(text: string, durationMs: number): void;

  /**
   * Open file and add line highlights. Resolves when the editor is visible.
   */
  openAndHighlight(
    file: string,
    startLine: number,
    endLine: number,
  ): Promise<void>;

  /**
   * Remove all script-managed highlight decorations.
   */
  clearHighlights(): void;

  /**
   * Wait for the given number of milliseconds.
   * Injectable so tests can use fake timers.
   */
  wait(ms: number): Promise<void>;
}
```

### 5.3 Progress events

```typescript
interface ScriptRunnerCallbacks {
  /** Called before each step executes. stepIndex is 0-based. */
  onStepStart?: (stepIndex: number, step: ScriptStep) => void;
  /** Called after each step completes successfully. */
  onStepComplete?: (stepIndex: number, step: ScriptStep) => void;
  /** Called when the entire script finishes without error or cancel. */
  onComplete?: () => void;
  /** Called when execution stops (error or cancel). */
  onStop?: (reason: "error" | "cancelled", stepIndex: number, err?: Error) => void;
}
```

### 5.4 Requirements

| ID | Requirement |
|---|---|
| M52-SR-01 | Steps execute strictly sequentially; step N+1 starts only after step N's promise resolves |
| M52-SR-02 | `speak` with `block: false` — deps.speakText is called but NOT awaited; step resolves immediately |
| M52-SR-03 | `speak` with `block: true` (default) — step awaits deps.speakText before resolving |
| M52-SR-04 | `speak` fallback: if deps.speakText is absent, call deps.showSubtitle(text, estimatedMs) and await the duration |
| M52-SR-05 | Subtitle estimated duration: `Math.max(2000, wordCount(text) * 250)` ms |
| M52-SR-06 | `errPolicy: "abort"` (default): first step error calls onStop("error", stepIndex, err) and halts |
| M52-SR-07 | `errPolicy: "skip"`: step errors are caught and logged; execution continues with next step |
| M52-SR-08 | `stop()` sets a cancellation flag; checked between each step; current step always completes |
| M52-SR-09 | `stop()` returns a Promise that resolves when execution has fully stopped |
| M52-SR-10 | `command` step calls deps.executeCommand(step.command, step.args) |
| M52-SR-11 | `highlight` step calls deps.openAndHighlight; if durationMs present, schedules deps.clearHighlights |
| M52-SR-12 | `clear-highlights` step calls deps.clearHighlights() |
| M52-SR-13 | `delay` step calls deps.wait(step.ms) |
| M52-SR-14 | `subtitle` step calls deps.showSubtitle(text, durationMs ?? estimatedMs) and awaits the duration |
| M52-SR-15 | Runner state transitions are synchronous and immediately visible via `.state` getter |
| M52-SR-16 | `run()` on a non-idle runner throws `Error("ScriptRunner already running")` |
| M52-SR-17 | After `completed`, `stopped`, or `error` — run() can be called again (runner is re-usable) |
| M52-SR-18 | All async execution happens inside the same async task — no setInterval, no unhandled Promises |

---

## 6. ScriptSubtitleBar — M52-SUB

### 6.1 Responsibility

Shows a brief text overlay in the VS Code status bar during `speak` fallback and
`subtitle` steps.

### 6.2 Requirements

| ID | Requirement |
|---|---|
| M52-SUB-01 | Uses `vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 500)` |
| M52-SUB-02 | `show(text, durationMs)` sets `item.text = "$(comment) " + text` and calls `item.show()` |
| M52-SUB-03 | After `durationMs`, calls `item.hide()` automatically |
| M52-SUB-04 | Calling `show()` while already visible resets the auto-hide timer |
| M52-SUB-05 | `clear()` hides the item immediately and cancels any pending auto-hide |
| M52-SUB-06 | `dispose()` calls `clear()` then `item.dispose()` |
| M52-SUB-07 | The status bar item has a fixed `tooltip` of `"Accordo Script — subtitle"` |

---

## 7. MCP Tools — M52-TOOL

### Tool: `accordo_script_run`

```
name:        accordo_script_run
description: Execute a scripted walkthrough — a sequence of speak, subtitle,
             command, delay, and highlight steps. Returns immediately with a
             scriptId; use accordo_script_status to track progress.
group:       script
dangerLevel: safe
idempotent:  false
```

Input schema:
```json
{
  "type": "object",
  "required": ["script"],
  "properties": {
    "script": {
      "type": "object",
      "description": "NarrationScript object with steps array, optional errPolicy, optional label"
    }
  }
}
```

Success response: `{ scriptId: string; started: true; steps: number; label?: string }`  
Validation error: `{ error: string }` (invalid script — details in `error` field)  
Busy error: `{ error: "A script is already running. Call accordo_script_stop first." }`

| ID | Requirement |
|---|---|
| M52-TOOL-01 | Validates the script argument via `validateScript()`; returns `{ error }` if invalid |
| M52-TOOL-02 | If a script is currently in `"running"` state, returns busy error without starting |
| M52-TOOL-03 | Assigns a fresh `scriptId` (UUID or incrementing string), starts execution fire-and-forget |
| M52-TOOL-04 | Returns response in < 10ms (does not await any step execution) |

### Tool: `accordo_script_stop`

```
name:        accordo_script_stop
description: Stop the currently running script. Safe to call when no script is running.
group:       script
dangerLevel: safe
idempotent:  true
```

No required input parameters.

Response: `{ stopped: boolean; wasRunning: boolean }`

| ID | Requirement |
|---|---|
| M52-TOOL-05 | Calls runner.stop() — idempotent; never throws |
| M52-TOOL-06 | `wasRunning: true` if the runner was in "running" state when called |
| M52-TOOL-07 | The response is returned immediately; does not await full stop |

### Tool: `accordo_script_status`

```
name:        accordo_script_status
description: Get the current state of the script runner — state, step progress, label.
group:       script
dangerLevel: safe
idempotent:  true
```

No required input parameters.

Response:
```typescript
{
  state: ScriptRunnerState;         // "idle"|"running"|"stopping"|"stopped"|"completed"|"error"
  currentStep: number;              // 0-based (-1 when idle)
  totalSteps: number;               // 0 when idle
  label?: string;                    // from NarrationScript.label
  scriptId?: string;                // current or most-recently-run scriptId
  error?: string;                   // set when state === "error"
}
```

| ID | Requirement |
|---|---|
| M52-TOOL-08 | Returns current runner state without side effects |
| M52-TOOL-09 | When state is "idle" and no script has run: currentStep = -1, totalSteps = 0 |

### Registration

| ID | Requirement |
|---|---|
| M52-TOOL-10 | All three tools registered via `bridge.registerTools('accordo.accordo-script', [...])` |
| M52-TOOL-11 | All tools are in group `"script"` and dangerLevel `"safe"` |

---

## 8. Extension Wiring — M52-EXT

| ID | Requirement |
|---|---|
| M52-EXT-01 | Extension activates on `"onStartupFinished"` |
| M52-EXT-02 | Acquire BridgeAPI via `vscode.extensions.getExtension('accordo.accordo-bridge')?.exports` |
| M52-EXT-03 | Create and register `ScriptSubtitleBar` (added to `context.subscriptions`) |
| M52-EXT-04 | Wire `ScriptRunnerDeps.executeCommand` = `vscode.commands.executeCommand` |
| M52-EXT-05 | Wire `ScriptRunnerDeps.speakText`: if `accordo.accordo-voice` extension is installed, call `vscode.commands.executeCommand('accordo.voice.speakText', { text, voice, speed, block })`; otherwise leave absent |
| M52-EXT-06 | Wire `ScriptRunnerDeps.showSubtitle` = `subtitleBar.show` |
| M52-EXT-07 | Wire `ScriptRunnerDeps.openAndHighlight`: open file via `vscode.workspace.openTextDocument` + `vscode.window.showTextDocument`, then apply a `TextEditorDecorationType` to the line range |
| M52-EXT-08 | Wire `ScriptRunnerDeps.clearHighlights`: dispose active decoration type; creates fresh one on next highlight |
| M52-EXT-09 | Wire `ScriptRunnerDeps.wait` = `(ms) => new Promise(r => setTimeout(r, ms))` |
| M52-EXT-10 | Register VS Code command `accordo.script.stop` → calls runner.stop() |
| M52-EXT-11 | Publish script state to Hub: `bridge.publishState('accordo.accordo-script', { state, currentStep, totalSteps, label })` — called on each `onStepComplete`, `onComplete`, `onStop` |
| M52-EXT-12 | Graceful degradation: if bridge unavailable, log and continue (commands still registered) |
| M52-EXT-13 | `deactivate()`: stop any running script and dispose subtitle bar |

---

## 9. Voice Extension Prerequisite — M52-VS

A small addition to `packages/voice/` to enable M52-EXT-05.

| ID | Requirement |
|---|---|
| M52-VS-01 | Register VS Code command `accordo.voice.speakText` in `packages/voice/src/extension.ts` |
| M52-VS-02 | Arguments: `{ text: string; voice?: string; speed?: number; block?: boolean }` |
| M52-VS-03 | If TTS provider is not available → return silently (no error) |
| M52-VS-04 | `block: true` (default) → synthesise text and await `playPcmAudio` before returning |
| M52-VS-05 | `block: false` → fire-and-forget synthesis + playback; command returns immediately |
| M52-VS-06 | Command is an internal command — not contributed in `contributes.commands`, registered programmatically only |
| M52-VS-07 | Registered unconditionally at activation; `doSpeakText` checks TTS availability at call time (M52-VS-03) |
| M52-VS-08 | `block: true` case handles text cleaning (applies `cleanTextForNarration("narrate-full")`) |

---

## 10. Module Summary

| Module | File | Tests (est.) | Requirements |
|---|---|---|---|
| M52-FMT | `script-types.ts` | 20 | M52-FMT-01 … M52-FMT-12 |
| M52-SR | `script-runner.ts` | 40 | M52-SR-01 … M52-SR-18 |
| M52-SUB | `subtitle-bar.ts` | 10 | M52-SUB-01 … M52-SUB-07 |
| M52-TOOL | `tools/*.ts` | 20 | M52-TOOL-01 … M52-TOOL-11 |
| M52-EXT | `extension.ts` | 15 | M52-EXT-01 … M52-EXT-13 |
| M52-VS | voice `extension.ts` | 6 | M52-VS-01 … M52-VS-08 |
| **Total** | | **~111** | |

---

## 11. Integration with Future Modalities

**No changes to `accordo-script` are needed to support future modalities.**

Scripts use `command` steps to call VS Code commands. As each new Accordo modality is built, it should follow the convention of registering VS Code commands for operations that are meaningful in a script context:

| Future modality | Example scriptable commands |
|---|---|
| `accordo-diagram` (Session 11) | `accordo.diagram.goto`, `accordo.diagram.open`, `accordo.diagram.highlight` |
| `accordo-browser` (Session 12+) | `accordo.browser.navigate`, `accordo.browser.highlight` |
| Any VS Code command | `vscode.open`, `workbench.action.gotoLine`, `editor.action.selectAll`, … |

The agent authors scripts using the exact command IDs provided in the system prompt or discovered via `accordo_editor_discover` / modality-specific discover tools.

---

## 12. Acceptance Criteria

A Session 10D completion requires:

1. `pnpm test` passes in `packages/script` (all ~111 tests green)
2. `pnpm test` passes in `packages/voice` (M52-VS tests green, ≥ 6 new)
3. TypeScript compilation clean across all packages
4. End-to-end: agent calls `accordo_script_run` with a 3-step script (speak + highlight + command); Hub routes to accordo-script; ScriptRunner executes all 3 steps; `accordo_script_status` shows `completed`
5. Voice fallback: same script with voice extension absent → speak step shows subtitle bar, no error
