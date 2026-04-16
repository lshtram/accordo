# Accordo Modularity Perfect-Score Plan

## Goal

Get every modality package to a "perfect score" on modularity:

1. Each modality can exist without the others.
2. Each package has a thin composition root.
3. Core logic is separated from VS Code / browser / webview host APIs.
4. All cross-package collaboration uses shared contracts.
5. Replacing a module implementation is practical, not theoretical.

---

## What “perfect score” means

### Package-level modularity

- Browser does not structurally depend on Diagram, Voice, or Presentation.
- Diagram does not structurally depend on Browser or Voice.
- Presentation does not structurally depend on a specific engine implementation.
- Comments integrations are optional, not architectural hard requirements.
- Cross-extension collaboration happens through shared capabilities/contracts only.

### Internal modularity

- `extension.ts` / bootstrap files only wire services.
- Domain/runtime logic lives outside activation.
- Host adapters are isolated.
- Tool handlers orchestrate collaborators instead of embedding multiple policies.
- Each package exposes one obvious public surface.

---

## Cross-cutting work for the whole repo

Before module-specific work, establish these repo-wide rules.

### 1. Standardize package layering

Use the same broad shape across modality packages:

- `extension.ts` or `bootstrap.ts` — composition root only
- `contracts/` — local package interfaces
- `core/` or `domain/` — pure logic
- `adapters/` — VS Code / browser / fs / subprocess / HTTP integrations
- `tools/` — MCP tool definitions and handlers
- `ui/` or `webview/` — presentation layer only
- `integration/` — optional cross-extension integrations

#### Acceptance criteria

- No package has major business logic concentrated in activation.
- No `core/` or `domain/` module imports host APIs directly.
- Integration code is obvious and isolated.

### 2. Centralize shared contracts

Use shared packages as the only source of truth:

- `@accordo/bridge-types` for shared data contracts
- `@accordo/capabilities` for commands and extension capability interfaces
- Add `@accordo/browser-relay-types` if browser relay contract is too large for `bridge-types`

#### Acceptance criteria

- No duplicated action unions across packages.
- No duplicated error enums across packages.
- No local interfaces that shadow shared interfaces.

### 3. Adopt one modularity review checklist

Apply this checklist to every modality package:

- One thin composition root
- No direct modality-to-modality imports except shared contracts/capabilities
- No raw command string coupling outside capabilities package
- No runtime-specific casts through abstraction boundaries
- No `vscode` imports in core/domain logic
- Optional integrations must degrade gracefully

#### Acceptance criteria

- Same rubric can be used in every modularity review.
- Reviewers can reject changes that break dependency direction.

---

## Module plan: Browser (`packages/browser`)

### Current issues

- `src/extension.ts` owns too many responsibilities.
- Relay contract is duplicated with `browser-extension`.
- Page tool handlers mix transport, policy, redaction, storage, and response shaping.
- Comments integration is deeply embedded in activation flow.

### Target architecture

Browser becomes a relay-backed modality host with:

- optional comments integration
- replaceable transport and security policy
- isolated snapshot retention responsibilities

### Work items

#### B-1. Split the composition root

Break `src/extension.ts` into focused modules:

- `browser-bootstrap.ts`
  - activation/deactivation orchestration only
- `browser-relay-bootstrap.ts`
  - relay discovery, lock acquisition, relay startup
- `browser-tool-registration.ts`
  - tool list assembly and bridge registration
- `browser-comment-sync.ts`
  - sync algorithm only
- `browser-state-publisher.ts`
  - modality state publishing
- `browser-comments-integration.ts`
  - comment notifier and bridge wiring

##### Why

Activation should wire services, not contain sync algorithms and transport setup details.

##### Acceptance criteria

- `src/extension.ts` is under ~150 lines.
- Each extracted file has one clear responsibility.
- Browser can activate without eagerly loading comments-specific orchestration.

#### B-2. Extract a shared relay contract

Move these to a shared package:

- relay action union
- request envelope
- response envelope
- error code union
- shared snapshot envelope fields if duplicated

##### Why

Browser and browser-extension should never hand-maintain matching wire contracts.

##### Acceptance criteria

