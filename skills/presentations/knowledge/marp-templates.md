# Marp Templates — Agent Knowledge

> Ready-to-use Marp deck templates. Pick the closest match, copy it, customize names/content.
> All templates use Accordo custom themes. Replace `accordo-dark` with any available theme.

---

## Template 1: Technical Overview (accordo-dark)

**Best for:** Architecture reviews, engineering all-hands, system introductions, project kickoffs.

```markdown
---
marp: true
theme: accordo-dark
paginate: true
size: 16:9
header: "Engineering"
---

<!-- _class: lead -->
<!-- _paginate: false -->

# Project Phoenix
## Rebuilding the Core Platform

*Engineering All-Hands · March 2026*

<!-- notes
Welcome everyone. Today I'll walk you through Project Phoenix — our plan to
rebuild the core platform for scale, reliability, and developer velocity.
This is a 30-minute overview.
-->

---

# Agenda

1. **Problem** — What we're solving and why now
2. **Architecture** — New system design
3. **Key Changes** — What's different from today
4. **Migration Plan** — How we get there safely
5. **Timeline** — When things happen

<!-- notes
Five sections. We'll go through each quickly. Questions at the end.
-->

---

# The Problem

> Our current system can't scale past 10k concurrent users.

- 🔴 **Monolith bottleneck** — single DB connection pool saturates at peak load
- 🟡 **3-hour deploys** — fearful release cycles slow down the whole team
- 🟠 **34% test coverage** — every change is a gamble

<!-- notes
We've known this for 18 months. Three incidents last quarter forced our hand.
Each point has a war story — share if time allows.
-->

---

<!-- _class: section -->

# Architecture

---

# New System Design

![bg right:42%](./architecture.png)

### Event-Driven Core
- Services communicate via domain events
- No direct DB sharing between services

### Polyglot Persistence
- Each service owns its data store
- PostgreSQL + Redis + S3 by use case

### Kubernetes on GKE
- Auto-scaling by service, not monolith

<!-- notes
The key insight: decouple the data layer. This is where 80% of our incidents originate.
-->

---

# Key Numbers After Migration

<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2em;text-align:center;margin-top:1.5em">
<div>

### 8 min
Deploy time (was 3hr)

</div>
<div>

### 99.95%
Target SLA (was 97.8%)

</div>
<div>

### 3×
Throughput capacity

</div>
</div>

<!-- notes
These are conservative estimates. Our prototype hit 3.5x in load testing.
-->

---

# Migration Strategy

### Phase 1 — Strangler Fig (Weeks 1–4)
Route new traffic to new services; old path still works

### Phase 2 — Dual Write (Weeks 5–8)
Both systems receive writes; validate parity continuously

### Phase 3 — Cutover (Week 9)
Blue-green switch; old system in standby for 2 weeks

### Phase 4 — Decommission (Week 12)
Old system retired; infra savings realized

<!-- notes
This has been done before successfully at GitHub, Netflix, Shopify. We're not reinventing the wheel.
-->

---

<!-- _class: invert -->

# The Ask

> Two senior engineers + Q2 capacity.
> We ship Phase 1 by end of April.

<!-- notes
Concrete ask: two engineers freed from feature work for 10 weeks, plus buy-in from leadership to
reprioritize. The ROI is clear. Let's make it happen.
-->

---

<!-- _paginate: false -->

# Questions?

*Slides available at: internal.eng/project-phoenix*

**Ben Mercer** · Staff Engineer
```

---

## Template 2: Business Proposal / Pitch (accordo-corporate)

**Best for:** Investor pitches, product proposals, budget requests, executive presentations.

