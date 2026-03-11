/**
 * M52-FMT — validateScript() tests (Phase B — must FAIL before implementation)
 * Coverage: M52-FMT-01 through M52-FMT-12
 */

import { describe, it, expect } from "vitest";
import { validateScript } from "../script-types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const CLEAR: object = { type: "clear-highlights" };
const SPEAK = (text: string, extra: object = {}): object => ({ type: "speak", text, ...extra });
const SUBTITLE = (text: string, extra: object = {}): object => ({ type: "subtitle", text, ...extra });
const DELAY = (ms: number): object => ({ type: "delay", ms });
const CMD = (command: string): object => ({ type: "command", command });
const HL = (file: string, startLine: number, endLine: number): object => ({
  type: "highlight", file, startLine, endLine,
});

// ── M52-FMT-10: return shape ──────────────────────────────────────────────────

describe("M52-FMT-10 ValidationResult shape", () => {
  it("never throws — returns object for any input", () => {
    expect(() => validateScript(null)).not.toThrow();
    expect(() => validateScript(undefined)).not.toThrow();
    expect(() => validateScript("string")).not.toThrow();
    expect(() => validateScript(42)).not.toThrow();
  });

  it("returns { valid: boolean, errors: string[] }", () => {
    const r = validateScript(null);
    expect(typeof r.valid).toBe("boolean");
    expect(Array.isArray(r.errors)).toBe(true);
  });

  it("valid=true gives empty errors array", () => {
    const { valid, errors } = validateScript({ steps: [CLEAR] });
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("invalid returns errors describing problems", () => {
    const { valid, errors } = validateScript({ steps: [] });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
    expect(typeof errors[0]).toBe("string");
  });
});

// ── M52-FMT-01: steps array 1–200 ────────────────────────────────────────────

describe("M52-FMT-01 steps array length", () => {
  it("null input is invalid", () => {
    expect(validateScript(null).valid).toBe(false);
  });

  it("missing steps is invalid", () => {
    expect(validateScript({}).valid).toBe(false);
  });

  it("empty steps array is invalid", () => {
    expect(validateScript({ steps: [] }).valid).toBe(false);
  });

  it("steps array with 1 entry is valid", () => {
    expect(validateScript({ steps: [CLEAR] }).valid).toBe(true);
  });

  it("steps array with 200 entries is valid", () => {
    const steps = Array.from({ length: 200 }, () => CLEAR);
    expect(validateScript({ steps }).valid).toBe(true);
  });

  it("steps array with 201 entries is invalid", () => {
    const steps = Array.from({ length: 201 }, () => CLEAR);
    expect(validateScript({ steps }).valid).toBe(false);
  });
});

// ── M52-FMT-02: delay.ms 1–30 000 ────────────────────────────────────────────

describe("M52-FMT-02 delay.ms range", () => {
  it("delay.ms of 1 is valid", () => {
    expect(validateScript({ steps: [DELAY(1)] }).valid).toBe(true);
  });

  it("delay.ms of 30 000 is valid", () => {
    expect(validateScript({ steps: [DELAY(30000)] }).valid).toBe(true);
  });

  it("delay.ms of 0 is invalid", () => {
    expect(validateScript({ steps: [DELAY(0)] }).valid).toBe(false);
  });

  it("delay.ms of 30 001 is invalid", () => {
    expect(validateScript({ steps: [DELAY(30001)] }).valid).toBe(false);
  });

  it("delay.ms missing (NaN-like) is invalid", () => {
    expect(validateScript({ steps: [{ type: "delay" }] }).valid).toBe(false);
  });
});

// ── M52-FMT-03 / M52-FMT-11: speak.text ─────────────────────────────────────

describe("M52-FMT-03 / M52-FMT-11 speak.text", () => {
  it("non-empty text is valid", () => {
    expect(validateScript({ steps: [SPEAK("hi")] }).valid).toBe(true);
  });

  it("empty text is invalid", () => {
    expect(validateScript({ steps: [SPEAK("")] }).valid).toBe(false);
  });

  it("text at exactly 10 000 chars is valid", () => {
    expect(validateScript({ steps: [SPEAK("x".repeat(10000))] }).valid).toBe(true);
  });

  it("text at 10 001 chars is invalid", () => {
    expect(validateScript({ steps: [SPEAK("x".repeat(10001))] }).valid).toBe(false);
  });
});

// ── M52-FMT-04: speak.speed 0.5–2.0 ─────────────────────────────────────────

describe("M52-FMT-04 speak.speed", () => {
  it("speed absent is valid", () => {
    expect(validateScript({ steps: [SPEAK("hi")] }).valid).toBe(true);
  });

  it("speed 0.5 is valid", () => {
    expect(validateScript({ steps: [SPEAK("hi", { speed: 0.5 })] }).valid).toBe(true);
  });

  it("speed 2.0 is valid", () => {
    expect(validateScript({ steps: [SPEAK("hi", { speed: 2.0 })] }).valid).toBe(true);
  });

  it("speed 0.49 is invalid", () => {
    expect(validateScript({ steps: [SPEAK("hi", { speed: 0.49 })] }).valid).toBe(false);
  });

  it("speed 2.01 is invalid", () => {
    expect(validateScript({ steps: [SPEAK("hi", { speed: 2.01 })] }).valid).toBe(false);
  });
});

// ── M52-FMT-05: command.command non-empty ─────────────────────────────────────

describe("M52-FMT-05 command.command", () => {
  it("non-empty command string is valid", () => {
    expect(validateScript({ steps: [CMD("vscode.open")] }).valid).toBe(true);
  });

  it("empty command string is invalid", () => {
    expect(validateScript({ steps: [CMD("")] }).valid).toBe(false);
  });

  it("missing command field is invalid", () => {
    expect(validateScript({ steps: [{ type: "command" }] }).valid).toBe(false);
  });
});

// ── M52-FMT-06: highlight.file non-empty ─────────────────────────────────────

describe("M52-FMT-06 highlight.file", () => {
  it("non-empty file path is valid", () => {
    expect(validateScript({ steps: [HL("/path/file.ts", 1, 5)] }).valid).toBe(true);
  });

  it("empty file path is invalid", () => {
    expect(validateScript({ steps: [HL("", 1, 5)] }).valid).toBe(false);
  });
});

// ── M52-FMT-07: highlight startLine / endLine ─────────────────────────────────

describe("M52-FMT-07 highlight line numbers", () => {
  it("startLine=1, endLine=1 is valid", () => {
    expect(validateScript({ steps: [HL("f.ts", 1, 1)] }).valid).toBe(true);
  });

  it("startLine=0 is invalid", () => {
    expect(validateScript({ steps: [HL("f.ts", 0, 1)] }).valid).toBe(false);
  });

  it("endLine < startLine is invalid", () => {
    expect(validateScript({ steps: [HL("f.ts", 5, 3)] }).valid).toBe(false);
  });

  it("startLine === endLine is valid", () => {
    expect(validateScript({ steps: [HL("f.ts", 10, 10)] }).valid).toBe(true);
  });
});

// ── M52-FMT-08: highlight span ≤ 500 ─────────────────────────────────────────

describe("M52-FMT-08 highlight span", () => {
  it("span of 500 lines (1–501) is valid", () => {
    expect(validateScript({ steps: [HL("f.ts", 1, 501)] }).valid).toBe(true);
  });

  it("span of 501 lines (1–502) is invalid", () => {
    expect(validateScript({ steps: [HL("f.ts", 1, 502)] }).valid).toBe(false);
  });
});

// ── M52-FMT-09: total delay ≤ 300 000 ms ─────────────────────────────────────

describe("M52-FMT-09 total delay budget", () => {
  it("10 × 30 000 ms = 300 000 ms total is valid", () => {
    const steps = Array.from({ length: 10 }, () => DELAY(30000));
    expect(validateScript({ steps }).valid).toBe(true);
  });

  it("11 × 30 000 ms = 330 000 ms total is invalid", () => {
    const steps = Array.from({ length: 11 }, () => DELAY(30000));
    expect(validateScript({ steps }).valid).toBe(false);
  });
});

// ── M52-FMT-12: subtitle.text ────────────────────────────────────────────────

describe("M52-FMT-12 subtitle.text", () => {
  it("non-empty subtitle text is valid", () => {
    expect(validateScript({ steps: [SUBTITLE("hello")] }).valid).toBe(true);
  });

  it("empty subtitle text is invalid", () => {
    expect(validateScript({ steps: [SUBTITLE("")] }).valid).toBe(false);
  });

  it("text at exactly 500 chars is valid", () => {
    expect(validateScript({ steps: [SUBTITLE("x".repeat(500))] }).valid).toBe(true);
  });

  it("text at 501 chars is invalid", () => {
    expect(validateScript({ steps: [SUBTITLE("x".repeat(501))] }).valid).toBe(false);
  });
});

// ── Error accumulation ────────────────────────────────────────────────────────

describe("error accumulation", () => {
  it("accumulates multiple errors across steps before returning", () => {
    const { valid, errors } = validateScript({
      steps: [
        SPEAK(""), // FMT-03: empty text
        DELAY(0),  // FMT-02: ms < 1
      ],
    });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