- Browser and browser-extension import the same relay contract package.
- Adding a new action requires one contract change, not mirrored edits.

#### B-3. Split page tool handler responsibilities

Refactor `src/page-tool-handlers-impl.ts` into smaller modules:

- `page-tool-transport.ts`
  - relay request/response handling
- `page-tool-origin-policy.ts`
  - origin validation
- `page-tool-redaction.ts`
  - redaction application
- `page-tool-snapshot-persistence.ts`
  - retention store save/retrieve logic
- `page-tool-response.ts`
  - structured errors and final response shaping

##### Why

Current handlers mix too many policies.

##### Acceptance criteria

- Per-tool handler functions become orchestration only.
- Security policy can be tested without transport tests.
- Snapshot behavior can be changed without editing each handler.

#### B-4. Make comments integration optional

Introduce local contracts such as:

- `BrowserCommentSyncTarget`
- `BrowserCommentNotifier`

Provide comments-backed adapters in a separate integration layer.

##### Why

Browser page inspection/control should remain coherent even without comments installed.

##### Acceptance criteria

- Browser works for page understanding/control with comments disabled.
- Comments sync is injected, not structurally embedded.

#### B-5. Remove or quarantine deprecated tool surface

Move deprecated `browser-tools.ts` under `legacy/` or remove once no longer needed.

##### Acceptance criteria

- There is one obvious active browser tool surface.
- Deprecated code no longer muddies the public package shape.

### Perfect-score end state

- Thin bootstrap
- Shared relay contract
- Optional comments integration
- Clean split between policy, transport, storage, and handlers
- Replaceable browser backend path

---

## Module plan: Browser Extension (`packages/browser-extension`)

### Current issues

- Relay host/port/token are hardcoded.
- Transport assumptions are embedded in the relay client.
- Shared state patterns rely on module-level singletons.

### Target architecture

Browser-extension becomes:

- a configurable transport client
- a page instrumentation package
- a set of handler families with explicit dependencies

### Work items

#### BE-1. Externalize relay connection config

Move these out of constants and into runtime config:

- host
- port
- auth token
- reconnect policy

Create modules such as:

- `relay-config.ts`
- `RelayConnectionConfigProvider`

##### Why

Hardcoded connection parameters make transport replacement and deployment variation painful.

##### Acceptance criteria

- No hardcoded relay token remains in source.
- Relay URL is derived from an injected config object.
- Tests can instantiate a relay client with custom config.

#### BE-2. Keep transport separate from domain dispatch

`RelayBridgeClient` should only own:

- connect
- reconnect
- send/receive
- heartbeat

Domain action semantics remain elsewhere.

##### Acceptance criteria

- Transport class has no domain-specific branching.
- Swapping WebSocket transport does not affect handlers.

#### BE-3. Reduce hidden singleton dependencies

Where practical, create shared instances in the composition root and inject them into handlers instead of importing module-level singletons.

##### Acceptance criteria

- Handlers can run in isolated tests with isolated stores/managers.
- Runtime state creation is explicit.

#### BE-4. Formalize handler families

Organize code into stable families:

- `handlers/comments/`
- `handlers/page/`
- `handlers/control/`
- `handlers/capture/`
- `transport/`
- `content/`

##### Acceptance criteria

- No handler file mixes unrelated concerns.
- Folder layout communicates ownership clearly.

### Perfect-score end state

- Configurable transport
- Shared relay contract
- Minimal singleton coupling
- Clean handler families
- Easier future backend swap

---

## Module plan: Diagram (`packages/diagram`)

### Current issues

- Overall decomposition is good, but the host boundary is less strict than docs imply.
- Panel-related orchestration is still concentrated.
- Comments integration must remain adapter-only.

### Target architecture

Diagram becomes:

- a diagram engine pipeline wrapped by a VS Code host adapter
- with clear parse / reconcile / layout / render boundaries
- with optional comment integration

### Work items

#### D-1. Make the host boundary explicit

Choose and document one of these:

- strict boundary: only a minimal set of files import `vscode`
- adapter boundary: all `webview/` host-side modules are part of the adapter layer and may import `vscode`

##### Recommendation

Treat `webview/` as the adapter layer and document it honestly.

