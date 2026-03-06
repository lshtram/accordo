#!/usr/bin/env node
/**
 * scaffold-deck.mjs — Scaffold a new .deck.md file from a template
 *
 * Usage: node skills/presentations/scaffold-deck.mjs <type> <output-path> [title]
 *
 * Types: overview, walkthrough, sprint, rfc, explainer
 *
 * Example:
 *   node skills/presentations/scaffold-deck.mjs overview demo/my-talk.deck.md "My System"
 */

import { writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

const TEMPLATES = {
  overview: (title) => `---
title: "${title}"
theme: seriph
colorSchema: dark
transition: slide-left
layout: cover
background: https://cover.sli.dev
---

# ${title}

[One-line description]

<div class="pt-8 text-sm opacity-60">
  [Author] · [Date]
</div>

<!-- notes -->
Welcome. Today I'll walk you through ${title}. (~30 sec)

---
transition: fade
---

# Agenda

<div class="w-16 h-1 bg-blue-400 rounded mb-8"></div>

<v-clicks>

1. **Context** — why this matters
2. **Architecture** — how it works
3. **Key details** — what to know
4. **Next steps** — where we go

</v-clicks>

<!-- notes -->
Four sections. (~30 sec)

---

# Context

<v-clicks>

- 🔴 **[Problem 1]** — [description]
- 🟡 **[Problem 2]** — [description]
- 🟠 **[Problem 3]** — [description]

</v-clicks>

<!-- notes -->
Why we built this. (~2 min)

---
layout: center
---

# Architecture

\`\`\`mermaid {scale: 0.85}
graph TB
  A[Component A] --> B[Component B]
  B --> C[Component C]
  B --> D[(Database)]
\`\`\`

<!-- notes -->
High-level architecture. (~3 min)

---
layout: two-cols
---

# Key Details

::left::

### Area 1
- Detail
- Detail

::right::

### Area 2
- Detail
- Detail

<!-- notes -->
Important details. (~2 min)

---

# Next Steps

<v-clicks>

1. **[Action 1]** — [description]
2. **[Action 2]** — [description]
3. **[Action 3]** — [description]

</v-clicks>

<!-- notes -->
What's next. (~1 min)

---
layout: end
---

# Thank You

<div class="text-sm opacity-60 mt-4">Questions?</div>
`,

  walkthrough: (title) => `---
title: "${title} — Code Walkthrough"
theme: default
colorSchema: dark
transition: fade
---

# ${title}

<div class="text-xl opacity-70 mt-4">Code Walkthrough</div>
<div class="w-16 h-1 bg-blue-400 rounded mt-8"></div>

<v-clicks>

- 📐 **Interface** — the public API
- ⚙️ **Implementation** — how it works
- ✅ **Testing** — how we verify it

</v-clicks>

<!-- notes -->
Walking through the code for ${title}. (~30 sec)

---

# Interface

\`\`\`typescript {all|2-4|6-8}
// TODO: Add your interface here
interface MyService {
  create(input: Input): Promise<Result>;
  findById(id: string): Promise<Item | null>;
}
\`\`\`

<!-- notes -->
The public interface. (~2 min)

---

# Implementation

\`\`\`typescript {2,3|5-8}
// TODO: Add your implementation here
class MyServiceImpl implements MyService {
  constructor(private readonly db: Database) {}

  async create(input: Input): Promise<Result> {
    return this.db.insert(input);
  }
}
\`\`\`

<!-- notes -->
The implementation. (~3 min)

---

# Testing

\`\`\`typescript
describe('MyService', () => {
  it('creates successfully', async () => {
    // TODO: Add test example
  });
});
\`\`\`

<!-- notes -->
Test strategy. (~1 min)

---
layout: end
---

# Questions?
`,

  sprint: (title) => `---
title: "${title}"
theme: default
colorSchema: dark
transition: slide-left
---

# ${title}

<div class="text-lg opacity-60 mt-2">[Date range]</div>

<div class="grid grid-cols-3 gap-8 mt-16 text-center">
  <div>
    <div class="text-4xl font-bold text-emerald-400">[N]</div>
    <div class="text-sm mt-2 opacity-60">Completed</div>
  </div>
  <div>
    <div class="text-4xl font-bold text-blue-400">[N]</div>
    <div class="text-sm mt-2 opacity-60">In Progress</div>
  </div>
  <div>
    <div class="text-4xl font-bold text-amber-400">[N]</div>
    <div class="text-sm mt-2 opacity-60">Story Points</div>
  </div>
</div>

<!-- notes -->
Sprint overview. (~30 sec)

---

# Completed ✅

<v-clicks>

- ✅ **[Feature 1]** — [description]
- ✅ **[Feature 2]** — [description]
- ✅ **[Bug fix 1]** — [description]

</v-clicks>

<!-- notes -->
Shipped items. (~3 min)

---

# In Progress 🔄

| Task | Owner | Progress | ETA |
|------|-------|----------|-----|
| [Task 1] | [Name] | ████████░░ 80% | [Date] |
| [Task 2] | [Name] | ███░░░░░░░ 30% | [Date] |

<!-- notes -->
In-flight items. (~2 min)

---

# Next Sprint

<v-clicks>

1. 🎯 **[Goal 1]** — [criteria]
2. 🎯 **[Goal 2]** — [criteria]
3. 🎯 **[Goal 3]** — [criteria]

</v-clicks>

<!-- notes -->
Next priorities. (~1 min)
`,

  rfc: (title) => `---
title: "RFC: ${title}"
theme: seriph
colorSchema: dark
transition: fade
---

# RFC: ${title}

<div class="text-lg opacity-60 mt-2">[Author] · [Date]</div>
<div class="w-16 h-1 bg-blue-400 rounded mt-8 mb-6"></div>

**Status:** <span class="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs">Open for Discussion</span>

<!-- notes -->
Proposal for ${title}. (~30 sec)

---

# Context

**Current state:** [describe today]

**Problem:** [what's wrong]

<v-click>

<div class="mt-8 p-4 border border-rose-500/30 rounded-lg bg-rose-500/5">
  💡 <strong>Key constraint:</strong> [constraint]
</div>

</v-click>

<!-- notes -->
Context and constraints. (~2 min)

---
layout: two-cols
---

# Options

::left::

### Option A: [Name]
- ✅ [Pro 1]
- ✅ [Pro 2]
- ❌ [Con 1]

::right::

### Option B: [Name]
- ✅ [Pro 1]
- ✅ [Pro 2]
- ❌ [Con 1]

<!-- notes -->
Trade-offs. (~3 min)

---

# Recommendation

<div class="text-center mt-8">
  <div class="text-3xl font-bold text-blue-400">Option [X]: [Name]</div>
  <div class="w-16 h-1 bg-blue-400 rounded mx-auto mt-4 mb-8"></div>
</div>

<v-clicks>

1. [Reason 1]
2. [Reason 2]
3. [Reason 3]

</v-clicks>

<!-- notes -->
Recommendation. (~2 min)
`,

  explainer: (title) => `---
title: "${title} Explained"
theme: default
colorSchema: dark
transition: slide-left
layout: cover
background: https://cover.sli.dev
---

# ${title}

<div class="text-xl opacity-70 mt-4">[Why this matters]</div>

<!-- notes -->
Let me explain ${title} clearly. (~30 sec)

---
layout: center
---

# What is ${title}?

<div class="text-2xl mt-8 max-w-lg mx-auto text-center leading-relaxed opacity-80">

"[Simple one-sentence definition]"

</div>

<div class="w-16 h-1 bg-blue-400 rounded mx-auto mt-8"></div>

<!-- notes -->
Definition. (~1 min)

---

# Mental Model

\`\`\`mermaid
mindmap
  root((${title}))
    Idea A
      Detail 1
      Detail 2
    Idea B
      Detail 3
    Idea C
      Detail 4
\`\`\`

<!-- notes -->
Three core ideas. (~2 min)

---
layout: two-cols
---

# Compared To...

::left::

### ${title} ✅
- [Advantage 1]
- [Advantage 2]

::right::

### [Alternative] ⚖️
- [Difference 1]
- [Difference 2]

<!-- notes -->
Key differences. (~2 min)

---

# Key Takeaways

<v-clicks>

1. 💡 **[Takeaway 1]** — [one line]
2. 🔧 **[Takeaway 2]** — [one line]
3. 🚀 **[Takeaway 3]** — [one line]

</v-clicks>

<!-- notes -->
Three things to remember. (~1 min)
`
};

// ── Main ─────────────────────────────────────────────────────────────────────

const type = process.argv[2];
const outputPath = process.argv[3];
const title = process.argv[4] || "Untitled Presentation";

if (!type || !outputPath) {
  console.log("Usage: node scaffold-deck.mjs <type> <output-path> [title]");
  console.log("");
  console.log("Types:");
  console.log("  overview    — Technical overview (7 slides)");
  console.log("  walkthrough — Code walkthrough (5 slides)");
  console.log("  sprint      — Sprint review (4 slides)");
  console.log("  rfc         — RFC / decision proposal (4 slides)");
  console.log("  explainer   — Concept explainer (5 slides)");
  console.log("");
  console.log("Example:");
  console.log('  node scaffold-deck.mjs overview demo/my-talk.deck.md "My System"');
  process.exit(1);
}

const templateFn = TEMPLATES[type];
if (!templateFn) {
  console.error(`Unknown type: ${type}. Use one of: ${Object.keys(TEMPLATES).join(", ")}`);
  process.exit(1);
}

const absOutput = resolve(outputPath);
const dir = dirname(absOutput);
mkdirSync(dir, { recursive: true });

if (existsSync(absOutput)) {
  console.error(`File already exists: ${absOutput}`);
  console.error("Delete it first or choose a different name.");
  process.exit(1);
}

const content = templateFn(title);
writeFileSync(absOutput, content, "utf-8");

const slideCount = content.split(/\n---\s*\n/).length;
console.log(`✓ Created ${outputPath} (${slideCount} slides, type: ${type})`);
console.log(`  Validate: node skills/presentations/validate-deck.mjs ${outputPath}`);
