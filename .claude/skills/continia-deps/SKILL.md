---
name: continia-deps
description: Install external dependencies on a BC environment and download symbol packages for AL compilation. Use when (1) compilation fails with missing symbol or reference errors, (2) a fresh environment needs base apps installed before deploying, (3) the user asks to install or update dependencies, or (4) .alpackages is empty or outdated.
---

# Manage Dependencies

The CLI is located at `.tools/continia.exe`.

Two distinct operations:

## Install on Environment

Install an app's **direct** external dependencies on the BC environment (runtime dependencies):
```bash
continia deps install <envId> <appPath> --json
```

Reads `app.json`, looks up each direct dependency by appId (falling back to publisher/name),
and installs it — skipping any already installed at a satisfying version. Use `--dry-run` to
preview. Transitive runtime install is intentionally not performed (it would risk installing
Microsoft test/mock libraries onto the environment); the symbol closure is `deps download`'s job.

**Symbol gaps:** After `deps install`, check the `symbolsMissing` field in JSON (or the "symbol gaps N" summary on stderr in human mode). If non-empty, run `continia deps download <envId> <appPath>` to populate `.alpackages` for compile.

## Download Symbols

Download the **transitive** `.app` symbol closure to `.alpackages` (compile-time dependencies):
```bash
continia deps download <envId> <appPath> --json
```

Starting from `app.json` — both the `dependencies` array and the `application` / `platform`
base-symbol references — the CLI reads each package's embedded `NavxManifest.xml` and
recursively resolves the symbol closure the AL compiler needs (this is what prevents AL1022,
both for transitive dependency refs such as `Application Test Library` / `Permissions Mock`
and for the Microsoft base/system symbols pulled in via `application` / `platform`).
For each package the DemoPortal catalogue is tried first (by appId), then BC's `/dev/packages`
endpoint for Microsoft system symbols. The chosen version prefers what is installed on the
target environment. Add `--clean` to rebuild `.alpackages` from scratch. JSON output is
`{ resolved: [...], skipped: [...] }` with the requested vs. resolved identity and source per entry.

## Dependency Tree

Visualize the dependency graph without installing or downloading:
```bash
continia deps tree --workspace-root .
continia deps tree <appPath> --workspace-root .
```

## Fresh Environment Setup

1. Invoke `continia-env-setup` to get a running env
2. Install deps in dependency order:
   ```bash
   continia deps install <envId> Core/Cloud --json
   continia deps install <envId> DeliveryNetwork/Cloud --json
   continia deps install <envId> DocumentOutput/Cloud --json
   ```
3. Download symbols:
   ```bash
   continia deps download <envId> Core/Cloud --json
   continia deps download <envId> DeliveryNetwork/Cloud --json
   continia deps download <envId> DocumentOutput/Cloud --json
   ```
4. Invoke `continia-deploy` to build and publish

## Fixing Missing Symbol Errors

1. `continia deps download <envId> <appPath> --json`
2. `continia compile <appPath> --json`