##### Acceptance criteria

- Architecture docs match real imports.
- There is no confusion about which modules are host adapters.

#### D-2. Split panel orchestration further

Create focused modules such as:

- `panel-host.ts`
  - panel lifecycle
- `panel-message-router.ts`
  - webview-to-host message routing
- `panel-scene-loader.ts`
  - load/parse/reconcile/layout/render orchestration
- `panel-export.ts`
  - export flow only
- `panel-comments-adapter.ts`
  - comment bridge hookup only

##### Why

Panel code should coordinate collaborators rather than own every behavior directly.

##### Acceptance criteria

- Panel class is primarily a coordinator.
- Scene loading and comment bridging can be tested independently.

#### D-3. Harden engine boundaries

Formalize these stages:

- parser → semantic diagram graph
- reconciler → updated layout semantics
- layout engine → coordinates only
- canvas generator → semantic graph to visual model
- scene adapter → visual model to Excalidraw payload

##### Acceptance criteria

- Excalidraw replacement would not require rewriting parser/reconciler/layout.
- Parser replacement would not require rewriting panel host.

#### D-4. Isolate comment SDK usage

Keep `@accordo/comment-sdk` confined to a small adapter layer only.

##### Acceptance criteria

- Core diagram logic has zero dependency on comment SDK.
- Comments can be disabled without affecting load/render/edit.

#### D-5. Publish internal import direction rules

Rules should include:

- parser cannot import webview
- canvas cannot import vscode
- layout cannot import comment bridge
- tool handlers operate through `DiagramPanelLike`

##### Acceptance criteria

- Dependency direction is explicit and reviewable.

### Perfect-score end state

- Engine stages are truly separated
- Host adapter boundary is clear
- Comments are optional
- Rendering backend is replaceable

---

## Module plan: Presentation / Marp (`packages/marp`)

### Current issues

- Engine-neutral abstraction is incomplete.
- Marp-specific behavior leaks through casts.
- Command surface is inconsistent.

### Target architecture

Presentation becomes:

- a generic presentation host contract
- Marp as one backend implementation
- optional comments/navigation/state built against engine-neutral interfaces

### Work items

#### P-1. Complete the runtime adapter interface

Add to `PresentationRuntimeAdapter` whatever `PresentationProvider` actually needs for webview-originated slide sync.

Possible additions:

- `setCurrentSlideFromView(index: number): void`
- or `handleViewSlideChanged(index: number): void`

##### Acceptance criteria

- `presentation-provider.ts` contains no engine-specific cast.
- All presentation engines can implement the interface honestly.

#### P-2. Split generic presentation host from Marp engine

Reorganize around:

- `presentation-host/`
  - session lifecycle
  - state publishing
  - tool wiring
  - panel coordination
- `engines/marp/`
  - Marp parse/validate/render/navigation specifics

##### Acceptance criteria

- Host orchestration has no Marp-specific assumptions.
- Marp can be replaced without rewriting host flow.

#### P-3. Standardize capability commands

Put canonical presentation capability commands in `@accordo/capabilities` for:

- open
- close
- goto
- next
- prev
- focus thread

##### Acceptance criteria

- Comments/navigation integrations call capability constants only.
- No engine-specific command names are depended on externally.

#### P-4. Split provider responsibilities

Break provider concerns into modules such as:

- `presentation-panel.ts`
- `presentation-webview-html.ts`
- `presentation-reload.ts`
- `presentation-comment-adapter.ts`

##### Acceptance criteria

- Provider becomes lifecycle coordinator only.
- Reload and message handling evolve independently.

#### P-5. Remove local duplicate adapter types

Prefer shared capability interfaces over local near-duplicates.

##### Acceptance criteria

- No `SurfaceAdapterLike` if `SurfaceCommentAdapter` is the canonical shared contract.

### Perfect-score end state

- True engine-neutral host
- Marp as one pluggable backend
- Standardized command surface
- Optional comments integration
- No casts through abstraction seams

---

## Module plan: Voice (`packages/voice`)

### Current issues

- Strong internal structure already exists.
- Core runtime still contains dynamic VS Code fallback imports.
- Policy persistence is too close to tool logic.

