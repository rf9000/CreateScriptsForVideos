---
name: continia-deps
description: Installs an AL app's dependencies on a Business Central environment and downloads their symbol packages into .alpackages with the continia CLI. Use it before compiling or deploying a PTE, or when compilation fails with missing symbols or packages.
---

# Dependencies and symbols

## Running the CLI

- The CLI is `continia` on PATH in Docker. The pipeline passes its path as `CONTINIA_CLI_PATH` (locally `.claude/.tools/continia.exe`) and lists it in the prompt; use that path wherever the examples say `continia`.
- Every command except `deps tree` calls the DemoPortal API and needs `--token "$CONTINIA_API_TOKEN"`. The examples omit it for brevity; write it as `continia --token "$CONTINIA_API_TOKEN" deps install <envId> <appPath> --json`. Never write the token's value into a file or output.
- `deps install` and `deps download` resolve `<appPath>` against the current directory and need `<appPath>/app.json` to exist, otherwise they fail with "No app.json found at ...". Run them from the app folder's parent with the folder name as the path, the same way `continia-deploy` runs.

## Install one app by id

```bash
continia deps install-by-id <envId> <appId> --json
continia deps install-by-id <envId> <appId> --version 29.0.0.0 --json
```

Installs a catalogue app by its GUID, with no local source. Defaults to the latest version for the environment profile's BC version and target; `--bc-version` and `--target Cloud|OnPrem` override those. JSON result:

- `{ "installed": true, "alreadyPresent": true, "app": {...} }`: already on the environment, nothing done.
- `{ "installed": true, "alreadyPresent": false, "app": {...} }`: installed now.
- `{ "installed": false, "reasonCode": "not-found", "reason": "..." }`: no catalogue app with that id for this BC version, target, and version. Exit code 1.
- `{ "installed": false, "reasonCode": "install-failed", "reason": "...", "app": {...} }`: the catalogue had it but the install call failed. Exit code 1.

## Install an app's dependencies

```bash
continia deps install <envId> <appPath> --json
```

Reads the `dependencies` array of `app.json` and installs each entry from the DemoPortal catalogue, matched by name and version for the environment's BC version and target. Only direct dependencies are handled. It does not check what is already installed first, and a dependency it can't find or install is logged and skipped rather than failing the command. JSON output is `{ "installed": ["<name>", ...] }`, so compare it with `app.json` to see what was skipped, and confirm with `continia env apps <envId> --json`.

## Download symbols

```bash
continia deps download <envId> <appPath> --json
```

Downloads one `.app` per entry in the `dependencies` array of `app.json` into `<appPath>/.alpackages`, trying the DemoPortal catalogue first and then the environment's `/dev/packages` endpoint. JSON output is `{ "downloaded": ["<name>", ...], "skipped": [{ "name", "publisher", "reason" }] }`.

As of v0.12.0 it fetches direct dependencies only. It doesn't follow their own dependencies and doesn't fetch the `application` / `platform` base symbols (Base Application, System Application, System). When alc reports a missing package (AL1022 or "could not find package"), fetch that package the same way: create a scratch folder outside any repo with an `app.json` whose `dependencies` list the missing packages (id, name, publisher, version), run `deps download` on it, and copy the `.app` files into the PTE's `.alpackages`. `continia deploy` also merges each app's `.alpackages` into `<workspaceRoot>/.alpackages` before compiling, so packages placed in either are found.

## Dependency tree

```bash
continia deps tree --workspace-root <dir>
continia deps tree <appPath> --workspace-root <dir>
```

Prints the local dependency graph without calling the API; dependencies not found in the workspace are marked `[external]`.

## PTE setup on a fresh environment

The pipeline has already created and started the environment and installed the Continia activation app. For a demo-data PTE in `<parent>/<pte>`:

1. If the PTE depends on catalogue apps that may be missing (for example "Continia Banking Internal Access", id `6e549e35-d1b2-4878-a37a-a736c22f35bf`), install them by id: `continia deps install-by-id <envId> <appId> --json`. Treat `alreadyPresent: true` as success.
2. From `<parent>`, install the remaining direct dependencies: `continia deps install <envId> <pte> --json`.
3. From `<parent>`, download symbols: `continia deps download <envId> <pte> --json`. Check `skipped`.
4. Compile and publish with the `continia-deploy` skill. If compile reports missing packages, fetch them as described under "Download symbols" and redeploy.

## Fixing missing-symbol errors

1. `continia deps download <envId> <appPath> --json`, then check `skipped`.
2. Fetch anything still missing (transitive or base packages) as described above.
3. `continia compile <appPath> --json` or redeploy.
