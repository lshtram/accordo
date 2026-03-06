# Visual Transformation Guide — Agent Knowledge

> How to turn boring text into compelling visuals for Slidev presentations.
> This guide teaches AI agents to recognise content patterns and apply the
> right visual treatment automatically.

---

## 1. The Transformation Mindset

**Rule #1:** Every piece of text carries an *implicit visual shape*. Your job is to
detect that shape and render it. Text is the raw material — slides are the product.

**Rule #2:** Never put a wall of text on a slide. Maximum 5-7 lines of visible text.
If you have more, you need a visual transformation.

**Rule #3:** All content must be immediately visible. **Do not use `<v-clicks>`**.
The agent navigates slide-by-slide — click animations start hidden and cannot be
stepped through. Every item must render on first load.

---

## 2. Pattern Recognition Table

Use this table to decide which visual to use for any content type:

| Content Pattern | Detection Signal | Visual Treatment | Slidev Element |
|----------------|------------------|------------------|----------------|
| **Comparison** | "vs", "compared to", "difference", "better/worse" | Side-by-side columns or table | `layout: two-cols` or `\| table \|` |
| **Sequence / Steps** | "first… then… finally", numbered items, process | Numbered list or flow diagram | Numbered `<ol>` with emoji or Mermaid `graph LR` |
| **Hierarchy / Structure** | "consists of", "contains", "layers", parent/child | Tree diagram or nested boxes | Mermaid `graph TB` or mindmap |
| **Relationships** | "connects to", "depends on", "communicates with" | Architecture diagram | Mermaid `graph` with labeled edges |
| **Timeline / History** | dates, "before/after", "evolution", chronological | Timeline diagram or before→after columns | Mermaid `timeline` or `two-cols` |
| **Proportion / Stats** | numbers, percentages, "X times faster" | Big number cards or metric grid | Grid layout with giant text |
| **Categories / Groups** | "types of", "kinds of", "categories" | Card grid or feature boxes | `grid grid-cols-2` with styled divs |
| **Trade-offs** | "pros/cons", "advantages/disadvantages" | Split comparison with ✅/❌ | `two-cols` or table with emoji markers |
| **Concept / Definition** | "is defined as", "means", introducing a term | Centered quote + breakdown | `layout: center` + blockquote |
| **Cause → Effect** | "because", "leads to", "results in" | Flow diagram with arrows | Mermaid `graph LR` with `-->` |
| **Priority / Ranking** | "most important", "ranked", "top N" | Ordered list with visual weight | Numbered list with colored badges |
| **Geography / Positioning** | "positioned between", "quadrant", "spectrum" | Quadrant diagram or axis | Custom HTML/CSS grid or Mermaid quadrant |

---

## 3. Transformation Recipes

### 3.1 Wall of Text → Key Points with Progressive Reveal

**Before (bad):**
```
Our system has several important features. First, it provides real-time
monitoring of all services. Second, it includes an alerting system that
can notify teams via Slack, email, or PagerDuty. Third, it offers
historical data analysis with customizable dashboards. Fourth, it
supports role-based access control for security.
```

**After (good):**
```markdown
# Key Features

- 📊 **Real-time monitoring** — all services, one dashboard
- 🔔 **Smart alerting** — Slack · Email · PagerDuty
- 📈 **Historical analysis** — customizable dashboards
- 🔐 **RBAC** — role-based access control
```

**Technique:** Extract the noun (bold), attach an emoji, reduce to ≤8 words.

---

### 3.2 Comparison Text → Visual Side-by-Side

**Before (bad):**
```
Option A uses REST and is simpler but slower. Option B uses GraphQL which
is more complex but more efficient for nested data.
```

**After (good):**
```markdown
---
layout: two-cols
---

# REST vs GraphQL

::left::

### REST
- ✅ Simple and well-known
- ✅ Great tooling ecosystem
- ❌ Over-fetching on nested data
- ❌ Multiple round-trips

::right::

### GraphQL
- ✅ Precise data fetching
- ✅ Single request for nested data
- ❌ Steeper learning curve
- ❌ Caching complexity
```

**Technique:** Put each option in its own column. Use ✅/❌ for quick scanning.

---

### 3.3 Architecture Text → Mermaid Diagram

**Before (bad):**
```
The client sends requests to the API gateway. The gateway forwards requests
to either the user service or the order service. Both services write to the
same PostgreSQL database. The order service also publishes events to a
message queue that the notification service consumes.
```

