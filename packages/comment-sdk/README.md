# @accordo/comment-sdk

Framework-free comment UI SDK for Accordo webview surfaces.

## What it provides

- Spatial pin rendering for `SdkThread` data
- Popover UI for reply/resolve/reopen/delete interactions
- Alt+click inline create flow (`onCreate` callback)
- Reposition support for scroll/resize viewport updates

## Lifecycle

```ts
import { AccordoCommentSDK } from "@accordo/comment-sdk";

const sdk = new AccordoCommentSDK();
sdk.init({ container, coordinateToScreen, callbacks });

sdk.loadThreads(threads);
// ... add/update/remove/reposition/openPopover ...

sdk.destroy();
```

## Public API

- `init(opts)`
- `destroy()`
- `loadThreads(threads)`
- `addThread(thread)`
- `updateThread(threadId, update)`
- `removeThread(threadId)`
- `reposition()`
- `openPopover(threadId)`

## Integration boundary

The SDK is UI logic only.

- SDK owns rendering + callback emission
- Host consumer owns persistence + transport wiring (for example postMessage channels)

The SDK exports `WebviewMessage` and `HostMessage` types, but it does not require a specific transport implementation.

## CSS

Import CSS from the package export:

```ts
import "@accordo/comment-sdk/css";
```

For webview bundles that cannot consume package CSS imports directly, copy/embed `src/sdk.css` in the consumer build step.

## Browser-wrapper helper

Optional helper scripts:

- `pnpm --filter @accordo/comment-sdk bundle:browser`
- `pnpm --filter @accordo/comment-sdk build:browser`

These generate `dist/sdk.browser.js` (IIFE/global wrapper) from `dist/sdk.js` for consumers that prefer script-tag loading.

## Validation

- `pnpm --filter @accordo/comment-sdk test`
- `pnpm --filter @accordo/comment-sdk typecheck`
- `pnpm --filter @accordo/comment-sdk build`
