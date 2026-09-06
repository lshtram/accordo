# Restoring Accordo beyond Git

GitHub contains Accordo's durable source, tests, documentation, package
manifests, and lockfile. The retired Mac checkout also contained regenerable or
machine-local material that is intentionally excluded from Git.

## Dependencies and generated output

- `node_modules/` (about 869 MB) is recreated with `pnpm install --frozen-lockfile`.
- Package `dist/`, `out/`, coverage, and generated bundle directories are
  recreated with `pnpm build` or the relevant package command.
- Per-package ignored files beneath `packages/` are dependency and build/test
  output, not source-of-record data.

## Speech model and profiling workspace

Most of the remaining excluded space is under `scripts/sherpa-profile/` (about
426 MB). It contains downloaded/generated speech profiling dependencies and
model assets. Recreate it using the tracked scripts in that directory; the
tracked profile script identifies the upstream Sherpa ONNX Kokoro model release
URL. Downloaded models are third-party artifacts and should not be committed.

## Local configuration

Editor settings, `.claude/mcp.json`, `opencode.json`, `.DS_Store` files, logs,
and any credentials or environment files are machine-local. Recreate tool
configuration from the tracked documentation and obtain credentials from the
authorized service or password manager. Never recover secrets from GitHub.

## Verification after restoration

From the repository root, install pnpm 9 or newer and run:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
```

The complete pre-cleanup working copy, including ignored files, is also retained
in the independently checksummed `projects.tar` archive created during the Mac
cleanup.
