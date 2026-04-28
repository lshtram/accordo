## Architect Review — Spatial Relations Review Friction

### 1. Why This Loop Kept Failing

#### True product/correctness requirements

These are real contract requirements, not reviewer preference:

- **Snapshot-aware identity must be explicit**: spatial relations cannot resolve against a mutable latest ref index; they must be tied to a `snapshotId`.
- **Validation precedence matters**: malformed request shape/UID/frame mixing must fail as `invalid-request` before stale/not-found classification.
- **Public error vocabulary must be preserved end-to-end**: this finding is not closed if a bad request can degrade into generic relay errors like `action-failed` or `no-content-script`.
- **Routing must match the contract**: `uids[]` same-frame only, `nodeIds[]` main-frame only, mixed modes rejected.
- **Boundary proof is required**: the public contract is the relay/MCP path, not a helper.

Those are driven by:
- `coding-guidelines.md` input validation and error handling rules (§1.4, §3.1, §3.6).
- `mcp-tool-documentation-contract.md` requirement that runtime behavior and docs align.
- browser evaluation checklist emphasis on stable identity, cross-frame continuity, snapshot versioning, and error taxonomy.
- architecture docs for `snapshot-not-found` / `snapshot-stale` and the spatial-relations design.

#### Reviewer-specific structural standards

These were also blocking, but they are mostly repo review practice, not pure product behavior:

- touched function `<=30` lines
- touched file `<=150` lines
- touched test file `<=150` lines
- focused test files by concern
- no helper-only evidence when public behavior is what matters

#### Why green focused tests were insufficient

Because in this repo, green tests are necessary but not sufficient. D2 review checks more than behavior:

- contract precision
- architecture compliance
- SSOT compliance
- public error preservation
- full-boundary evidence
- modularity gates

A helper test proving `getSpatialRoutingFrame()` is green does not prove that `handleRemotePageUnderstandingAction()` preserves `invalid-request` instead of collapsing to relay-level failures.

### 2. Which Standards Are Driving The Strictness

#### Clearly documented standards

- **Validate all external input at boundaries**
  `coding-guidelines.md:64-67, 143-149`
  This drives the insistence on rejecting malformed `uids[]`, `nodeIds[]`, mixed identity modes, and bad `snapshotId`s precisely.

- **Test the contract, not the implementation**
  `coding-guidelines.md:115-118`
  This is the main reason helper-only proof was rejected.

- **At least one end-to-end / real-boundary test**
  `coding-guidelines.md:182-184`
  This directly explains why reviewer kept asking for the real relay path.

- **Single source of truth / no duplicate runtime meaning**
  `coding-guidelines.md:75-84`
  This drove the canonical parser fight and the ban on ad hoc UID splitting.

- **Architecture boundaries**
  `AGENTS.md:139-145` and `coding-guidelines.md:168-175`
  This supports “no relay -> content imports” and “bridge-types is types-only”.

- **Runtime docs must match real tool behavior**
  `mcp-tool-documentation-contract.md:22-26, 45-54, 66-70`
  This is why contract precision mattered, not just code behavior.

- **Browser-tool quality bar includes stable snapshot identity and error taxonomy**
  `mcp-webview-agent-evaluation-checklist.md:116-129, 166-173, 255-269`
  This reinforces snapshot-aware identity and stable error semantics.

#### Standards that seem institutional but under-documented

- **30-line function / 150-line file / 150-line test limits**
  - Canonical guideline says roughly `~40` lines per function and `~200` lines per file (`coding-guidelines.md:48, 160-161`).
  - But review docs repeatedly enforce a stricter hard gate: `<=30` and `<=150`.
  - Evidence: `docs/reviews/accordo-browser-select-page-D2.md`, `runtime-directives-D2.md`, `spatial-relations-identity-D2.md`.

So the strictness is partly from written standards, and partly from a reviewer-enforced “iron rule” that is stronger than the published guideline.

### 3. Failure Pattern Analysis

#### Repeated pattern

The loop followed this pattern:

1. Fix the core bug
2. Reviewer says: behavior alone is insufficient
3. Add contract/routing work
4. Reviewer says: public error preservation still unproven
5. Add tests
6. Reviewer says: wrong test boundary
7. Split code
8. Reviewer says: still over modularity cap / wrong file / wrong proof surface

