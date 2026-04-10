---
title: "Visual Techniques for Technical Presentations"
theme: default
colorSchema: dark
transition: slide-left
layout: cover
background: https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=1920
---

# Visual Techniques

How to turn text into compelling technical presentations

<div class="pt-8 text-sm opacity-60">
  Accordo IDE · Presentation Skill Demo
</div>

<!-- notes -->
This presentation demonstrates the visual transformation techniques that AI agents in Accordo use to create compelling slides. Every slide here is itself an example of the technique it describes. (~30 sec)

---
transition: fade
---

# Agenda

<div class="w-16 h-1 bg-blue-400 rounded mb-8"></div>

<v-clicks>

1. **The problem** — why text-heavy slides fail
2. **Pattern recognition** — detecting content shapes
3. **Transformation recipes** — before and after
4. **Visual elements** — diagrams, stats, cards
5. **Rules to remember** — the checklist

</v-clicks>

<!-- notes -->
Five sections. This agenda slide itself demonstrates progressive reveal with v-clicks — the audience sees each point as you discuss it, maintaining attention. (~30 sec)

---
layout: center
---

# The Problem

<div class="text-2xl mt-8 max-w-xl mx-auto text-center leading-relaxed">

> "If your slide can be read without you, <br/>
> your audience doesn't need you."

</div>

<div class="w-16 h-1 bg-blue-400 rounded mx-auto mt-8"></div>

<!-- notes -->
This is technique number one: the centered quote. When introducing a concept or problem, a single powerful statement on a clean slide commands attention. No bullets, no noise — just the core idea. (~1 min)

---

# Pattern Recognition

Every piece of content has a natural visual shape:

| Content Pattern | Visual Shape | Slidev Tool |
|----------------|-------------|-------------|
| Comparison | Side-by-side columns | `layout: two-cols` |
| Sequence | Flow diagram | Mermaid `graph LR` |
| Hierarchy | Tree diagram | Mermaid `graph TB` |
| Numbers | Giant stat cards | Grid + `text-5xl` |
| Categories | Feature cards | `grid grid-cols-2` |
| Trade-offs | Table with emoji | `✅ / ❌ / 🟡` table |

<!-- notes -->
This slide uses a table — which is itself the right visual for categorized information. The pattern recognition table tells you: if you see comparison text, use two-cols. If you see numbers, make them huge. If you see trade-offs, use a scored table. (~2 min)

---
layout: two-cols
---

# Before → After

::left::

### ❌ Text Wall
<div class="text-sm opacity-60 leading-relaxed">

"Our system uses a microservices architecture with an API gateway that routes requests to individual services. Each service has its own database. Services communicate asynchronously through a message queue for eventual consistency."

</div>

<div class="mt-4 text-xs text-rose-400">55 words. Audience lost.</div>

::right::

### ✅ Architecture Diagram

```mermaid {scale: 0.6}
graph TB
  Client --> GW[API Gateway]
  GW --> S1[Service A]
  GW --> S2[Service B]
  S1 --> DB1[(DB A)]
  S2 --> DB2[(DB B)]
  S1 <-.-> MQ{{Queue}}
  MQ <-.-> S2
```

<div class="mt-2 text-xs text-emerald-400">Same info. 3 seconds to grasp.</div>

<!-- notes -->
This is the two-cols comparison technique. On the left, the paragraph that nobody reads. On the right, the Mermaid diagram that communicates instantly. This layout is perfect anytime you want to show before-and-after or two competing approaches. (~2 min)

---

# Numbers That Pop

<div class="grid grid-cols-3 gap-8 mt-12 text-center">
  <div>
    <div class="text-6xl font-bold text-emerald-400">77%</div>
    <div class="text-sm mt-3 opacity-60">Faster processing</div>
    <div class="text-xs opacity-40">200ms → 45ms</div>
  </div>
  <div>
    <div class="text-6xl font-bold text-blue-400">4×</div>
    <div class="text-sm mt-3 opacity-60">More throughput</div>
    <div class="text-xs opacity-40">3K → 12K req/s</div>
  </div>
  <div>
    <div class="text-6xl font-bold text-amber-400">99.97%</div>
    <div class="text-sm mt-3 opacity-60">Uptime SLA</div>
    <div class="text-xs opacity-40">last 90 days</div>
  </div>
