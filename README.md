# CreateScriptsForVideos

Watches Azure DevOps for work items tagged `create script` and turns each one into a complete demo package for a Continia Banking feature: a Markdown recording script, a demo-data PTE (AL extension), and a running Business Central environment with everything published.

## How it works

1. The watcher polls Azure DevOps for work items with the tag. WIQL narrows candidates by tag and area path; the exact tag match happens in code.
2. For each item the pipeline runs these steps:

   | Step | Done by | Result |
   |---|---|---|
   | Generate | Agent (`prompts/generate.md`, `demo-data-orchestrator` skill) | PTE folder and recording script |
   | Validate | Agent (`prompts/validate.md`, `demo-data-validator` skill) | Blockers fixed or reported |
   | Provision | Code (`continia env create` / `start`) | Fresh environment; profile derived from continia-banking's BC version and `CONTINIA_ENV_LOCALIZATION` |
   | Activate | Code (`continia deps install-by-id`) | Continia activation app installed |
   | Deploy | Agent (`prompts/deploy.md`, `continia-deps` / `continia-deploy` skills) | PTE (and `banking-demo` if needed) published |
   | Verify | Code (`continia env apps`, `env users`) | PTE confirmed installed, credentials collected |

3. The script is attached to the work item, and a comment carries the environment URL and credentials. On failure, the comment explains why and lists any environment that is still running.
4. The tag is removed after each attempt. Re-adding it requests a new run.

Items tagged `create video` run the same steps, then record the demo in the environment with BC's own replay engine, narrate it and attach `demo-video-<id>.mp4` (a draft for review). After deploy, a recording stage turns the script into a BC Page Scripting recording (`recording.yml`) and narration, using the PTE's symbol packages for exact page, field and action names (`symbols` / `recording-check` CLI tools). The code checks it again before recording; see `src/video/` and `prompts/recording.md`.

Each agent stage has its own model, effort, turn cap, budget cap and timeout. See `.env.example`.

## Getting started

```bash
bun install
cp .env.example .env     # fill in Azure DevOps, continia and Anthropic settings
bun test
bun src/cli/index.ts help
bun src/cli/index.ts test-item <id>            # one item, no ADO writes (still provisions an env)
bun src/cli/index.ts test-item <id> --resume   # continue a failed item from its last good step
bun src/cli/index.ts test-item --brief brief.md --video   # local brief (# Title + description), no ADO
bun run start                                  # watcher
```

Deployment on the VM (Docker) is described in [DEPLOY.md](DEPLOY.md).

## Project structure

```
prompts/                       # Agent stage prompts (invariants + one per stage)
.claude/skills/                # Skills the agent stages use
src/
├── cli/index.ts               # CLI entry point (watch, run-once, test-item)
├── config/index.ts            # Zod-based environment validation, per-stage settings
├── sdk/azure-devops-client.ts # Azure DevOps REST client with retry
├── services/
│   ├── watcher.ts             # Polling loop with graceful shutdown
│   ├── processor.ts           # Work item in, comment and attachment out
│   ├── pipeline.ts            # The staged per-item pipeline
│   ├── agent-stage.ts         # One Agent SDK session per stage
│   ├── continia-cli.ts        # Typed wrapper over the continia CLI
│   └── pruner.ts              # Deletes old output folders
└── types/index.ts             # Shared interfaces
tests/                         # Mirrors src/
```

## Commands

| Command | Description |
|---------|-------------|
| `bun run start` | Start the watcher (polls every N minutes) |
| `bun run once` | Run a single poll cycle and exit |
| `bun src/cli/index.ts test-item <id> [--resume]` | Process one work item without ADO writes |
| `bun test` | Run all tests |
| `bun run typecheck` | TypeScript type checking |

Add `--dry-run` to `watch` or `run-once` to skip Azure DevOps writes. The pipeline still runs at full cost.

## Patterns

See [PATTERNS.md](PATTERNS.md).
