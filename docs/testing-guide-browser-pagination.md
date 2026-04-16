# Testing Guide — Browser Pagination (`get_page_map`, `get_text_map`)

## What This Implements

This module adds incremental pagination support to the browser tools:

- `accordo_browser_get_page_map`
- `accordo_browser_get_text_map`

The feature adds optional `offset` and `limit` request parameters and pagination metadata in responses:

- `hasMore`
- `nextOffset`
- `totalAvailable`

Behavior implemented:
- pagination is opt-in
- negative `offset` is clamped to `0`
- `limit < 1` is clamped to `1`
- `limit` is capped to the effective collector cap
- metadata is returned only when `offset` or `limit` is explicitly provided
- legacy calls without pagination args keep the old response shape

---

## Prerequisites

1. Browser package dependencies installed
2. Run commands from: `/data/projects/accordo/packages/browser`

---

## Section 1 — Automated Tests

### 1a. Pagination-focused browser tests

```bash
cd /data/projects/accordo/packages/browser
pnpm exec vitest run src/__tests__/text-map-tool.test.ts src/__tests__/page-understanding-tools.test.ts
```

**Expected:** 193 tests pass across 2 files. 0 failures.

This command covers the pagination feature directly.

#### `src/__tests__/text-map-tool.test.ts`

Run with:

```bash
cd /data/projects/accordo/packages/browser
pnpm exec vitest run src/__tests__/text-map-tool.test.ts
```

Pagination coverage in this file:

- `PAG-01: browser_get_text_map tool accepts offset?: number in inputSchema` — verifies `offset` exists in tool schema
- `PAG-01: browser_get_text_map tool accepts limit?: number in inputSchema` — verifies `limit` exists in tool schema
- `PAG-01: offset and limit are not in the required array` — verifies pagination stays opt-in
- `PAG-02: handler forwards offset to relay.request payload` — verifies provided `offset` is forwarded
- `PAG-02: handler forwards limit to relay.request payload` — verifies provided `limit` is forwarded
- `PAG-02: handler forwards both offset and limit together` — verifies both args forward together
- `PAG-CLAMP-01: offset=-5 produces identical output to offset=0` — verifies negative offset clamps to zero behavior
- `PAG-CLAMP-01: offset=-1 produces identical output to offset=0 (boundary)` — verifies boundary negative offset clamp
- `PAG-CLAMP-02: limit=0 produces identical output to limit=1` — verifies zero limit clamps to minimum one
- `PAG-CLAMP-02: negative limit=-3 produces identical output to limit=1 (boundary)` — verifies negative limit clamp
- `PAG-CLAMP-03: limit=10000 produces identical output to limit=500 (effective cap = 500)` — verifies limit clamps to default effective cap
- `PAG-CLAMP-03: limit=5000 with maxSegments=3000 produces identical output to limit=2000` — verifies limit clamps to absolute text-map cap
- `PAG-CLAMP-03: limit=500 (at effective cap) passes through unchanged — no error produced` — verifies boundary cap value is accepted unchanged
- `PAG-03: with offset+limit, result includes hasMore, nextOffset, totalAvailable` — verifies metadata appears for full pagination request
- `PAG-03: offset alone (no limit) triggers pagination metadata` — verifies metadata appears for offset-only usage
- `PAG-03: limit alone (no offset) triggers pagination metadata` — verifies metadata appears for limit-only usage
- `PAG-03: without offset/limit, pagination metadata is absent from result` — verifies backward-compatible legacy response shape
- `PAG-04: offset beyond totalAvailable returns empty segments, hasMore=false, nextOffset omitted` — verifies out-of-range pagination behavior
- `PAG-05: truncated:true from cap hit means hasMore=false in response` — verifies collector-cap truncation disables further paging
- `PAG-05-EFFCAP: user maxSegments below global cap becomes the effective cap` — verifies user-provided lower cap becomes the active ceiling
- `PAG-06: pagination uses pageId coherence — two calls with same pageId return consistent slices` — verifies pagination coherence scenario uses same-page continuity

#### `src/__tests__/page-understanding-tools.test.ts`

Run with:

```bash
cd /data/projects/accordo/packages/browser
pnpm exec vitest run src/__tests__/page-understanding-tools.test.ts
```

Pagination coverage in this file:

