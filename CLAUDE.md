# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CreateScriptsForVideos watches Azure DevOps for work items tagged `create script` and turns each one into a complete demo package for a Continia Banking feature: a Markdown recording script, a demo-data PTE (AL extension), and a running Business Central environment with everything published. Orchestration lives in `.claude/commands/create-script.md` (the agent's system prompt) and the `.claude/skills/` set; the TypeScript in `src/` is the watcher/processor shell around the agent.

## Architecture

- **Runtime:** Bun (TypeScript)
- **Validation:** Zod for environment config
- **AI:** @anthropic-ai/claude-agent-sdk for Claude integration
- **Testing:** Bun's built-in test framework

## Key Patterns

- **Dependency injection** via interfaces on all services for testability
- **Exponential backoff retry** on Azure DevOps API calls (5xx/network errors)
- **Tag-driven queue** — the work-item tag is the queue, removed after each attempt; no persisted state
- **Polling watcher** with graceful SIGINT/SIGTERM shutdown
- **Tag-driven discovery** — WIQL narrows to candidates by tag substring + area path; exact tag match in code

## Commands

- `bun test` — run all tests
- `bun run typecheck` — TypeScript type checking
- `bun run start` — start the watcher
- `bun run once` — single poll cycle

## File Layout

- `src/config/` — Zod env validation
- `src/sdk/` — Azure DevOps REST client (WIQL queries, work item CRUD)
- `src/services/` — business logic (processor, watcher, AI generator)
- `src/types/` — shared interfaces
- `src/cli/` — entrypoint (`watch`, `run-once`, `test-item`)
- `.claude/commands/create-script.md` — orchestration prompt (system prompt for the agent)
- `.claude/skills/` — demo-data-orchestrator, demo-data-validator, demo-spec-generator, continia-* deploy/test skills
- `tests/` — mirrors src/ structure