### Target architecture

Voice becomes:

- a portable voice runtime
- with replaceable UI, provider, recording, playback, and persistence adapters

### Work items

#### V-1. Remove all VS Code fallback imports from runtime/core

Require injected adapters for all UI interactions:

- `VoiceUiAdapter`
- `PolicyPersistence` if needed

##### Acceptance criteria

- `voice-runtime.ts` has zero direct or dynamic `vscode` imports.
- Runtime is testable in pure Node-style unit tests.

#### V-2. Move policy persistence behind an adapter

Refactor `tools/set-policy.ts` so it validates input and delegates persistence to an injected service instead of importing VS Code config details.

##### Acceptance criteria

- Tool handler contains no host-specific persistence policy.
- Config backend can be swapped without editing tool logic.

#### V-3. Split extension orchestration further

Extract:

- `voice-service-factory.ts`
- `voice-command-registration.ts`
- `voice-tool-registration.ts`
- `voice-availability-bootstrap.ts`

##### Acceptance criteria

- `extension.ts` mainly wires collaborators.
- Availability and registration code are isolated.

#### V-4. Harden provider contracts

Formalize exact contracts for:

- STT providers
- TTS providers
- recording
- playback

Include capability, lifecycle, and error semantics.

##### Acceptance criteria

- Adding a backend does not require changes scattered across runtime.
- Provider swap is localized to provider creation and contract implementation.

#### V-5. Keep UI purely adapter-level

Everything under `ui/` should remain presentation-only:

- status bar
- panel
- logger

##### Acceptance criteria

- Runtime tests do not instantiate UI classes.
- UI replacement does not require core runtime changes.

### Perfect-score end state

- Portable runtime
- Replaceable providers
- Zero VS Code leakage in core
- Abstracted policy persistence
- UI isolated as adapter layer

---

## Module plan: Comments (`packages/comments`)

### Current issues

- Domain split is strong.
- Comments package knows too much about modality-specific navigation.
- Integration code hardcodes author identity defaults.

### Target architecture

Comments becomes:

- a generic comment domain + VS Code adapter
- with optional modality integrations
- without being the command/routing brain for every modality

### Work items

#### C-1. Move modality navigation to pluggable adapters

Replace centralized routing logic with a registry such as:

- `CommentNavigationAdapterRegistry`
- `registerNavigationAdapter(surfaceType, adapter)`

Adapters are supplied by modality packages.

##### Acceptance criteria

- Comments panel does not hardcode browser/diagram/presentation navigation behavior.
- Adding a new surface type requires registration, not router edits.

#### C-2. Move author policy out of integration wiring

Introduce a small author policy abstraction:

- `CommentAuthorPolicy`
- `resolveInteractiveAuthor()`
- `resolveAgentAuthor()`

##### Acceptance criteria

- Integration layer does not hardcode `"User"` policy.
- Author naming/identity behavior is centralized and replaceable.

#### C-3. Tighten domain / persistence / UI boundaries

Strengthen the current split:

- `comment-repository.ts` → domain only
- `comment-store.ts` → persistence adapter only
- `native-*` → VS Code Comments API only
- `panel/` → custom comments panel only
- `integration/` → inter-extension commands only

##### Acceptance criteria

- No accidental VS Code dependencies reach domain modules.
- Package sub-boundaries are obvious.

#### C-4. Keep integrations optional

Browser/diagram/presentation integrations should be capability-based and optional.

##### Acceptance criteria

- Comments works meaningfully for text/file comments without any modality package installed.
- Surface-specific behavior degrades gracefully.

#### C-5. Harden the public API surface

Continue tightening `index.ts` so only stable domain/integration contracts are public.

##### Acceptance criteria

- Internal VS Code adapter machinery is not part of the public API surface.
- External packages import only stable contracts.

### Perfect-score end state

- Generic comment domain at the center
- No hardcoded modality routing logic
- Author policy abstracted
- Integrations registered and optional

---

## Shared package plan: Bridge Types (`packages/bridge-types`)

### Role

Canonical source of cross-package data contracts.

### Work items

#### BT-1. Expand only for true shared contracts

Good candidates:

