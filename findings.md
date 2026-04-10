# Findings

## Initial reviewer findings to address
- Test suite red in navigation/control area
- `redactPatterns` may be dropped during capture payload validation
- Capture error taxonomy may be collapsed to `no-target`
- Browser MCP security/privacy controls may be only partially implemented in browser-extension package
- Static relay auth token in query string is weak security hygiene
- Large files, broad logging, and narrow lint scope are maintainability issues

## Confirmed fixes completed
- `toCapturePayload()` now preserves `redactPatterns` when provided as a string array
- Bounds-resolution errors from `RESOLVE_ANCHOR_BOUNDS` now preserve specific codes such as `element-not-found` and `element-off-screen` instead of collapsing to `no-target`
- Targeted capture tests pass after the fix
- Navigate/control test drift fixed by aligning the debugger mock with `handleNavigate()`'s `Page.getFrameTree` preflight sequence
- Shared privacy middleware added for the five text-producing read tools: origin blocking, `redactPII`, `redactionWarning`, `auditId`, and in-memory audit logging
- Package lint scope now covers `src/` instead of a narrow semantic-graph glob, and the resulting lint issues were fixed
- `PageCommentStore` now matches BR-F-03 (`version`, `url`, `threads` only)
- Extension-layer error responses now carry structured retry metadata via shared helpers
- Remaining reviewer concern is limited to relay auth token hygiene in `relay-bridge.ts`, which appears to be a cross-package design choice rather than a browser-extension-only defect
