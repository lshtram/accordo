# Review: Browser Comment Context Flow

## Findings

### High — Browser comment context recovery drops frame identity, so same-origin iframe comments cannot be reopened reliably
- `packages/browser-extension/src/comment-types.ts:34-43` — stored browser `anchorContext` has no `frameId`/logical frame field.
- `packages/browser-extension/src/content/comment-ui-mode.ts:46-61` — browser comment creation captures tag/text/title/snapshot trust metadata, but not the frame that the anchor came from.
- `packages/browser/src/comment-context-recovery.ts:23-30,100-107` — recovered metadata only returns `anchorKey`, `snapshotId`, and raw `surfaceMetadata`; there is no recovered frame target.
- `packages/browser/src/comment-context-tool.ts:84-103` — `accordo_browser_resolve_comment_context` replays inspect/excerpt without any `frameId`.
- `packages/browser-extension/src/relay-page-remote.ts:37-47` — without an explicit `frameId`, browser page tools execute in the main frame.
- Impact: a browser-reviewing agent can resolve a stored comment thread successfully for main-document anchors, but the same flow will miss or mis-target comments created inside same-origin iframes because the rerun context has no way to get back to the original frame.
- Done when: browser comment metadata persists the logical frame id, sync/import paths preserve it, and `accordo_browser_resolve_comment_context` passes the recovered `frameId` through to `accordo_browser_inspect_element` / `accordo_browser_get_dom_excerpt`, with an end-to-end test for a same-origin iframe comment.

### Medium — Legacy browser anchors resolve, but the promised rerun trust metadata is omitted
- `docs/20-requirements/requirements-comments.md:244-248` — legacy browser anchors (`tagName:siblingIndex:textFingerprint`) are still part of the supported contract.
- `packages/browser-extension/src/content/enhanced-anchor-resolution.ts:91-109` — `parseEnhancedAnchorKey()` returns `null` for unprefixed legacy anchors.
- `packages/browser-extension/src/content/anchor-resolution-metadata.ts:99-113` — `resolveReportedAnchorMetadata()` only emits `anchorStrategy`, `anchorConfidence`, and `resolvedTier` when parsing succeeds; legacy anchors therefore return no actual rerun metadata.
- `docs/30-development/tool-catalog.md:40-43` — public docs say nested `inspect` / `excerpt` metadata describes the actual re-resolution path.
- Impact: existing/imported browser threads that still use legacy anchors can be re-resolved, but a reviewer agent gets no rerun trust signal for them even though the tool contract says those fields describe the rerun path. That makes the result ambiguous exactly on the older comments most likely to need investigation.
- Done when: legacy anchor resolution reports explicit rerun metadata as well (for example a mapped legacy/tag-sibling strategy with defined confidence+tier), and tests cover `inspect_element`, `get_dom_excerpt`, and `resolve_comment_context` on legacy anchors.

### Medium — `accordo_browser_get_dom_excerpt` can return contradictory HTML vs text context
- `packages/browser-extension/src/content/dom-excerpt.ts:20-53` — HTML serialization walks only `element.children`, so direct text nodes in mixed-content elements are dropped unless the element is a leaf/max-depth node.
- `packages/browser-extension/src/content/dom-excerpt.ts:27,42-45` — forbidden descendants such as `script`/`style`/`iframe` are removed from HTML.
- `packages/browser-extension/src/content/dom-excerpt.ts:69` — `text` is still taken from raw `element.textContent`, i.e. from the unsanitized full subtree.
- Impact: the helper can return `html` that is missing visible inline text while `text` still includes content from stripped descendants. A browser-reviewing agent can therefore get two conflicting representations of the same anchor context and reason from the wrong one.
- Done when: excerpt HTML preserves direct text nodes that belong in the kept subtree, and the returned `text` is derived from that same sanitized/truncated subtree rather than raw `textContent`; add tests for mixed text+child content and stripped descendants.

## Open questions / assumptions

- I assumed same-origin iframe comments are in scope for this flow because the browser tools already expose `frameId` targeting and the comment UI/runtime can run in frame contexts.
- I assumed legacy browser anchors remain first-class supported input, not best-effort compatibility, because the comments requirements still document them as accepted contract inputs.
- I did not run a live manual browser session; my signoff is based on focused source review plus the targeted automated suites below.

## Summary

Focused suites rerun clean:
- `packages/browser`: 156 passing
- `packages/browser-extension`: 168 passing
- `packages/comments`: 87 passing

I do not consider the browser comment-context investigation flow fully ready for final behavioral signoff yet. Main-document happy paths look solid, but same-origin iframe anchors are not recoverable end to end, legacy anchors do not surface the promised rerun trust metadata, and DOM excerpt output can present inconsistent context to an investigating agent.