- browser relay contracts
- shared structured tool response contracts
- comment anchor/data contracts
- modality state summaries used across packages

#### BT-2. Keep it logic-light

Allow:

- types
- constants
- minimal type guards only when justified

Disallow:

- host-specific logic
- runtime orchestration
- package behavior

### Acceptance criteria

- All cross-package data contracts live here or another dedicated shared package.
- No VS Code/browser-specific behavior lives here.

---

## Shared package plan: Capabilities (`packages/capabilities`)

### Role

Canonical source of optional extension-to-extension collaboration contracts.

### Work items

#### CAP-1. Centralize all cross-extension command IDs

Especially:

- presentation open/close/goto/focus
- diagram focus/open if shared
- browser focus thread
- comments integration commands

#### CAP-2. Centralize cross-extension interfaces

Examples:

- `SurfaceCommentAdapter`
- `CommentNavigationAdapter`
- `PresentationNavigator`
- future browser/diagram navigator contracts

### Acceptance criteria

- No raw command string coupling remains outside this package.
- Cross-extension collaboration uses shared interfaces only.

---

## Recommended execution order

### Phase 1 — shared foundations

1. Create repo-wide modularity checklist
2. Centralize shared contracts
3. Standardize capability commands and interfaces

### Dependency rules / what must come before what

#### Must happen first

- **Shared contract work must precede package cleanup** when package cleanup depends on those contracts.
  - Example: browser + browser-extension relay contract unification should happen before deeper handler cleanup in those packages.
- **Capability command/interface standardization must precede comments/presentation navigation cleanup.**
  - Comments should not be refactored to adapter-based navigation until the canonical capability interfaces exist.
- **Presentation runtime contract completion must precede engine-neutral host cleanup.**
  - Do not split Marp host/engine more deeply until the runtime adapter is complete.

#### Can happen after foundations but independently

- Diagram host-boundary cleanup
- Voice runtime purity cleanup
- Browser composition-root split
- Browser page-tool handler split
- Public API tightening in individual packages

### Parallelization plan

#### Track A — Shared foundations (mostly sequential)

These are best done in order, not in parallel:

1. Repo-wide modularity checklist
2. Shared contract consolidation
3. Capability command/interface consolidation

Reason: these define the target seams other modules should code against.

#### Track B — Browser family

These can be partly parallelized **after** shared relay contract direction is decided:

- **B-1 Split browser composition root**
- **BE-1 Externalize browser-extension relay config**
- **BE-4 Formalize browser-extension handler families**

These should wait until contract work is done or nearly done:

- **B-2 Extract shared relay contract** → should come before most browser/browser-extension deeper refactors
- **B-3 Split browser page tool handlers** → after B-2
- **B-4 Optionalize browser comments integration** → after capabilities/interfaces are stable

#### Track C — Presentation + Comments integration

These are dependency-coupled and should mostly happen in this order:

1. **CAP-1 / CAP-2** standardize presentation-related capabilities
2. **P-1** complete `PresentationRuntimeAdapter`
3. **C-1** move comments navigation to pluggable adapters
4. **P-2 / P-3 / P-4 / P-5** finish presentation host/engine separation

Parallelizable once capabilities are stable:

- comments author-policy cleanup (**C-2**)
- presentation provider responsibility split (**P-4**)

#### Track D — Voice

Voice work is mostly independent and can run in parallel with Browser or Diagram after Phase 1:

- **V-1** remove VS Code fallback imports from runtime/core
- **V-2** move policy persistence behind an adapter
- **V-3** split extension orchestration
- **V-4 / V-5** harden provider/UI boundaries

Recommended internal order:

1. V-1
2. V-2
3. V-3
4. V-4 and V-5 in parallel

#### Track E — Diagram

Diagram work is also mostly independent and can run in parallel with Voice or Browser after Phase 1:

- **D-1** host-boundary clarification
- **D-2** split panel orchestration
- **D-3** harden engine boundaries
- **D-4** isolate comment SDK usage
- **D-5** publish internal import direction rules

Recommended internal order:

1. D-1
2. D-2 and D-4 in parallel
3. D-3
4. D-5

### Recommended agent split

#### Sequential foundation batch

