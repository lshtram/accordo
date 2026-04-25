# Review Update: Browser Tools Live Evaluation

## Findings

### Medium — Action tools work when browser control permission is granted on the target tab
- On Google tab `918311425` (`https://www.google.com/`), `accordo_browser_inspect_element` located `textarea[name='q']` successfully.
- `accordo_browser_click` on `textarea[name='q']` returned `{"success":true}`.
- `accordo_browser_type` on `textarea[name='q']` with `clearFirst:true` returned `{"success":true}`.
- `accordo_browser_press_key` with `Escape` returned `{"success":true,"key":"Escape"}`.
- `accordo_browser_navigate` with `type:"reload"` returned `{"success":true,"url":"https://www.google.com/","title":"Google","readyState":"interactive"}`.
- Conclusion: the action-tool surface is functional under the granted-permission precondition.

### Medium — Earlier `control-not-granted` results were permission-precondition failures, not confirmed product bugs
- The earlier review observed `control-not-granted` on tabs that did not have browser control permission.
- Re-test on a granted tab succeeded across click/type/key/navigation.
- Reframe: this is an expected precondition boundary. It should not be classified as a confirmed action-tool implementation failure.

### Low — Discoverability/documentation gap remains
- The practical difference between read access and control permission is significant, but the earlier live experience did not make that distinction obvious enough for agent planning.
- Agents need a clearer contract for when control actions are expected to fail with `control-not-granted`, and what recovery path to use.

## Correction to previous assessment

The previous finding that the action tools were broadly failing should be **downgraded and reframed**.

- **Previous framing:** action/control tools are not currently usable end to end.
- **Corrected framing:** action/control tools are usable on tabs where browser control permission has been granted; prior failures were evidence of a permission precondition, not by themselves evidence of a product bug.

Distinction:
- **Genuine product/tooling bugs:** `accordo_browser_diff_snapshots` remains the strongest confirmed bug from the prior review and was not corrected by this permission update.
- **Expected permission preconditions:** `control-not-granted` for click/type/press_key/navigate on non-granted tabs.
- **Agent discoverability/documentation gaps:** insufficiently obvious guidance on detecting/handling control permission before planning action steps.

## Updated readiness verdict for action tools

**Action tools are conditionally ready.**

Readiness statement:
- `accordo_browser_click`, `accordo_browser_type`, `accordo_browser_press_key`, and `accordo_browser_navigate` are live-functional on a granted tab.
- They should be considered **ready with a tab-level permission preflight**, not universally available.

Residual risk:
- Agents that do not first establish control permission may still fail at runtime with `control-not-granted`.
