# VM Deployment (Docker)

Runs as a Docker container on the same Azure VM as `DevOpsInvestigateWorkItems`,
under `~/teams/continia-banking/`. The watcher polls Azure DevOps, and for each opted-in
work item the Claude agent generates a recording script + demo-data PTE and provisions a
fresh BC environment via the `continia` CLI.

This mirrors the investigate tool's deployment. The differences, all because this tool
*builds and publishes* rather than just reading code:

| | Investigate tool | This tool |
|---|---|---|
| External binaries | none | `continia` (linux build) on PATH + a Linux `alc` |
| Output | comments only | **writable** `/app/output` volume (PTE + script) |
| Cloud side effects | none | creates BC environments per item (cost + cleanup) |
| Deploy = `git pull`? | yes | **no** — the binary + token are provisioned out of band |

## Prerequisites

- SSH access to the VM; Claude Code team subscription (OAuth)
- The `continia-linux` binary
- A Linux `alc` (AL compiler) — see [AL compiler](#al-compiler) below

## Directory structure

```
~/repos/continia-banking/                 # cloned once, mounted :ro (shared with investigate)
~/tools/continia-linux                     # the linux CLI binary (chmod +x)
~/tools/al-alc/                            # linux alc (optional layout)
~/teams/continia-banking/
  docker-compose.yml                       # add the create-scripts-for-videos service
  .env.create-scripts                      # secrets (PAT, CONTINIA_API_TOKEN)
  CreateScriptsForVideos/                  # this repo (cloned)
```

## Initial setup

1. SSH in and clone this repo next to the investigate one:
   ```bash
   cd ~/teams/continia-banking
   git clone <create-scripts-repo-url> CreateScriptsForVideos
   ```
2. continia-banking is already cloned under `~/repos/` for the investigate tool — reused as-is.
3. Provision the continia binary and make it executable:
   ```bash
   mkdir -p ~/tools
   cp /path/to/continia-linux ~/tools/continia-linux
   chmod +x ~/tools/continia-linux
   ~/tools/continia-linux --version    # sanity check it runs on this host
   ```
4. Provision the AL compiler (see [AL compiler](#al-compiler)).
5. Claude Code OAuth is shared from the host `~/.claude` (already set up for investigate).
   If you see auth errors, re-authenticate on the host (same procedure as the investigate README).
6. `cp .env.create-scripts.example .env.create-scripts` and fill in `AZURE_DEVOPS_PAT` +
   `CONTINIA_API_TOKEN`. (This example file ships in the repo at
   `CreateScriptsForVideos/.env.create-scripts.example`.)
7. Add the `create-scripts-for-videos` service from this repo's `docker-compose.yml` into the
   team `docker-compose.yml` (or run it as a separate `-f` file). Confirm the volume paths match
   your host layout.
8. Build and start:
   ```bash
   docker compose build --no-cache create-scripts-for-videos
   docker compose up -d create-scripts-for-videos
   docker compose logs -f create-scripts-for-videos
   ```

## AL compiler

`continia compile` / `continia deploy` need a Linux `alc`. Resolution order (from the
`continia-deploy` skill): `CONTINIA_ALC_PATH` → AL VS Code extension's bundled alc →
`altool`'s `al compile` (analyzers may not load in that fallback).

Provision one of:
- Extract `bin/linux/alc` from the AL Language `.vsix` onto the host, mount it, and set
  `CONTINIA_ALC_PATH` to its container path; **or**
- Install `altool` so `al compile` is on PATH.

Until this is done, env provisioning works but compile/deploy steps will fail.

## Deploying changes

Service code updates via git; **the binary and token do not.**
```bash
cd ~/teams/continia-banking/CreateScriptsForVideos && git pull && cd ..
docker compose build --no-cache create-scripts-for-videos
docker compose up -d create-scripts-for-videos
```
To update the continia binary, replace `~/tools/continia-linux` and `docker compose restart
create-scripts-for-videos` (no rebuild needed — it's mounted).

## After a VM restart / re-auth / troubleshooting

Identical to the investigate tool — see its README sections
"Starting After VM Restart", "Re-authenticating Claude Code", and "Troubleshooting".
The non-root `claude` user, root-then-drop entrypoint, and `chown -R` on volumes work the
same way here.

## Operational notes

- **Cost/cleanup:** each processed item provisions a BC environment and leaves it running
  (`create-script.md` step 6). Track environments and prune old ones; `MAX_PROCESS_ATTEMPTS`
  retries can spin up several per item.
- **Never write into continia-banking:** `PTE_OUTPUT_DIR`/`WORKSPACE_OUTPUT_DIR` point at the
  writable `/app/output` volume, separate from the `:ro` banking mount. Keep it that way.