- Agent 1: shared modularity checklist
- Agent 2: shared contract consolidation (`bridge-types` / possible browser-relay-types)
- Agent 3: capabilities cleanup

Run these with coordination, not true blind parallelism.

#### Parallel module batches after foundations

Once Phase 1 is complete, these can proceed in parallel:

- **Batch 1:** Browser + browser-extension family
- **Batch 2:** Voice
- **Batch 3:** Diagram
- **Batch 4:** Presentation + comments integration

### Fast dependency summary

#### Strict prerequisites

- Shared relay contract **before** browser/browser-extension deep cleanup
- Capabilities standardization **before** comments navigation refactor
- Presentation runtime adapter completion **before** full engine-neutral presentation split

#### Safe parallel work

- Voice and Diagram can proceed in parallel after shared foundations
- Browser family can proceed in parallel with Voice/Diagram once relay contract target is fixed
- Comments author-policy cleanup can proceed in parallel with other comments work after capabilities are stable

#### Final polish should come last

- public API tightening
- docs/module map refresh
- modularity review pass
- removal of deprecated/legacy ambiguity

---

## Agent assignment matrix

This matrix assumes the standard Accordo agent roles:

- `architect` — structure, interfaces, dependency direction, stubs
- `developer` — implementation/refactor work and verification
- `reviewer` — modularity/code review gate
- `project-manager` — orchestration, batching, dependencies, user checkpoints, wrap-up

For this modularity program, use the agents as follows.

### Core rule

For each module/batch:

1. **Architect** defines target module boundaries, contracts, dependency rules, and file moves.
2. **Reviewer** checks the proposed structure before implementation starts.
3. **Developer** performs the refactor.
4. **Reviewer** does final modularity/code review.
5. **Project-manager** coordinates sequencing and cross-batch dependencies.

---

### Matrix by workstream

| Workstream | Scope | Primary Agent | Supporting Agent(s) | Why |
|---|---|---|---|---|
| Foundation A | Repo-wide modularity checklist | `architect` | `reviewer`, `project-manager` | This is architecture policy and review criteria. |
| Foundation B | Shared contract consolidation (`bridge-types`, possible browser-relay-types) | `architect` | `developer`, `reviewer` | Shared contracts need careful ownership and dependency-direction design first. |
| Foundation C | Capabilities cleanup (`@accordo/capabilities`) | `architect` | `developer`, `reviewer` | Cross-extension command/interface standardization is architectural. |
| Browser Batch | `packages/browser` | `developer` | `architect`, `reviewer` | Mostly refactoring/splitting once contracts are known. |
| Browser-Extension Batch | `packages/browser-extension` | `developer` | `architect`, `reviewer` | Mostly implementation of already-decided transport/config seams. |
| Diagram Batch | `packages/diagram` | `developer` | `architect`, `reviewer` | Internal decomposition cleanup and boundary hardening. |
| Voice Batch | `packages/voice` | `developer` | `architect`, `reviewer` | Mostly implementation-level isolation work. |
| Presentation Batch | `packages/marp` | `architect` | `developer`, `reviewer` | Needs interface completion before deeper refactor. |
| Comments Batch | `packages/comments` | `architect` | `developer`, `reviewer` | Navigation/plugin model is cross-modality design-heavy. |
| Final Integration Pass | Public APIs, docs, module maps, final modularity score | `project-manager` | `reviewer`, `developer` | Requires cross-batch reconciliation and wrap-up. |

---

## Recommended batch ownership

### Batch 0 — Foundations (sequential)

#### 0.1 Repo-wide modularity checklist
- **Lead:** `architect`
- **Review:** `reviewer`
- **Coordination:** `project-manager`

#### 0.2 Shared contract consolidation
- **Lead:** `architect`
- **Implementation:** `developer`
- **Review:** `reviewer`

#### 0.3 Capabilities standardization
- **Lead:** `architect`
- **Implementation:** `developer`
- **Review:** `reviewer`

### Why these are architect-led

These tasks define the interfaces every other module will consume. They should not be implementation-led.

---

### Batch 1 — Browser family

Runs after shared relay contract direction is fixed.