</div>

<!-- notes -->
The hero stat technique. Any time you have important numbers, make them HUGE. The grid layout with three columns is the sweet spot. Main number in a color, label below, optional detail in muted text. The audience remembers these numbers because they dominate the slide. (~1 min)

---

# Feature Cards

<div class="grid grid-cols-2 gap-6 mt-6">
  <div class="border border-blue-500/20 rounded-xl p-6 bg-blue-500/5">
    <div class="text-2xl mb-2">📊</div>
    <h3 class="font-semibold text-blue-300">Monitoring</h3>
    <p class="text-sm opacity-60 mt-1">Real-time dashboards for all services</p>
  </div>
  <div class="border border-emerald-500/20 rounded-xl p-6 bg-emerald-500/5">
    <div class="text-2xl mb-2">🔔</div>
    <h3 class="font-semibold text-emerald-300">Alerting</h3>
    <p class="text-sm opacity-60 mt-1">Slack, email, PagerDuty integration</p>
  </div>
  <div class="border border-amber-500/20 rounded-xl p-6 bg-amber-500/5">
    <div class="text-2xl mb-2">📈</div>
    <h3 class="font-semibold text-amber-300">Analytics</h3>
    <p class="text-sm opacity-60 mt-1">Historical trends and anomaly detection</p>
  </div>
  <div class="border border-purple-500/20 rounded-xl p-6 bg-purple-500/5">
    <div class="text-2xl mb-2">🔐</div>
    <h3 class="font-semibold text-purple-300">Security</h3>
    <p class="text-sm opacity-60 mt-1">Role-based access with audit logging</p>
  </div>
</div>

<!-- notes -->
The feature card technique. When you have categories or product features, put each in its own colored card with an emoji anchor. The 2x2 grid is visually balanced and easy to scan. Each card has: emoji, title in the accent color, one-line description. (~1 min)

---

# Process as Flow

<v-clicks>

```mermaid {scale: 0.85}
graph LR
  A["📝 Write"] --> B["🔍 Review"]
  B --> C["⚙️ CI/CD"]
  C --> D["🧪 Staging"]
  D --> E["🚀 Production"]
  style E fill:#22c55e20,stroke:#22c55e
```

</v-clicks>

<v-click>

<div class="mt-8 text-center text-sm opacity-60">
  Each step is a noun + emoji. Direction shows time flowing left to right.
</div>

</v-click>

<!-- notes -->
The flow diagram technique. Any sequential process — deployment pipelines, data flows, user journeys — becomes a left-to-right Mermaid graph. Emoji anchors make each step memorable. The green styling on the final node draws the eye to the goal. (~1 min)

---

# The Checklist

<v-clicks>

- ✅ **Progressive reveal** — wrap all lists in `<v-clicks>`
- ✅ **Emoji anchors** — start every bullet with a relevant emoji
- ✅ **Max 5-7 lines** — if more, split or use a visual
- ✅ **Speaker notes** — every slide, with timing estimate
- ✅ **Color coding** — blue=info, green=good, amber=warning, red=bad
- ✅ **At least one diagram** — Mermaid makes it trivial
- ✅ **Hero stats for numbers** — never bury metrics in prose

</v-clicks>

<!-- notes -->
The final checklist. These seven rules cover 90-percent of what makes a technical presentation effective. Notice this slide itself uses progressive reveal — each rule appears as you discuss it, keeping the audience with you. (~2 min)

---
layout: end
---

# Use These Techniques

<div class="text-sm opacity-60 mt-4">
  Built with the Accordo Presentation Skill
</div>
