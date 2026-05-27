---
name: continia-deploy
description: Compile and deploy AL code to a BC environment. Handles single-app and multi-app deploys with topological dependency ordering. Use when (1) AL code was changed and needs deploying, (2) the user asks to compile and publish, (3) a test fix needs deploying before re-running tests, or (4) a fresh environment needs all apps deployed. Invoke continia-env-setup first if no envId is available.
---

# Deploy AL Code

Compile and publish AL apps to a running BC environment.

The CLI is located at `.tools/continia.exe`.

## Prerequisites

A running environment ID. If unavailable, invoke `continia-env-setup` first.

## Strategy Selection

**Single app, deps already published:**
```bash
continia deploy <envId> <appPath> --json
```

**Single app with local dependencies (or fresh env):**
```bash
continia deploy <envId> <appPath> --with-deps --json
```

**All workspace apps:**
```bash
continia deploy <envId> --all --workspace-root <sessionRoot> --json
```

**Override schema sync mode** (default: Synchronize; options: Synchronize, ForceSync, Recreate):
```bash
continia deploy <envId> <appPath> --sync-mode ForceSync --json
```

**Override ruleset path** (useful for workspace `.cli-ruleset.json` variants):
```bash
continia deploy <envId> <appPath> --ruleset "Banking Rulesets/.cli-ruleset.json" --json
```

**Per-app NDJSON progress** (one line per app, useful for CI / long deploys):
```bash
continia deploy <envId> --all --json --stream
```

**Continue on failure** (collect per-app status across the workspace instead of aborting on first failure):
```bash
continia deploy <envId> --all --continue-on-error --json
```
(`--force` is kept as a deprecated alias for back-compat.)

**Breaking-change refactor (member removed from base, dependents installed):**
```bash
continia deploy <envId> <appPath> --with-deps --unpublish-dependents --json
```
Unpublishes any workspace app already installed on the env (in reverse dependency order) before re-publishing in topo order. Avoids BC's "extension compilation failed" rollback that fires when the base recompiles installed dependents against new (now-incompatible) symbols. Only handles workspace consumers — third-party apps depending on the base are NOT touched, so after the new base publishes those third-party apps will be left broken until republished. The DemoPortal API does not block this; if any third-party dependents must be preserved, reinstall them yourself afterwards.

## Rulesets

`continia compile` and `continia deploy` auto-load the ruleset in this order: `<app>/.vscode/settings.json` `al.ruleSetPath`, then `<workspaceRoot>/.vscode/settings.json`, then `<app>/ruleset.json` if present. Explicit `--ruleset <path>` overrides all three.

```bash
continia deploy <envId> <appPath> --ruleset "Banking Rulesets/.cli-ruleset.json" --json
```

**External HTTPS includes are rejected by `alc.exe`.** VS Code happily loads remote rulesets via `includedRuleSets`; CLI `alc.exe` errors with:

```
error AL1033: external rulesets are not allowed.
```

If a workspace uses such a ruleset, ship a sibling `.cli-ruleset.json` whose `includedRuleSets` point at local file paths only, and either point `al.ruleSetPath` at it or pass it via `--ruleset`.

**Pre-existing AA0215 errors block compile.** AL CodeCop AA0215 requires the source filename to match the object name. If a file fails this rule, compile errors out before the ruleset can suppress anything else — fix the filename (`git mv`) once.

## Result Interpretation

JSON output is an array per app:
```json
[{"app": "Continia Software_Continia Core", "compiled": true, "published": true}]
```

On failure, the `error` field contains details:
- **Missing symbols** -- invoke `continia-deps` to download dependencies, then retry
- **AL syntax errors** -- fix the code and re-deploy
- **"App is already installed"** -- add `--force` or increment the version
- **Schema sync errors** -- retry with `--sync-mode ForceSync` (or `Recreate` as last resort, which drops and recreates tables)
- **Connection refused** -- environment may have stopped; re-run `continia-env-setup`

## Standalone Operations

Compile only (no publish):
```bash
continia compile <appPath> --json
```

Compile uses the AL VS Code extension's bundled `alc.exe` (matched against analyzer DLLs by construction — no version mismatch). Override with `CONTINIA_ALC_PATH=<path>`. Without an AL extension installed, falls back to altool's `al compile` and warns on stderr — analyzers may fail to load in that mode.

Code analyzers (CodeCop, UICop, AppSourceCop, PerTenantExtensionCop, BCLinterCop) are auto-loaded from `<appPath>/.vscode/settings.json` (`al.codeAnalyzers` array). Standard placeholders (`${CodeCop}`, `${analyzerFolder}BusinessCentral.LinterCop.dll`, etc.) resolve against the same AL extension. Missing DLLs warn on stderr and skip — compile still runs.

Publish a pre-built .app file:
```bash
continia publish <envId> <appFile> --json
continia publish <envId> <appFile> --sync-mode ForceSync --json
```

Unpublish an installed extension:
```bash
continia unpublish <envId> --name "<App Name>" --publisher "<Publisher>" [--app-version <v>] --json
```
Omit `--app-version` to remove all versions. (Flag is `--app-version`, not `--version` — the latter collides with the global `continia --version`.) BC will refuse if other installed apps depend on this one — unpublish those first, or use `deploy --unpublish-dependents` for the workspace cascade.

## Gotchas

- **Deploy from the correct working directory** — The CLI discovers apps from the cwd. Run deploy from within the app's parent directory (e.g. `continia deploy <envId> Cloud` from the `DocumentOutput` dir). Passing full absolute paths like `U:\Git\...\DocumentOutput\Cloud` fails with "No app.json found."
- **`--all` deploys too much** — `--all --workspace-root` discovers all apps in the workspace including BC base apps (209+ apps in DO.Support). Deploy specific apps instead of using `--all`.

## Common Pattern: Fix-and-Deploy

1. Fix the AL code
2. `continia deploy <envId> <appPath> --json`
3. If compile fails, fix errors and retry
4. Once published, invoke `continia-test` to verify