- `PAG-01: browser_get_page_map tool accepts offset?: number in inputSchema` — verifies `offset` exists in page-map schema
- `PAG-01: browser_get_page_map tool accepts limit?: number in inputSchema` — verifies `limit` exists in page-map schema
- `PAG-01: offset and limit are not required — pagination is purely opt-in` — verifies pagination stays optional
- `PAG-02: handleGetPageMap forwards offset to relay.request payload` — verifies provided `offset` is forwarded
- `PAG-02: handleGetPageMap forwards limit to relay.request payload` — verifies provided `limit` is forwarded
- `PAG-02: handleGetPageMap forwards both offset and limit together` — verifies both args forward together
- `PAG-CLAMP-01: offset=-5 produces identical output to offset=0` — verifies negative offset clamps to zero behavior
- `PAG-CLAMP-01: offset=-1 produces identical output to offset=0 (boundary)` — verifies boundary negative offset clamp
- `PAG-CLAMP-02: limit=0 produces identical output to limit=1` — verifies zero limit clamps to minimum one
- `PAG-CLAMP-02: negative limit=-3 produces identical output to limit=1 (boundary)` — verifies negative limit clamp
- `PAG-CLAMP-03: limit=10000 produces identical output to limit=200 (effective cap = 200)` — verifies limit clamps to default page-map effective cap
- `PAG-CLAMP-03: limit=600 with maxNodes=800 produces identical output to limit=500` — verifies limit clamps to absolute page-map cap
- `PAG-CLAMP-03: limit=200 (at effective cap) passes through unchanged — no error produced` — verifies boundary cap value is accepted unchanged
- `PAG-03: with offset+limit, result includes hasMore, nextOffset, totalAvailable` — verifies metadata appears for full pagination request
- `PAG-03: offset alone (no limit) triggers pagination metadata` — verifies metadata appears for offset-only usage
- `PAG-03: limit alone (no offset) triggers pagination metadata` — verifies metadata appears for limit-only usage
- `PAG-03: without offset/limit, pagination metadata is absent from result` — verifies backward-compatible legacy response shape
- `PAG-04: offset beyond totalAvailable returns empty nodes, hasMore=false, nextOffset omitted` — verifies out-of-range pagination behavior
- `PAG-05: truncated:true from cap hit means hasMore=false in response` — verifies collector-cap truncation disables further paging
- `PAG-05-EFFCAP: user maxNodes below global cap becomes the effective cap` — verifies user-provided lower cap becomes the active ceiling
- `PAG-06: pagination uses pageId coherence — two calls with same pageId return consistent slices` — verifies pagination coherence scenario uses same-page continuity

### 1b. Browser-extension relay pagination regression tests

```bash
cd /data/projects/accordo/packages/browser-extension
pnpm exec vitest run tests/relay-page-map-frames.test.ts
```

**Expected:** 16 tests pass in 1 file. 0 failures.

This command verifies the browser-extension relay handler path remains compatible with paginated page-understanding responses.

Pagination coverage in this file:

- `PAG-03 passthrough: get_page_map preserves content-script response when metadata is omitted` — verifies the relay frame handler preserves a content-script page-map payload without inventing pagination metadata
- `PAG-03 passthrough: get_text_map preserves content-script response when metadata is omitted` — verifies the relay frame handler preserves a content-script text-map payload without inventing pagination metadata

### 1c. Full browser package regression suite

```bash
cd /data/projects/accordo/packages/browser
pnpm test -- --run
```

**Expected:** 1084 tests pass across 37 files. 0 failures.

Verifies the pagination work does not regress unrelated browser tools.

### 1d. Full browser-extension regression suite

```bash
cd /data/projects/accordo/packages/browser-extension
pnpm test -- --run
```

**Expected:** 1255 tests pass across 50 files. 0 failures.

Verifies the pagination work does not regress other browser-extension relay and collector behavior.

### 1e. Type checker

```bash
cd /data/projects/accordo/packages/browser
pnpm typecheck
```

**Expected:** exits 0. Zero TypeScript errors.

Verifies the new pagination types and handler changes are type-safe.

### 1f. Linter

```bash
cd /data/projects/accordo/packages/browser
pnpm lint
```

**Expected:** exits 0. No lint errors.

Verifies the implementation and tests follow coding guidelines.

---

## Section 2 — User Journey Tests

These checks use the product through its actual interaction model: a user asking an MCP client/agent connected to Accordo to inspect a live browser page.

### Journey 1: Page map pagination returns a first chunk

**Setup:**
1. Start the workspace in dev mode and connect the browser extension
2. Open a long page in the connected browser
3. Use an MCP client connected to Accordo

**Steps:**
1. Ask the client to call `accordo_browser_get_page_map` with `limit: 5`

**Expected:**
- Response includes `nodes` with 5 or fewer items
- Response includes `hasMore`, `totalAvailable`, and possibly `nextOffset`
- Response does not error

### Journey 2: Page map can fetch the next chunk

**Steps:**
1. Call `accordo_browser_get_page_map` with `offset: 0, limit: 5`
2. Note the returned `nextOffset`
3. Call `accordo_browser_get_page_map` again with that `nextOffset` and `limit: 5`

**Expected:**
- The second response returns the next slice of page nodes
- `pageId` stays the same if the page was not navigated
- `nextOffset` advances until `hasMore` becomes `false`

### Journey 3: Text map pagination works for long text pages

**Steps:**
1. Open a page with many paragraphs or rows of text
2. Call `accordo_browser_get_text_map` with `limit: 10`
3. Repeat with the returned `nextOffset`

**Expected:**
- Each response returns a chunk of text segments in reading order
- Metadata appears only because pagination args were supplied
- Pagination stops cleanly when `hasMore` becomes `false`

### Journey 4: Legacy calls still work without pagination args

**Steps:**
1. Call `accordo_browser_get_page_map` with no `offset` and no `limit`
2. Call `accordo_browser_get_text_map` with no `offset` and no `limit`

**Expected:**
- Both calls succeed
- Responses keep their legacy shape
- `hasMore`, `nextOffset`, and `totalAvailable` are absent

### Journey 5: Invalid pagination inputs are safely normalized

**Steps:**
1. Call `accordo_browser_get_page_map` with `offset: -5, limit: 0`
2. Call `accordo_browser_get_text_map` with `offset: -1, limit: 10000`

**Expected:**
- Calls succeed rather than erroring
- Negative offsets behave like `0`
- Too-small limits behave like `1`
- Too-large limits behave like the effective cap for that tool
