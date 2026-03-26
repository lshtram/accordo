/**
 * DOM setup for browser-extension tests.
 *
 * Creates a stable JSDOM fixture used by page-understanding tests.
 * Elements are chosen to exercise specific anchor strategies:
 *   - #submit-btn                → id strategy
 *   - [data-testid="login-btn"]  → data-testid strategy
 *   - .dynamic-class-xyz (inside #content) → css-path strategy (has stable ancestor #content)
 *   - div:nth-child(5)           → viewport-pct strategy (plain div, no id/testid, no stable ancestor)
 *   - [data-anchor="button:3:submit"] → legacy tag-sibling resolution
 *
 * Body child order (for nth-child selectors):
 *   1: button#submit-btn
 *   2: div[data-testid="login-btn"]
 *   3: div[data-testid="login-form"]
 *   4: div#main
 *   5: div (plain, no id, no testid) ← div:nth-child(5) → viewport-pct
 *   6: div#content (contains .dynamic-class-xyz) ← .dynamic-class-xyz has stable ancestor
 *   7+: other elements
 */

import { beforeEach } from "vitest";

beforeEach(() => {
  document.title = "Test Page";

  document.body.innerHTML = `
    <button id="submit-btn">Submit</button>
    <div data-testid="login-btn">Login</div>
    <div data-testid="login-form">Form</div>
    <div id="main">Main content</div>
    <div>plain no stable id</div>
    <div id="content">
      <div class="dynamic-class-xyz">Dynamic</div>
    </div>
    <div>plain1</div>
    <div>plain2</div>
    <div>plain3</div>
    <div>plain4</div>
    <button>submit</button>
    <button>submit</button>
    <button>submit</button>
    <button data-anchor="button:3:submit">submit</button>
    <div id="small-but-valid" style="width:10px;height:10px;">tiny</div>
    <div id="below-fold">below fold content</div>
    <div id="some-element">some element</div>
    <div id="large-img">large image</div>
    <div id="screenshot-target">screenshot target</div>
    <div id="btn">button element</div>
    <div id="tiny-element" style="width:5px;height:5px;">tiny</div>
  `;
});
