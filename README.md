# CreateScriptsForVideos

Watches Azure DevOps for work items tagged `create script` and turns each one into a complete demo package for a Continia Banking feature: a Markdown recording script, a demo-data PTE (AL extension), and a running Business Central environment with everything published.

## What is this?

This pipeline:
- Polls Azure DevOps for work items tagged `create script` (WIQL narrows candidates, exact tag match happens in code)
- Runs a Claude agent (orchestrated by `.claude/commands/create-script.md` and the `.claude/skills/` set) to research the feature, generate demo data, and write the recording script
- Publishes a demo-data PTE and a running BC environment, then reports back to the work item
- Removes the tag after each attempt — the tag itself is the queue, no persisted state
- Runs as a watcher (continuous polling) or on-demand (single run)

## Getting started

1. Clone this repo and install dependencies:
   ```bash
   git clone <this-repo-url>
   cd CreateScriptsForVideos
   bun install
   ```
2. Copy `.env.example` to `.env` and fill in your Azure DevOps credentials:
   ```bash
   cp .env.example .env
   ```
3. Run tests to verify everything works:
   ```bash
   bun test
   ```
4. Try the CLI:
   ```bash
   bun src/cli/index.ts help
   bun src/cli/index.ts run-once --dry-run
   ```
5. Start the watcher:
   ```bash
   bun run start
   ```

## Customizing for your project

1. **Update `package.json`** — change the `name` field
2. **Update `.env.example`** — add any project-specific env vars
3. **Adjust discovery** — set `CREATE_SCRIPT_TAG` / `AZURE_DEVOPS_AREA_PATH` to scope which work items get picked up
4. **Replace the processor** — edit `src/services/processor.ts` with your business logic
5. **Update the orchestration prompt** — edit `.claude/commands/create-script.md`
6. **Update types** — add project-specific interfaces to `src/types/index.ts`
7. **Update this README** — describe what your project does

## Project structure

```
src/
├── cli/index.ts              # CLI entry point (watch, run-once, test-item)
├── config/index.ts           # Zod-based environment variable validation
├── sdk/azure-devops-client.ts # Azure DevOps REST API client with retry
├── services/
│   ├── watcher.ts            # Polling loop with graceful shutdown
│   ├── processor.ts          # Business logic (processor)
│   └── orchestrator-agent.ts # Claude agent integration
└── types/index.ts            # Shared TypeScript interfaces

tests/                        # Mirror of src/ with full test coverage
```

## Commands

| Command | Description |
|---------|-------------|
| `bun run start` | Start the watcher (polls every N minutes) |
| `bun run once` | Run a single poll cycle and exit |
| `bun src/cli/index.ts test-item <id>` | Process a single work item in dry-run mode |
| `bun test` | Run all tests |
| `bun run typecheck` | Run TypeScript type checking |

Add `--dry-run` to any command to skip Azure DevOps writes.

## Patterns

See [PATTERNS.md](PATTERNS.md) for a quick reference of all architectural patterns used in this codebase.
