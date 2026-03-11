/**
 * script-types.ts
 *
 * All public types for the accordo-script package:
 * NarrationScript, ScriptStep union, ScriptState, validation result.
 *
 * M52-FMT — Script Format & Validation
 */

// ── Step types ────────────────────────────────────────────────────────────────

/** Speak text aloud via voice extension (falls back to subtitle if unavailable). */
export interface SpeakStep {
  type: "speak";
  text: string;
  /** Override per-step voice ID (e.g. "af_sarah"). */
  voice?: string;
  /** Override per-step TTS speed multiplier (default 1.0). */
  speed?: number;
  /**
   * When true, execution pauses until speech finishes before continuing.
   * Defaults to true.
   */
  block?: boolean;
}

/** Show a subtitle in the status bar for a fixed duration. */
export interface SubtitleStep {
  type: "subtitle";
  text: string;
  /** Duration in milliseconds (default 3000). */
  durationMs?: number;
}

/**
 * Execute any VS Code command by ID with optional arguments.
 * This is the primary extensibility mechanism — works for all current
 * and future modality commands (diagrams, browser, etc.) without
 * any changes to accordo-script.
 */
export interface CommandStep {
  type: "command";
  command: string;
  /** Serialisable arguments forwarded to vscode.commands.executeCommand. */
  args?: unknown;
}

/** Wait for a fixed number of milliseconds before continuing. */
export interface DelayStep {
  type: "delay";
  /** Milliseconds to wait (1–30 000). M52-FMT-02: ms > 30 000 is a validation error. */
  ms: number;
}

/** Open a file and highlight a range of lines. */
export interface HighlightStep {
  type: "highlight";
  /** Workspace-relative or absolute path to the file. M52-FMT-06: non-empty. */
  file: string;
  /** 1-based start line. M52-FMT-07: ≥ 1. */
  startLine: number;
  /** 1-based end line (inclusive). M52-FMT-07: ≥ startLine; M52-FMT-08: endLine − startLine ≤ 500. */
  endLine: number;
  /**
   * Auto-clear the decoration after this many ms.
   * Absent: decoration persists until a clear-highlights step or end of script.
   */
  durationMs?: number;
}

/** Clear all highlight decorations applied by previous highlight steps. */
export interface ClearHighlightsStep {
  type: "clear-highlights";
}

/** Discriminated union of all supported step types. */
export type ScriptStep =
  | SpeakStep
  | SubtitleStep
  | CommandStep
  | DelayStep
  | HighlightStep
  | ClearHighlightsStep;

// ── Script format ─────────────────────────────────────────────────────────────

/** A complete narration script: metadata + ordered step list. */
export interface NarrationScript {
  /**
   * Ordered list of steps to execute sequentially.
   * M52-FMT-01: 1 ≤ steps.length ≤ 200
   */
  steps: ScriptStep[];

  /**
   * Error policy. Default: "abort".
   * "abort" — first step error stops the whole script.
   * "skip"  — step errors are logged and execution continues.
   */
  errPolicy?: "abort" | "skip";