```markdown
---
marp: true
theme: accordo-corporate
paginate: true
size: 16:9
---

<!-- _class: lead -->
<!-- _paginate: false -->

# Accordo Analytics
## Real-Time Intelligence for Development Teams

*Product Proposal · Q2 2026*

---

# The Problem

> Development teams are flying blind.

**$2.3M** lost annually to delayed incident detection  
**6 hours** average time-to-detect production regressions  
**72%** of teams report "we had no visibility before it broke"

---

# Our Solution

![bg right:45%](./product-screenshot.png)

### Accordo Analytics
Continuous intelligence layer that surfaces anomalies
**before** they become incidents.

- Model-driven deployment risk scoring
- Real-time error correlation across services  
- One-click root cause attribution

---

<!-- _class: section -->

# The Numbers

---

# Traction

<div style="display:grid;grid-template-columns:1fr 1fr;gap:3em;text-align:center;margin-top:2em">
<div>

### 47 Teams
In private beta since January

</div>
<div>

### 94% Retention
After 30-day trial

</div>
<div>

### $180K ARR
Signed LOIs in pipeline

</div>
<div>

### 12 min
Average time-to-detect (was 6hr)

</div>
</div>

---

# Business Model

| Tier | Price | Included |
|------|-------|---------|
| Starter | $299/mo | Up to 5 services, 30-day history |
| Growth | $999/mo | Up to 20 services, 90-day history |
| Enterprise | $3,500/mo | Unlimited, 1-year history, SLA |

**LTV/CAC:** 8.4× at current conversion (target: 10×)

---

# The Ask

<!-- _class: invert -->

> **$4M Seed Round**
> 18 months runway · Team of 8 → 18

**Use of funds:**
- 60% Engineering (platform scale + ML pipeline)
- 25% Sales & Marketing (PLG funnel)
- 15% Operations

---

<!-- _paginate: false -->

# Let's Build This Together

*demo@accordo.dev · accordo.dev/deck*
```

---

## Template 3: Teaching / Tutorial (accordo-light)

**Best for:** Team training, onboarding, knowledge sharing sessions, workshop facilitation.

```markdown
---
marp: true
theme: accordo-light
paginate: true
size: 16:9
header: "Workshop: TypeScript Generics"
footer: "Engineering Academy · March 2026"
---

<!-- _class: lead -->
<!-- _paginate: false -->

# TypeScript Generics
## From Confusion to Confidence

*Engineering Academy Workshop*

---

# What We'll Cover

1. What generics are and why they exist
2. Basic syntax — writing your first generic
3. Constraints — keeping generics honest
4. Real-world patterns you'll use daily
5. Practice exercises

**Duration:** 45 minutes + 15 min Q&A

---

# Why Generics?

Without generics, you write this:

```typescript
function getFirst(arr: number[]): number { return arr[0]; }
function getFirstStr(arr: string[]): string { return arr[0]; }
// ...one function per type? No.
```

With generics, you write this:

```typescript
function getFirst<T>(arr: T[]): T { return arr[0]; }
// Works for any type. One function to rule them all.
```

---

<!-- _class: section -->

# Core Syntax

---

# The Basic Pattern

```typescript
function identity<T>(value: T): T {
  return value;
}

// TypeScript infers T from usage:
const n = identity(42);       // T = number
const s = identity("hello");  // T = string
const b = identity(true);     // T = boolean
```

**Rule:** `<T>` declares a type parameter. Think of it like a variable, but for types.

---

# Generic Interfaces

```typescript
interface ApiResponse<T> {
  data: T;
  status: number;
  error?: string;
}

// Usage:
const userResp: ApiResponse<User> = await fetchUser(id);
const listResp: ApiResponse<User[]> = await listUsers();
```

Now `data` is properly typed — no `any`, no casting.

---

# Constraints — `extends`

> Generics can be constrained to types that have certain properties.

```typescript
function getLength<T extends { length: number }>(item: T): number {
  return item.length;  // ✅ safe — we know length exists
}