#### Browser (`packages/browser`)
- **Lead:** `developer`
- **Up-front design assist:** `architect`
- **Review:** `reviewer`

#### Browser-extension (`packages/browser-extension`)
- **Lead:** `developer`
- **Up-front design assist:** `architect`
- **Review:** `reviewer`

### Why developer-led

Once contracts are fixed, this is mostly decomposition and implementation work.

### Internal order

1. Architect defines final split for browser/bootstrap/handlers/transport boundaries
2. Developer implements shared relay contract adoption
3. Developer splits browser composition root
4. Developer refactors browser-extension config/transport boundaries
5. Developer splits browser page-tool handlers
6. Reviewer performs browser-family modularity review

---

### Batch 2 — Voice

Can run in parallel with Browser or Diagram after foundations.

- **Lead:** `developer`
- **Up-front design assist:** `architect`
- **Review:** `reviewer`

### Why developer-led

Voice already has good internal structure. Remaining work is mostly boundary tightening and adapter extraction.

### Internal order

1. Architect confirms runtime/core boundary rules
2. Developer removes VS Code fallback imports from runtime
3. Developer abstracts policy persistence
4. Developer splits remaining bootstrap/orchestration if needed
5. Reviewer verifies runtime purity and provider replaceability

---

### Batch 3 — Diagram

Can run in parallel with Voice and much of Browser after foundations.

- **Lead:** `developer`
- **Up-front design assist:** `architect`
- **Review:** `reviewer`

### Why developer-led

Diagram already has meaningful substructure. The main work is clarifying and enforcing boundaries.

### Internal order

1. Architect defines host-adapter boundary and import direction rules
2. Developer splits panel orchestration
3. Developer isolates comment SDK usage
4. Developer strengthens engine-stage contracts
5. Reviewer validates dependency direction and replaceability

---

### Batch 4 — Presentation + Comments integration

Runs after capabilities standardization, and presentation contract work should begin before deeper refactor.

#### Presentation / Marp (`packages/marp`)
- **Lead:** `architect`
- **Implementation:** `developer`
- **Review:** `reviewer`

#### Comments (`packages/comments`)
- **Lead:** `architect`
- **Implementation:** `developer`
- **Review:** `reviewer`

### Why architect-led

This batch defines cross-modality interaction shape:

- presentation runtime contract
- comments navigation adapter model
- surface-specific navigation responsibilities

These are architecture-first tasks.

### Internal order

1. Architect defines canonical presentation capability contracts
2. Architect completes presentation runtime adapter target design
3. Architect defines comments navigation adapter registry shape
4. Reviewer checks the design
5. Developer implements presentation host/engine split and comments adapter model
6. Reviewer validates modularity and removal of hardcoded cross-modality routing

---

## Parallel execution matrix

| Time window | Batch | Can run with | Must wait for |
|---|---|---|---|
| Window 1 | Foundations | nothing (best sequential) | none |
| Window 2 | Browser family | Voice, Diagram | shared contract direction |
| Window 2 | Voice | Browser family, Diagram | foundations complete |
| Window 2 | Diagram | Browser family, Voice | foundations complete |
| Window 3 | Presentation + Comments integration | limited parallelism inside batch | capabilities standardization |
| Window 4 | Final integration/docs/review | nothing important in parallel | all module batches complete |

---

## Suggested concrete agent deployment

If multiple agents are available concurrently, use this arrangement.

### Round 1

- **Agent A (`architect`)** — modularity checklist + shared contract target design
- **Agent B (`architect`)** — capabilities cleanup design
- **Agent C (`project-manager`)** — dependency tracking, batching, review scheduling

### Round 2

- **Agent D (`developer`)** — Browser family
- **Agent E (`developer`)** — Voice
- **Agent F (`developer`)** — Diagram
- **Agent G (`architect`)** — Presentation + Comments architecture design
- **Agent H (`reviewer`)** — reviews completed batches as they finish

### Round 3

- **Agent D (`developer`)** — implement Presentation plan
- **Agent E (`developer`)** — implement Comments adapter-registry plan
- **Agent H (`reviewer`)** — review Presentation + Comments batch
- **Agent C (`project-manager`)** — integration coordination and final backlog reshuffle

### Round 4

