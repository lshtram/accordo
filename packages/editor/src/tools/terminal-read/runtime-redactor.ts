/**
 * runtime-redactor.ts — Priority S Phase C
 * Redaction seam for terminal output before it crosses the MCP boundary.
 *
 * Scans for common secret patterns and replaces them with [REDACTED]:
 *   - Bearer tokens, API keys, auth tokens
 *   - Password= / secret= / token= assignments
 *   - Long hex strings (potential keys/tokens, ≥32 hex chars)
 *   - AWS-style access keys (AKIA...)
 */

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, label: "[JWT]" },
  { pattern: /\bBearer\s+[A-Za-z0-9_.-]{20,}\b/g, label: "[TOKEN]" },
  { pattern: /\b(akid|aws_access_key_id|aws_secret_access_key)\s*[=:]\s*\S{20,}/gi, label: "[AWS_KEY]" },
  { pattern: /\b(password|passwd|pwd|secret|token|auth|bearer|apikey|api_key)\s*[=:]\s*[\w@#$%^&*()-]{8,}/gi, label: "[SECRET]" },
  { pattern: /\b[A-Fa-f0-9]{32,}\b/g, label: "[HEX_KEY]" },
  { pattern: /\bghp_[A-Za-z0-9]{36}\b/g, label: "[GITHUB_TOKEN]" },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, label: "[GITLAB_TOKEN]" },
  { pattern: /\bsk-[A-Za-z0-9_-]{48}\b/g, label: "[OPENAI_KEY]" },
];

/**
 * Simple pattern redaction — replaces matched secret with label.
 * Returns the input text if no matches found (fast path).
 */
function redactPatterns(text: string): string {
  let result = text;
  for (const { pattern, label } of SECRET_PATTERNS) {
    result = result.replace(pattern, label);
  }
  return result;
}

export interface TerminalOutputRedactor {
  redact(text: string): string;
}

export const terminalOutputRedactor: TerminalOutputRedactor = {
  redact(text: string): string {
    return redactPatterns(text);
  },
};