getLength("hello");    // ✅ string has .length
getLength([1, 2, 3]);  // ✅ array has .length
getLength(42);         // ❌ number has no .length
```

---

<!-- _class: invert -->

# Key Takeaway

> Generic types let you write **one function** that works
> correctly for **many types** while maintaining type safety.

---

# Practice

**Exercise 1:**  
Write a generic `last<T>` function that returns the last element of an array.

**Exercise 2:**  
Write a generic `pick<T, K extends keyof T>` that returns a subset of object properties.

**Exercise 3:**  
Build an `AsyncResult<T>` type for `{ data: T | null; loading: boolean; error: string | null }`.

---

<!-- _paginate: false -->

# Further Reading

- TypeScript Handbook: Generics — typescriptlang.org/docs/handbook/2/generics
- Matt Pocock's Total TypeScript — totaltypescript.com
- Type Challenges — github.com/type-challenges/type-challenges

*Workshop materials: internal.eng/ts-generics-workshop*
```

---

## Template 4: Sprint / Status Report (accordo-dark)

**Best for:** Sprint reviews, project status updates, retrospectives, stakeholder check-ins.

```markdown
---
marp: true
theme: accordo-dark
paginate: true
size: 16:9
header: "Accordo Platform | Sprint 42 Review"
footer: "Week of March 17–21, 2026"
---

<!-- _class: lead -->
<!-- _paginate: false -->

# Sprint 42 Review
## Platform Team

*March 21, 2026 · 12 Completed · 2 Carried*

---

# Sprint Summary

<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1.5em;text-align:center;margin-top:1em">
<div>

### ✅ 12
Stories completed

</div>
<div>

### 🔄 2
Carried forward

</div>
<div>

### 🐛 3
Bugs fixed

</div>
</div>

**Velocity:** 48 points (target: 45) · **Quality:** 0 P0 incidents

---

# What We Shipped

### 🎯 Marp Presentation Engine (M50)
Full webview implementation with navigation, themes, and MCP tools

### 🔧 Comments Panel v2 (M45)
Editor-gutter threads now sync with Hub state in real time

### 🏎️ Build Pipeline (Chore)
esbuild migration — dev build time: 12s → 1.4s

---

# Demo — Marp Themes Live

*[Live demo of the presentation engine]*

- `accordo-dark` · `accordo-corporate` · `accordo-light` · `accordo-gradient`
- Full MCP control: open, goto, next, prev, generateNarration
- Off-by-one index fix — agents now navigate correctly

---

# Carried Forward

### ⏳ Diagram Auto-layout (A18)
Blocked: upstream mermaid-js breaking change in v11.
**Plan:** Pin to v10 this sprint, upgrade path in Sprint 44.

### ⏳ Voice Narration Quality
Kokoro TTS accent issue on Windows — investigating.
**Plan:** ship workaround with selectable voice model.

---

# Next Sprint — Sprint 43

### High Priority
- Diagram A18 unblock + auto-layout algorithm
- Voice TTS quality fix + voice model selection
- Marp: live-reload on save without panel flash

### Nice to Have
- Marp: speaker notes panel (side-by-side view)
- Comments: resolve thread hotkey

---

<!-- _class: invert -->

# 🎉 Shoutout

> Outstanding work from the whole team this sprint.
> The Marp engine went from zero to production in 3 weeks.

---

<!-- _paginate: false -->

# Thanks

*Next sprint starts Monday.*
*Retro items: internal.eng/retro-42*
```

---

## Template 5: Minimal (accordo-gradient)

**Best for:** Conference talks, keynotes, single impactful message presentations.

```markdown
---
marp: true
theme: accordo-gradient
paginate: false
size: 16:9
---

<!-- _class: lead -->

# The Future of Dev Tooling
*Is Already Here*

---

<!-- _class: midnight -->

# We Spend More Time

> Navigating code than writing it.
> Waiting for builds than shipping.
> Fighting tools than building products.

---

<!-- _class: emerald -->

# What If Your IDE

## Knew what you were thinking?

---

<!-- _class: ocean -->

# Accordo IDE

- Agent-native from day one
- Every action visible, every decision explainable
- Live pair programming, not post-hoc review

---

<!-- _class: section -->

# See It Live

---

<!-- _class: lead -->

# accordo.dev
### Try the beta today
```