**After (good):**
```markdown
---
layout: center
---

# System Architecture

```mermaid {scale: 0.85}
graph LR
  Client --> Gateway
  Gateway --> UserSvc[User Service]
  Gateway --> OrderSvc[Order Service]
  UserSvc --> DB[(PostgreSQL)]
  OrderSvc --> DB
  OrderSvc --> MQ{{Message Queue}}
  MQ --> NotifSvc[Notification Service]
`` `
```

**Technique:** Identify actors (nouns) → nodes. Identify actions (verbs) → edges.

---

### 3.4 Numbers → Hero Stats

**Before (bad):**
```
Performance improved significantly. Latency went down from 200ms to 45ms
(a 77% reduction). We now handle 12,000 requests per second (up from 3,000).
System uptime increased to 99.97%.
```

**After (good):**
```markdown
# Performance Results

<div class="grid grid-cols-3 gap-8 mt-12 text-center">
  <div>
    <div class="text-6xl font-bold text-emerald-400">77%</div>
    <div class="text-sm mt-3 opacity-60">Latency reduction</div>
    <div class="text-xs opacity-40">200ms → 45ms</div>
  </div>
  <div>
    <div class="text-6xl font-bold text-blue-400">4×</div>
    <div class="text-sm mt-3 opacity-60">Throughput increase</div>
    <div class="text-xs opacity-40">3K → 12K req/s</div>
  </div>
  <div>
    <div class="text-6xl font-bold text-amber-400">99.97%</div>
    <div class="text-sm mt-3 opacity-60">Uptime</div>
    <div class="text-xs opacity-40">last 90 days</div>
  </div>
</div>
```

**Technique:** Extract 2-4 numbers. Make them HUGE. Add context in small text below.

---

### 3.5 Process Description → Step Timeline

**Before (bad):**
```
The deployment process starts with code review. After approval, the CI
pipeline runs tests. If tests pass, a staging deployment is created.
After QA validation, the production deployment is triggered with a
canary rollout strategy.
```

**After (good):**
```markdown
# Deployment Pipeline

```mermaid {scale: 0.65}
graph LR
  Review["🔍 Code Review"] --> CI["⚙️ CI Pipeline"]
  CI --> Stage["🧪 Staging"]
  Stage --> QA["✅ QA Validation"]
  QA --> Prod["🚀 Production"]
  style Prod fill:#22c55e20,stroke:#22c55e
`` `
```

**Technique:** Identify sequential steps → `graph LR`. Add emoji for visual anchoring.

---

### 3.6 Categories → Feature Cards

**Before (bad):**
```
We offer four types of monitoring: infrastructure monitoring tracks servers
and containers; application monitoring tracks response times and errors;
log monitoring aggregates and searches log data; and user monitoring
tracks real user experience metrics.
```

**After (good):**
```markdown
# Monitoring Types

<div class="grid grid-cols-2 gap-6 mt-8">
  <div class="border border-blue-500/20 rounded-xl p-6 bg-blue-500/5">
    <div class="text-2xl mb-2">🖥️</div>
    <h3 class="font-semibold text-blue-300">Infrastructure</h3>
    <p class="text-sm opacity-60 mt-1">Servers, containers, networks</p>
  </div>
  <div class="border border-emerald-500/20 rounded-xl p-6 bg-emerald-500/5">
    <div class="text-2xl mb-2">⚡</div>
    <h3 class="font-semibold text-emerald-300">Application</h3>
    <p class="text-sm opacity-60 mt-1">Response times, error rates</p>
  </div>
  <div class="border border-amber-500/20 rounded-xl p-6 bg-amber-500/5">
    <div class="text-2xl mb-2">📋</div>
    <h3 class="font-semibold text-amber-300">Log Monitoring</h3>
    <p class="text-sm opacity-60 mt-1">Aggregation, search, patterns</p>
  </div>
  <div class="border border-purple-500/20 rounded-xl p-6 bg-purple-500/5">
    <div class="text-2xl mb-2">👤</div>
    <h3 class="font-semibold text-purple-300">User Monitoring</h3>
    <p class="text-sm opacity-60 mt-1">Real user experience metrics</p>
  </div>
</div>
```

**Technique:** One card per category. Color-code. Emoji anchor. ≤10 words each.

---