  /** Human-readable label shown in status and tool responses. */
  label?: string;
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a NarrationScript and return structured errors.
 * Does NOT throw — always returns a ValidationResult.
 *
 * M52-FMT-01 through M52-FMT-12
 */
export function validateScript(script: unknown): ValidationResult {
  const errors: string[] = [];

  if (script === null || typeof script !== "object" || Array.isArray(script)) {
    errors.push("script must be a non-null object");
    return { valid: false, errors };
  }

  const s = script as Record<string, unknown>;

  // M52-FMT-01: steps array 1–200
  if (!Array.isArray(s.steps)) {
    errors.push("steps must be an array");
    return { valid: false, errors };
  }
  if (s.steps.length < 1) {
    errors.push("steps array must have at least 1 entry");
  }
  if (s.steps.length > 200) {
    errors.push(`steps array must have at most 200 entries (got ${s.steps.length})`);
  }

  // Validate individual steps and accumulate errors
  let totalDelayMs = 0;

  for (let i = 0; i < s.steps.length; i++) {
    const step = s.steps[i] as Record<string, unknown> | null | undefined;
    if (step === null || typeof step !== "object") {
      errors.push(`step[${i}]: must be an object`);
      continue;
    }

    switch (step.type) {
      case "speak": {
        // M52-FMT-03 / M52-FMT-11: text non-empty, ≤ 10 000 chars
        if (typeof step.text !== "string" || step.text.length === 0) {
          errors.push(`step[${i}] speak: text must be a non-empty string`);
        } else if (step.text.length > 10000) {
          errors.push(`step[${i}] speak: text must be ≤ 10 000 characters`);
        }
        // M52-FMT-04: speed 0.5–2.0
        if (step.speed !== undefined) {
          if (typeof step.speed !== "number" || step.speed < 0.5 || step.speed > 2.0) {
            errors.push(`step[${i}] speak: speed must be between 0.5 and 2.0`);
          }
        }
        break;
      }

      case "subtitle": {
        // M52-FMT-12: text non-empty, ≤ 500 chars
        if (typeof step.text !== "string" || step.text.length === 0) {
          errors.push(`step[${i}] subtitle: text must be a non-empty string`);
        } else if (step.text.length > 500) {
          errors.push(`step[${i}] subtitle: text must be ≤ 500 characters`);
        }
        break;
      }

      case "command": {
        // M52-FMT-05: command non-empty
        if (typeof step.command !== "string" || step.command.length === 0) {
          errors.push(`step[${i}] command: command must be a non-empty string`);
        }
        break;
      }

      case "delay": {
        // M52-FMT-02: ms 1–30 000
        if (typeof step.ms !== "number" || !Number.isFinite(step.ms) || step.ms < 1 || step.ms > 30000) {
          errors.push(`step[${i}] delay: ms must be an integer between 1 and 30 000`);
        } else {
          totalDelayMs += step.ms;
        }
        break;
      }

      case "highlight": {
        // M52-FMT-06: file non-empty
        if (typeof step.file !== "string" || step.file.length === 0) {
          errors.push(`step[${i}] highlight: file must be a non-empty string`);
        }
        // M52-FMT-07: startLine ≥ 1, endLine ≥ startLine
        const sl = step.startLine as number;
        const el = step.endLine as number;
        if (typeof sl !== "number" || sl < 1) {
          errors.push(`step[${i}] highlight: startLine must be ≥ 1`);
        }
        if (typeof el !== "number" || (typeof sl === "number" && el < sl)) {
          errors.push(`step[${i}] highlight: endLine must be ≥ startLine`);
        }
        // M52-FMT-08: span ≤ 500 lines
        if (typeof sl === "number" && typeof el === "number" && el - sl > 500) {
          errors.push(`step[${i}] highlight: line span must be ≤ 500`);
        }
        break;
      }

      case "clear-highlights":
        // no fields to validate
        break;

      default:
        errors.push(`step[${i}]: unknown step type "${String(step.type)}"`);
    }
  }

  // M52-FMT-09: total delay budget ≤ 300 000 ms
  if (totalDelayMs > 300000) {
    errors.push(`total delay budget exceeds 300 000 ms (got ${totalDelayMs} ms)`);
  }

  return { valid: errors.length === 0, errors };
}

// ── Runner state ──────────────────────────────────────────────────────────────

export type ScriptState = "idle" | "running" | "stopping" | "completed" | "stopped" | "error";

export interface ScriptStatus {
  state: ScriptState;
  /** 0-based index of the current step; -1 when idle. */
  currentStep: number;
  /** Total steps in the running script; 0 when idle. */
  totalSteps: number;
  /** From NarrationScript.label, if provided. */
  label?: string;
  /** Assigned when a script starts; persists until next run. */
  scriptId?: string;
  /** Set when state === "error". */
  error?: string;
}
