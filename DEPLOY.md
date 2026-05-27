# VM Deployment (Docker)

Runs as a Docker container on the same Azure VM as `DevOpsInvestigateWorkItems`,
under `~/teams/continia-banking/`. The watcher polls Azure DevOps, and for each opted-in
work item the Claude agent generates a recording script + demo-data PTE and provisions a
fresh BC environment via the `continia` CLI.

This mirrors the investigate tool's deployment. The differences, all because this tool
*builds and publishes* rather than just reading code:

| | Investigate tool | This tool |
|---|---|---|
| External binaries | none | `continia` (linux) + a Linux `alc` + the AL language-server plugin |
| Output | comments only | **writable** `/app/output` volume (PTE + script) |
| Cloud side effects | none | creates BC environments per item (cost + cleanup) |
| Deploy = `git pull`? | yes | **no** — the binaries + token are provisioned out of band |

## Prerequisites

- SSH access to the VM; Claude Code team subscription (OAuth)
- The `continia-linux` binary
- A Linux `alc` (AL compiler) — extracted from the AL extension `.vsix` (below)
- The AL language-server plugin, linux variant (below)

## Directory structure

```
~/repos/continia-banking/                         # cloned once, mounted :ro (shared with investigate)
~/output/                                          # generated PTEs + scripts, per work item (browsable)
~/tools/continia-linux                            # the linux CLI binary (chmod +x)
~/tools/al/al-ext/extension/bin/                  # AL compiler: linux/alc + Analyzers/ (from the .vsix)
~/tools/claude-code-lsps/al-language-server-go-linux/   # AL language-server plugin (linux)
~/teams/continia-banking/
  docker-compose.yml                              # shared; add the create-scripts-for-videos service
  .env.create-scripts                             # secrets (PAT, CONTINIA_API_TOKEN)
  CreateScriptsForVideos/                         # this repo (cloned)
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
   ~/tools/continia-linux --version
   ```
4. Provision the AL compiler (see [AL compiler](#al-compiler)) and the LSP plugin
   (see [AL language-server plugin](#al-language-server-plugin)).
5. Claude Code OAuth is shared from the host `~/.claude` (already set up for investigate).
   If you see auth errors, re-authenticate on the host (same procedure as the investigate README).
6. `cp CreateScriptsForVideos/.env.create-scripts.example .env.create-scripts` and fill in
   `AZURE_DEVOPS_PAT` + `CONTINIA_API_TOKEN`. This file lives at the team root next to
   `docker-compose.yml` (where `env_file:` resolves it), NOT inside the repo.
7. Merge the `create-scripts-for-videos` service from this repo's `docker-compose.yml` into the
   shared team `docker-compose.yml`, and add the two named volumes. Confirm the host volume
   paths match your layout.
8. Validate, build, and start:
   ```bash
   docker compose config                                  # validates the merged YAML
   docker compose build create-scripts-for-videos
   docker compose up -d create-scripts-for-videos
   docker compose logs -f create-scripts-for-videos
   ```

## AL compiler

`continia compile` / `continia deploy` need a Linux `alc`. Resolution order (from the
`continia-deploy` skill): `CONTINIA_ALC_PATH` → AL VS Code extension's bundled alc →
`altool`'s `al compile` (analyzers may not load in that fallback). We supply our own via
`CONTINIA_ALC_PATH`, pinned to the version the dev machines use (`18.0.2293710`):

```bash
mkdir -p ~/tools/al && cd ~/tools/al
curl -L --compressed -o al.vsix \
  "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-dynamics-smb/vsextensions/al/18.0.2293710/vspackage"
file al.vsix    # expect "Zip archive"; if "gzip": mv al.vsix a.gz && gunzip a.gz && mv a al.vsix
unzip -q al.vsix -d al-ext
chmod +x al-ext/extension/bin/linux/alc al-ext/extension/bin/linux/altool al-ext/extension/bin/linux/aldoc
al-ext/extension/bin/linux/alc --version   # sanity on the host
```

`alc` is a .NET app; its runtime dep `libicu` is installed in the Dockerfile so it also runs
inside the container. The whole `bin/` is mounted (`/opt/al/bin`) so the `Analyzers/` DLLs
resolve relative to `alc`. Mount + env are in `docker-compose.yml`:
`/home/azureuser/tools/al/al-ext/extension/bin:/opt/al/bin:ro` and
`CONTINIA_ALC_PATH=/opt/al/bin/linux/alc`.

## AL language-server plugin

The agent loads an AL language server as a local Claude Code plugin (improves data-dependency
tracing; without it the skills fall back to Grep/Read). Use the **linux** variant from the
`claude-code-lsps` marketplace — your local install is the Windows variant and won't run in the
container. The binaries are committed (no Git-LFS, no Go build needed):

```bash
git clone https://github.com/SShadowS/claude-code-lsps.git ~/tools/claude-code-lsps
chmod +x ~/tools/claude-code-lsps/al-language-server-go-linux/bin/*
```

The plugin root is the `al-language-server-go-linux` folder (it contains `plugin.json` and a
`.lsp.json` that launches `bin/al-lsp-wrapper`). Mount + env are in `docker-compose.yml`:
`/home/azureuser/tools/claude-code-lsps/al-language-server-go-linux:/opt/al-lsp-plugin:ro` and
`LSP_PLUGIN_PATH=/opt/al-lsp-plugin`. (Optional — leave both out to run with the Grep/Read fallback.)

## Deploying changes

Service code updates via git; **the binaries and token do not.**
```bash
cd ~/teams/continia-banking/CreateScriptsForVideos && git pull && cd ..
docker compose build --no-cache create-scripts-for-videos
docker compose up -d create-scripts-for-videos
```
To update the continia binary / alc / LSP plugin, replace the files under `~/tools/` and
`docker compose restart create-scripts-for-videos` (no rebuild — they're mounted).

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
- **Output is browsable on the host:** `/app/output` is bind-mounted to `~/output`, so each
  item's PTE + script land at `~/output/<workItemId>/`. The container writes as the `claude`
  user (uid 1001), so files there are owned by uid 1001 — readable by azureuser; use `sudo` to
  delete. Create the folder before first start: `mkdir -p ~/output`.
