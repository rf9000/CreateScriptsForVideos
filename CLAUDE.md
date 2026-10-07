# CLAUDE.md

## Project Overview

CreateScriptsForVideos watches Azure DevOps for work items tagged `create script` and turns each one into a complete demo package for a Continia Banking feature: a Markdown recording script, a demo-data PTE (AL extension), and a running Business Central environment with everything published. `src/services/pipeline.ts` runs each item through generate, validate, provision, activate, deploy and verify. Generate, validate and deploy are separate agent sessions (prompts in `prompts/`, skills in `.claude/skills/`), each with its own model and limits. The environment steps are plain code against the continia CLI.

## Architecture

- **Runtime:** Bun (TypeScript)
- **Validation:** Zod for environment config
- **AI:** @anthropic-ai/claude-agent-sdk for Claude integration
- **Testing:** Bun's built-in test framework

## Key Patterns

- **Dependency injection** via interfaces on all services for testability
- **Exponential backoff retry** on Azure DevOps API calls — 429 always retried honoring Retry-After; 5xx/network only on idempotent requests
- **Tag-driven queue** — the work-item tag is the queue, removed after each attempt; the only saved state is per-item `pipeline-state.json` for `--resume`
- **Polling watcher** with graceful SIGINT/SIGTERM shutdown
- **Staged pipeline** — per-stage model, effort and limits; structured output via JSON schema; resumable via `pipeline-state.json`
- **Tag-driven discovery** — WIQL narrows to candidates by tag substring + area path; exact tag match in code

## Commands

- `bun test` — run all tests
- `bun run typecheck` — TypeScript type checking
- `bun run start` — start the watcher
- `bun run once` — single poll cycle

## File Layout

- `src/config/` — Zod env validation
- `src/sdk/` — Azure DevOps REST client (WIQL queries, work item CRUD)
- `src/services/` — processor, watcher, pipeline, agent stages, continia CLI wrapper, pruner
- `src/types/` — shared interfaces
- `src/cli/` — entrypoint (`watch`, `run-once`, `test-item [--resume]`)
- `src/video/` — demo video: recording lint, BC replay session, cosmetic staging, narration, composition
- `prompts/` — agent stage prompts (`invariants.md` plus one per stage), appended to the Claude Code system prompt
- `.claude/skills/` — demo-data-orchestrator, demo-data-validator, demo-spec-generator, continia-* CLI skills
- `tests/` — mirrors src/ structure
