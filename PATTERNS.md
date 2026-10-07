# Patterns Reference

Quick reference for the architectural patterns used in this codebase. Each links to the source file where it's implemented.

## Zod Config Validation

**File:** `src/config/index.ts`

Environment variables are validated at startup using a Zod schema. Required vars throw descriptive errors. Optional vars have defaults. The `loadConfig()` function accepts an optional `env` parameter for testing.

## Dependency Injection

**Files:** `src/services/processor.ts`, `src/services/watcher.ts`

Services define a `Deps` interface listing their external dependencies as function signatures. A `defaultDeps` object wires to production implementations. Test code passes mock deps directly — no module mocking needed.

## Exponential Backoff Retry

**File:** `src/sdk/azure-devops-client.ts`

`adoFetchWithRetry()` wraps `adoFetch()` with configurable retry delays (default: 1s, 2s, 4s). Always retries 429 (honoring `Retry-After`); retries 5xx and network errors only for idempotent requests — non-idempotent POSTs (comments, attachments) are never retried on those. Other 4xx re-throw immediately. Tests pass `[0, 0, 0]` delays for speed.

## Tag-driven queue (no persisted state)

Discovery is driven entirely by the work-item tag (`queryTaggedWorkItems`), and the processor removes the tag after every attempt that reached the pipeline (success or failure). A failure before the pipeline starts keeps the tag, so the item is retried next cycle. The tag's presence IS the queue, so there's no processed-item state to persist; re-tagging an item requests it again.

## Polling with Graceful Shutdown

**File:** `src/services/watcher.ts`

`startWatcher()` runs a polling loop with configurable interval. Uses `SIGINT`/`SIGTERM` listeners to set an abort flag. `sleep()` checks the flag every second so shutdown is responsive.

## Staged pipeline

**File:** `src/services/pipeline.ts`

Each work item runs through fixed steps: generate, validate, provision, activate, deploy, verify. Only generate, validate and deploy need an agent. Provision, activate, verify and the credential lookup are plain code against the continia CLI (`src/services/continia-cli.ts`). After each step the pipeline saves `pipeline-state.json` in the item's output folder (never credentials), so `test-item <id> --resume` continues from the last good step.

## Agent stages

**File:** `src/services/agent-stage.ts`

`runAgentStage()` runs one Agent SDK session per stage with that stage's model, effort, turn cap, budget cap and timeout (`STAGE_<S>_*`, falling back to `CLAUDE_MODEL` / `CLAUDE_EFFORT`). The stage prompts in `prompts/` are appended to the Claude Code preset system prompt, `invariants.md` first. The stage result is a zod schema converted to JSON Schema and passed as `outputFormat`; the stage reads `structured_output` and validates it again with zod. The function never throws: errors, timeouts and schema mismatches come back as `ok: false` with the usage seen so far. Azure DevOps variables are not passed to the agent.

## CLI Command Dispatch

**File:** `src/cli/index.ts`

Simple `switch` statement on `process.argv[2]`. Supports `watch`, `run-once`, `test-item <id> [--resume]`, `help`. Global `--dry-run` flag. No external CLI framework needed.

## Testing with Mock Helpers

**Files:** `tests/services/processor.test.ts`, `tests/services/watcher.test.ts`

`testConfig()` (`tests/helpers/config.ts`), `mockWorkItem()`, and `makeDeps()` factory functions create test fixtures with sensible defaults. Override specific fields via spread syntax. Uses `bun:test` mock functions. Agent stages are tested with a fake `query` that yields SDK result messages.