### 3.7 Concept Introduction → Quote + Breakdown

**Before (bad):**
```
Event sourcing is a pattern where state changes are stored as a sequence
of events rather than just the current state. This means you can rebuild
the state at any point in time by replaying events from the beginning.
```

**After (good):**
```markdown
---
layout: center
---

<div class="text-center max-w-xl mx-auto">
  <div class="text-3xl font-bold mb-4">Event Sourcing</div>
  <div class="w-12 h-1 bg-blue-400 rounded mx-auto mb-6"></div>
  <div class="text-lg opacity-70 italic">
    "Store what happened, not where you are."
  </div>
</div>
```

Then on the next slide:
```markdown
- 📝 **Events** — immutable records of what happened
- 🔄 **Replay** — rebuild state from any point in time
- 📸 **Snapshots** — optimization to avoid full replay
```

**Technique:** Lead with a memorable quote/definition. Break down into 3 facets.

---

### 3.8 Trade-offs → Decision Matrix

**Before (bad):**
```
There are trade-offs. Microservices give better scaling and independent
deployment but add network complexity. Monoliths are simpler to develop
and debug but harder to scale individual pieces.
```

**After (good):**
```markdown
# Trade-off Matrix

| Aspect | Monolith | Microservices |
|--------|----------|---------------|
| Scaling | 🟡 Vertical only | 🟢 Per-service |
| Deployment | 🟡 All-or-nothing | 🟢 Independent |
| Complexity | 🟢 Low initially | 🔴 Network + ops |
| Debugging | 🟢 Single process | 🟡 Distributed tracing |
| Team scaling | 🟡 Merge conflicts | 🟢 Service ownership |
```

**Technique:** Aspect rows, option columns, colored emoji for quick scanning.

---

## 4. Visual Enhancement Checklist

Apply these after creating the basic structure:

- [ ] **Emoji anchors** — every bullet point starts with a relevant emoji
- [ ] **Color coding** — use consistent colors (blue=info, green=success, amber=warning, red=error)
- [ ] **No `<v-clicks>`** — all content must be immediately visible (agent can’t step through animations)
- [ ] **White space** — add `<div class="mt-8"></div>` between major sections
- [ ] **Visual separators** — use `<div class="w-16 h-1 bg-blue-400 rounded mb-6"></div>` after titles
- [ ] **Limit text** — max 5 visible items per slide; use a new slide if you need more
- [ ] **Mermaid scale** — always specify `{scale: N}`: 0.85 (simple), 0.65 (medium), 0.45 (complex)
- [ ] **Big numbers** — any important stat should be `text-5xl` or larger
- [ ] **Speaker notes** — every slide gets `<!-- notes -->` with talking points and timing

---

## 5. Color Palette Reference

For dark themes (recommended):

| Semantic | Tailwind Class | Use For |
|----------|---------------|---------|
| Primary | `text-blue-400`, `bg-blue-500/10` | Main accent, links, info |
| Success | `text-emerald-400`, `bg-emerald-500/10` | Positive, completed, pros |
| Warning | `text-amber-400`, `bg-amber-500/10` | Caution, in-progress |
| Error | `text-rose-400`, `bg-rose-500/10` | Negative, failed, cons |
| Purple | `text-purple-400`, `bg-purple-500/10` | Secondary accent, special |
| Muted | `opacity-60` or `opacity-40` | Supporting text, dates |

---

## 6. Mermaid Diagram Quick Reference

### Flow (Architecture)
```
graph TB / LR / RL / BT
  A[Rectangle] --> B(Rounded)
  A --> C{Diamond}
  C -->|Yes| D[(Database)]
  C -->|No| E{{Hexagon}}
```

### Sequence (Interactions)
```
sequenceDiagram
  Client->>+Server: POST /api/data
  Server->>DB: INSERT
  DB-->>Server: OK
  Server-->>-Client: 201 Created
```

### Mind Map (Concepts)
```
mindmap
  root((Topic))
    Branch A
      Leaf 1
      Leaf 2
    Branch B
      Leaf 3
```

### Timeline
```
timeline
  title Project History
  2023 Q1 : Prototype
  2023 Q2 : Beta Launch
  2023 Q3 : GA Release
  2024 Q1 : v2.0
```

