---
name: continia-env-setup
description: Creates a fresh Business Central environment from a DemoPortal profile with the continia CLI and waits until it is running. Use it for interactive work outside the pipeline, which provisions its own environment in code.
---

# Environment setup

The demo pipeline already does this in code (`src/services/continia-cli.ts` and `src/services/pipeline.ts`: create from `CONTINIA_ENV_PROFILE_ID`, start, poll until Running, install the activation app). Inside a pipeline run, use the environment you were given and don't create, start, stop, or delete environments. This skill is the reference for doing the same by hand.

## Running the CLI

- The CLI is `continia` on PATH in Docker. The pipeline passes its path as `CONTINIA_CLI_PATH` (locally `.claude/.tools/continia.exe`) and lists it in the prompt; use that path wherever the examples say `continia`.
- Every command that calls the DemoPortal API needs `--token "$CONTINIA_API_TOKEN"`. The examples below omit it for brevity; write it as `continia --token "$CONTINIA_API_TOKEN" env list --json`. Never write the token's value into a file or output.

## Create a fresh environment

1. List BC versions: `continia env profiles versions --json`
2. List profiles for a version: `continia env profiles list --bc-version <version> --json`
3. Create: `continia env create --name "<name>" --profile <profileId> --json`. The JSON contains the new environment id; the environment starts in `Draft`.
4. Start it: `continia env start <envId>`
5. Poll every 10 s with `continia env get <envId> --json` until `status` is `Running` (usually a few minutes). A status of `Failed`, `Error`, or `Deleted` is terminal. If it takes much longer than expected, check `continia env logs <envId>`.
6. Report the environment id, name, and URL from `env get`.

Continia products need the Continia Core Internal Activation App before anything else is deployed; install it with `continia deps install-by-id <envId> <appId> --json` (see the `continia-deps` skill).

Reusing an existing environment is an option for interactive sessions only: `continia env list --status running --json`, or `--status stopped` and then `env start`. Prefer a fresh environment when the result has to be reproducible.

## VS Code launch.json

`continia launch add <envId> <workspacePath>` discovers every app under `<workspacePath>` and writes or updates `.vscode/launch.json` inside each app folder. Point it only at a folder you own, such as the PTE folder. In pipeline runs, never point it at the repo root or the read-only continia-banking repo, because it would write launch files into them. `continia launch clean <workspacePath>` empties those files again.

## Command reference

```
continia env list [--status running|stopped] [--json]
continia env get <id> [--json]
continia env create --name <name> --profile <profileId> [--json]
continia env start <id>
continia env stop <id>
continia env delete <id>
continia env logs <id>
continia env users <id> [--json]      # --json includes plaintext passwords; don't log or share it
continia env sessions <id> [--json]
continia env apps <id> [--name <substr>] [--publisher <substr>] [--json]
continia env share <id> <email>
continia env claim <id-or-url>
continia env profiles versions [--json]
continia env profiles list --bc-version <version> [--json]
continia launch add <envId> <workspacePath>
continia launch clean <workspacePath>
```

Global options: `--token <token>`, `--api-url <url>` (or `CONTINIA_API_URL`), `--log-level quiet|normal|verbose`.

## Errors

- "API token not found": pass `--token "$CONTINIA_API_TOKEN"`. The CLI falls back to the `CONTINIA_API_TOKEN` variable and then to the VS Code `environment-explorer.api-token` setting, but pass the flag explicitly.
- 401/403 from the API: the token is expired or wrong; a human has to renew it.
- Stuck in `Creating` or `Starting`: read `continia env logs <envId>`.
- Connection refused on a previously working environment: it has stopped; `env start` it and poll again.