#### What was missing in the handoff

The plan was not operationalized as a full review-closure checklist up front.

The team had the behavioral intent, but not a single explicit list of:

- exact public contract invariants
- exact routing invariants
- exact error-preservation invariants
- required proof boundary
- required extraction seams
- hard modularity caps to satisfy before review

So developer iterations optimized for “probably correct now,” while the reviewer was checking “fully compliant with repo review doctrine.”

#### Another friction source: artifact drift

Current artifacts suggest some blocker references may already have moved:

- `relay-page-remote.ts` is now 100 lines
- `validateSpatialShape()` appears already split below the original cited size
- the remaining large function seems to have migrated into `relay-page-remote-helpers.ts`

That suggests part of the loop may also be review artifact drift: the blocker stayed conceptually the same, but the cited file/function lagged the code. That makes closure harder because the team is no longer arguing about one stable target.

### 4. Was The Strictness Reasonable?

#### Reasonable / justified

These demands are justified for Accordo:

- snapshot-aware contract
- preserve `invalid-request` vs generic relay failure
- single parser / SSOT
- no cross-layer imports that break package boundaries
- real relay-path testing
- stable validation precedence

Why? Because Accordo is an MCP surface. If contract semantics drift, external agents get inconsistent behavior they cannot safely reason about.

#### Potentially too rigid / process-heavy

These seem heavier than necessary unless better documented:

- `<=30` function and `<=150` file/test caps as hard blockers
- rejecting otherwise-correct work for modularity before explicitly documenting those caps centrally
- repeated rechecks that discover one more structural gate at a time instead of using one up-front closure matrix

My view: the contract strictness is reasonable; the process strictness is only partly reasonable because some of it lives in reviewer precedent rather than clearly in the canonical guideline file.

### 5. How To Avoid This Next Time

#### Better up-front checklist for MCP/browser-tool fixes

Before implementation starts, the fix plan should include:

1. **Public contract**
   - required inputs
   - invalid combinations
   - precedence order
   - exact public error outcomes

2. **Boundary ownership**
   - where canonical parsing lives
   - what each package may import
   - what must not cross package boundaries

3. **Routing truth table**
   - `nodeIds[]`
   - `uids[]`
   - mixed inputs
   - malformed inputs
   - stray legacy fields
   - frame mismatch cases

4. **Proof plan**
   - helper/unit tests
   - one real relay-path test
   - explicit assertion that public error vocabulary is preserved

5. **Modularity plan**
   - target files/functions to split first
   - expected max size per file/function
   - test-file split plan

6. **Runtime-doc impact**
   - tool description/schema text affected
   - architecture/runtime docs affected

#### What should be in the fix plan before development

A one-page “done when” matrix:

- behavior fixed
- public errors preserved
- same-frame/mixed rules enforced
- canonical parser used everywhere
- no forbidden imports
- relay path tested
- touched functions/files under repo gate
- review doc updated to actual files/functions

That would have prevented most of this loop.

### 6. Immediate Advice For Closing This Finding

In plain language, the remaining work is:

1. **Finish the last structural cleanup**
   - Any remaining oversized helper/function involved in this fix needs to be split until it satisfies the reviewer’s modularity gate.
   - Based on current artifacts, this likely means checking the extracted helper module, not just the original file named in the D2 note.

2. **Add one real public-path proof**
   - Test `handleRemotePageUnderstandingAction()` itself, not just `getSpatialRoutingFrame()`.
   - Prove that malformed/mixed spatial requests still surface as `invalid-request` through the real relay path, rather than degrading to `action-failed` or `no-content-script`.

3. **Rebaseline the review artifact**
   - Update the blocker references so reviewer and developer are talking about the same current files/functions.
   - Right now the artifact trail appears partially stale, which itself prolongs closure.

### Bottom line

This loop kept failing because the team treated it like a bug fix, while the reviewer treated it like a contract-hardening change on a public MCP surface. In Accordo, that means behavior, boundary ownership, public error semantics, runtime-proof testing, and modularity all have to close together. The strictness is mostly justified on contract integrity, but the hard modularity gates should be documented more explicitly to avoid future surprise.
