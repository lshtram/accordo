# Instrumentation Guide

## Core Principle

Instrumentation should answer a **specific question**, not carpet-bomb the code with logs.
Before adding any log, state: *"I need to know [X] because I suspect [Y]."*

---

## Where to Add Logs

Log at **decision points** -- not everywhere:
- Entry/exit of the function where the error originates
- Each branch of a conditional that leads to the error path
- Data transformation points (before and after)
- Component/service boundaries where control passes between subsystems

---

## What to Log

Always include:
- An identifier (request ID, operation name, module)
- The inputs that triggered the path
- The full error object, not just `.message`

```typescript
// Bad
logger.error("failed");

// Good
logger.error({ id, input, error: err.message, stack: err.stack }, "operation failed");
```

---

## Temporary Debug Flag Pattern

For Node.js / TypeScript:

```typescript
// At the top of the file under investigation:
const DEBUG = process.env.DEBUG_MODULE === '1';

// At points of interest:
if (DEBUG) {
  process.stderr.write(`[debug] ${JSON.stringify({ key: value })}\n`);
}
```

Mark every temporary block with `// DEBUG:` so it's trivial to find and remove.

---

## Tracing Through a Pipeline

When a message or request behaves unexpectedly end-to-end:
1. Map the components it passes through
2. Add one log at each boundary
3. Run the scenario and find the last boundary where the log appears -- the problem is
   in the next hop
4. Focus instrumentation there; remove the wider boundary logs

---

## Cleanup Checklist

Before committing:

- [ ] All `// DEBUG:` blocks removed
- [ ] No stray `console.log` / `process.stderr.write` in production paths
- [ ] Debug env-var checks removed
- [ ] Full test suite passes
- [ ] Build produces zero errors
