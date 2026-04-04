/**
 * Browser MCP Security — Barrel Export
 *
 * Re-exports all security module types, functions, and classes.
 *
 * @module
 */

export type {
  OriginPolicy,
  RedactionPolicy,
  RedactionPattern,
  RedactionResult,
  AuditEntry,
  AuditSink,
  SecurityConfig,
} from "./security-types.js";

export {
  DEFAULT_REDACTION_PATTERNS,
  DEFAULT_SECURITY_CONFIG,
} from "./security-types.js";

export { checkOrigin, extractOrigin, mergeOriginPolicy } from "./security-policy.js";

export { redactText, redactTextMapResponse, redactSemanticGraphResponse, compileRedactionPatterns } from "./redaction.js";

export { BrowserAuditLog } from "./audit-log.js";
export type { BrowserAuditLogOptions } from "./audit-log.js";
