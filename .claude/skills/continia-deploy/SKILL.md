---
name: continia-deploy
description: Compiles AL apps and publishes them to a Business Central environment with the continia CLI, in dependency order when several local apps are involved. Use it to deploy a PTE or another AL app, and to diagnose compile, ruleset, and publish errors.
---

# Compile and deploy

## Running the CLI

- The CLI is `continia` on PATH in Docker. The pipeline passes its path as `CONTINIA_CLI_PATH` (locally `.claude/.tools/continia.exe`) and lists it in the prompt; use that path wherever the examples say `continia`.
- `deploy`, `publish`, and `unpublish` call the DemoPortal API and need `--token "$CONTINIA_API_TOKEN"`; `compile` doesn't. The examples omit it for brevity; write it as `continia --token "$CONTINIA_API_TOKEN" deploy <envId> <appPath> --json`. Never write the token's value into a file or output.
- You need a running environment id. In a pipeline run it is given to you; don't create, start, stop, or delete environments. Dependencies and symbols come first (`continia-deps` skill).

## Where to run it

`deploy` discovers apps under `--workspace-root` (default: the current directory). If that folder has an `app.json` itself, it is the only app found; otherwise subfolders are scanned a few levels deep, skipping dot-folders and `node_modules`. `<appPath>` is resolved against the workspace root and must match a discovered app folder, otherwise the command fails with "No app.json found at ...", which also happens with some absolute paths. Run it from the app folder's parent with the folder name as the relative path:

```bash
cd <parent>
continia deploy <envId> <pte> --json
```

Deploy writes files: the compiled `.app` lands in the app folder, and a shared package cache is created at `<workspaceRoot>/.alpackages`. To deploy an app whose sources live in a read-only repo (such as `banking-demo` in continia-banking), copy the app folder somewhere you own (for example next to the PTE folder) and deploy the copy.

## Deploy strategies

```bash
# Single app; its dependencies are already on the environment
continia deploy <envId> <appPath> --json

# App plus the workspace-local apps it depends on, in topological order
continia deploy <envId> <appPath> --with-deps --json

# Every app under the workspace root (often far more than you want; prefer explicit apps)
continia deploy <envId> --all --workspace-root <dir> --json

# One NDJSON line per app as it finishes, instead of one array at the end
continia deploy <envId> --all --json --stream

# Keep going after a per-app failure (--force is a deprecated alias)
continia deploy <envId> --all --continue-on-error --json
```

Schema sync mode: `--sync-mode Synchronize|ForceSync|Recreate` (default `Synchronize`). `ForceSync` accepts destructive table changes; `Recreate` drops and recreates the app's tables and is the last resort.

## Replacing an installed app

- Same-version redeploy: BC silently no-ops a publish of a version that is already installed, so the old binary keeps running, and v0.12.0 doesn't unpublish it for you. Either bump `version` in `app.json` (simplest for a PTE), or unpublish the installed copy first with `continia unpublish` or `deploy --unpublish-dependents`.
- `--unpublish-dependents`: before publishing, unpublishes every installed app whose id matches an app in this deploy run, in reverse dependency order, then republishes in topological order. Use it for breaking changes in a base app (removed members) to avoid BC's "extension compilation failed" rollback when it recompiles installed dependents. It only touches apps in the run; third-party apps that depend on them are left broken until they are republished, and the API doesn't stop you.

## Rulesets

When `--ruleset` isn't given, `compile` and `deploy` look for a ruleset in this order: `al.ruleSetPath` in `<app>/.vscode/settings.json`, then in `<workspaceRoot>/.vscode/settings.json`, then `<app>/ruleset.json`. `${workspaceFolder}` is substituted, and a configured path that doesn't exist is ignored with a warning. An explicit `--ruleset <path>` overrides auto-discovery and, in v0.12.0, applies to every app compiled in the run.

```bash
continia deploy <envId> <appPath> --ruleset <rulesetPath> --json
```

- AL1033 "external rulesets are not allowed": `alc.exe` rejects `includedRuleSets` that point at HTTPS URLs, which VS Code accepts. Provide a sibling ruleset (for example `.cli-ruleset.json`) whose includes are local file paths, and point `al.ruleSetPath` or `--ruleset` at it.
- AA0215 (file name must match the object name) fails the compile before a ruleset can suppress other findings. Rename the file once.

## Results

JSON output is one entry per app:

```json
[{ "app": "<Publisher>_<Name>", "compiled": true, "published": true }]
```

On failure, `error` holds the compiler output or the publish message, and the run stops at the first failing app unless `--continue-on-error` is set. Exit code is 1 when any app failed.

- Missing symbols or packages (AL1022 and similar): fetch them with the `continia-deps` skill and redeploy.
- AL syntax or semantic errors: fix the code and redeploy.
- Schema sync errors: retry with `--sync-mode ForceSync`, and `Recreate` only as a last resort.
- An error raised from an install or upgrade trigger: the app's own code failed while installing; fix it and redeploy.
- Connection refused: the environment has stopped.

## Standalone commands

```bash
# Compile only; no API call
continia compile <appPath> [--package-cache <dir>] [--ruleset <path>] [--workspace-root <dir>] --json

# Publish a pre-built .app
continia publish <envId> <appFile> [--sync-mode ForceSync] --json

# Unpublish; omit --app-version to remove every installed version
continia unpublish <envId> --name "<App Name>" --publisher "<Publisher>" [--app-version <v>] --json
```

The flag is `--app-version`, not `--version`, which is the global version flag. BC refuses to unpublish an app that other installed apps depend on; unpublish those first, or use `deploy --unpublish-dependents` for apps in the workspace.

Compiler: the CLI uses `alc` from the newest AL VS Code extension (`~/.vscode/extensions/ms-dynamics-smb.al-*`), so analyzers match it. `CONTINIA_ALC_PATH` overrides it. Without the extension it falls back to `al compile` and warns that analyzers may fail to load. Analyzers listed in `al.codeAnalyzers` of `<app>/.vscode/settings.json` are loaded (`${CodeCop}`, `${UICop}`, `${AppSourceCop}`, `${PerTenantExtensionCop}`, `${analyzerFolder}...`); missing DLLs are skipped with a warning.