- **Agent C (`project-manager`)** — final docs/module map cleanup orchestration
- **Agent H (`reviewer`)** — final repo-wide modularity pass

---

## Simple assignment summary

### Architect should lead

- modularity checklist
- shared contracts
- capabilities package
- presentation runtime abstraction
- comments navigation/plugin model

### Developer should lead

- browser split/refactor
- browser-extension transport/config refactor
- diagram decomposition cleanup
- voice boundary hardening
- implementation of architect-defined presentation/comments changes

### Reviewer should gate

- after each architecture proposal
- after each module batch implementation
- final repo-wide modularity review

### Project-manager should own

- ordering
- dependency enforcement
- checkpointing between batches
- cross-batch conflict resolution
- final documentation/integration pass

### Phase 2 — biggest architecture risks

4. Split browser composition root
5. Unify browser relay contract
6. Complete presentation runtime abstraction
7. Move comments navigation to pluggable adapters

### Phase 3 — boundary hardening

8. Remove VS Code fallback from voice runtime
9. Split browser page tool handlers
10. Formalize diagram adapter boundary
11. Remove duplicate local interfaces

### Phase 4 — polish and enforcement

12. Remove legacy/deprecated ambiguity
13. Tighten public export surfaces
14. Update module maps/docs to match actual boundaries
15. Add modularity checks to code review standards

---

## High-ROI top four priorities

If only a few items are done first, do these:

1. Unify browser relay contract
2. Split browser composition root
3. Complete presentation runtime abstraction
4. Turn comments navigation into pluggable modality adapters

These will yield the biggest improvement in practical replaceability.

---

## Final acceptance checklist by module

### Browser

- [ ] Thin bootstrap
- [ ] Shared relay contract
- [ ] Optional comments integration
- [ ] Policy/transport/storage split
- [ ] No public API ambiguity

### Browser-extension

- [ ] No hardcoded relay auth/host settings
- [ ] Transport isolated from handlers
- [ ] Shared contract only
- [ ] Hidden singleton coupling minimized

### Diagram

- [ ] Parser/layout/reconcile/render separated
- [ ] Host adapter boundary explicit
- [ ] Comments isolated to adapter layer
- [ ] Tool handlers use stable panel interface only

### Presentation

- [ ] No engine-specific casts
- [ ] Host is engine-neutral
- [ ] Commands standardized in capabilities
- [ ] Comments optional and adapter-based

### Voice

- [ ] Zero VS Code leakage in runtime/core
- [ ] Policy persistence abstracted
- [ ] Provider contracts hardened
- [ ] UI remains adapter-only

### Comments

- [ ] Domain independent of modality routing
- [ ] Navigation adapter registry exists
- [ ] Author policy abstracted
- [ ] Integrations optional and capability-based

### Shared packages

- [ ] One source of truth for contracts
- [ ] One source of truth for command IDs
- [ ] No local duplicate shadow interfaces

---

## Bottom line

The repo already has good modular instincts. To reach a true perfect score, the remaining work is mostly about:

- finishing half-complete abstraction seams
- shrinking oversized orchestration files
- removing duplicated contracts
- making integrations optional and capability-based

That path keeps the architecture practical and boring in the best way: clear boundaries, easy replacement, no fancy tricks.

---

## Temporary hold: voice batch

As of the current modularity program run, the `packages/voice` batch is intentionally **on hold**.

### Reason

Voice still has meaningful runtime-boundary leakage (`vscode`-coupled seams in runtime/narration/policy persistence), and finishing that batch cleanly would slow down the broader modularity program for the other modalities.

### Current decision

- Do **not** include `packages/voice` in the current parallel modularity rollout.
- Do **not** block browser / diagram / presentation-comments progress on voice cleanup.
- Preserve the Phase A voice review artifacts and stubs as future starting material.

### Active modularity scope now

The active coordinated modularity rollout covers only:

- Browser family (`packages/browser`, `packages/browser-extension`)
- Diagram (`packages/diagram`)
- Presentation + Comments integration (`packages/marp`, presentation-related `packages/comments` scope)

### Resume condition for voice

Resume the voice batch only when explicitly scheduled as a dedicated follow-up effort.