### Quadrant Chart (Positioning)
```
quadrantChart
  title Effort vs Impact
  x-axis Low Effort --> High Effort
  y-axis Low Impact --> High Impact
  Quick Wins: [0.2, 0.8]
  Major Projects: [0.8, 0.9]
  Fill Work: [0.3, 0.2]
  Avoid: [0.9, 0.1]
```

---

## 7. Image Sources

Always attribute when using external images.

| Source | URL | Style | Best For |
|--------|-----|-------|----------|
| Slidev Covers | `https://cover.sli.dev` | Random curated | Cover slides |
| Unsplash Slidev | `https://unsplash.com/collections/94734566/slidev` | Photography | Backgrounds |
| Unsplash Search | `https://images.unsplash.com/photo-{ID}?w=1920` | Photography | Any slide |

**Usage in frontmatter:**
```yaml
background: https://images.unsplash.com/photo-{ID}?w=1920
```

**Usage inline:**
```html
<img src="https://images.unsplash.com/photo-{ID}?w=600" class="rounded-xl shadow-xl" />
```

---

## 8. Anti-Patterns to Avoid

| Anti-Pattern | Why It's Bad | Fix |
|-------------|-------------|-----|
| Wall of text | Audience reads ahead, stops listening | Extract key points into a plain bullet list |
| No speaker notes | Presenter forgets points, timing drifts | Always add `<!-- notes -->` |
| Using `<v-clicks>` | Content starts hidden — agent can’t reveal it | Remove `<v-clicks>`; all content visible immediately |
| Too many slides | Fatigue | Aim for 1-2 min per slide |
| No visual variety | Monotony | Alternate layouts every 2-3 slides |
| Tiny text | Can’t read from back of room | Minimum `text-lg`, prefer `text-xl`+ |
| No color coding | Hard to distinguish items | Assign semantic colors consistently |
| Orphan slides | One bullet on a slide | Merge with neighbor or expand |
| Mermaid overflows | Diagram clipped by slide edge | Add `{scale: 0.65}` or lower to the code fence |

---

## 9. Content Fitting — Keeping Everything in View

> Slidev renders slides on a fixed **980×552 canvas**. Content that overflows this
> canvas is **clipped** — the viewer cannot scroll. These rules ensure nothing is cut off.

### 9.1 No `<v-clicks>` (critical)

The agent can only navigate slide-by-slide. Click-animated items start hidden and
remain hidden because the agent has no mechanism to advance click steps.

**Rule:** Never use `<v-clicks>`, `<v-click>`, or `v-click` directives. Replace every
animated list with a plain Markdown list:

```markdown
# ❌ Don't do this
<v-clicks>
- Item 1
- Item 2
</v-clicks>

# ✅ Do this instead
- 🔵 Item 1
- 🟢 Item 2
```

### 9.2 Mermaid Scale — Required Values

Always specify `{scale: N}` on every Mermaid code fence. The default scale (1.0) is
too large for any multi-node diagram.

| Diagram Type | Node Count | `{scale: N}` |
|---|---|---|
| Simple flow | 2–4 nodes | `{scale: 0.85}` |
| Medium flow / sequence | 5–8 nodes | `{scale: 0.65}` |
| Complex / with subgraphs | 9+ nodes | `{scale: 0.45}` |
| Timeline | any | `{scale: 0.7}` |

If unsure, start at `{scale: 0.6}` — it fits most diagrams.

### 9.3 Per-Slide Font Reduction

For dense content slides (tables, long lists, feature cards), add `class: text-sm`
to the slide frontmatter. This reduces all text by ~15% (14px → 12px):

```yaml
---
class: text-sm
---
```

For more control, use the `style:` frontmatter key:

```yaml
---
style: |
  .slidev-layout { font-size: 0.8em; line-height: 1.4; }
---
```

### 9.4 Compact Grid/Card Spacing

Default spacing looks spacious. On dense slides, reduce it:

| Element | Default | Compact |
|---|---|---|
| Grid gap | `gap-6` | `gap-3` |
| Card padding | `p-6` | `p-4` |
| Top margin | `mt-12` | `mt-6` |
| List margin | `mt-8` | `mt-4` |

### 9.5 Hard Limits per Slide

If content exceeds these limits, split into two slides:

| Element | Hard Max |
|---|---|
| Bullet list items | **5** |
| Table rows (including header) | **6** |
| `two-cols` content per column | **4 short lines** |
| Lines of plain text | **5** |
| Mermaid nodes | 10 (use `{scale: 0.45}` above 7) |
