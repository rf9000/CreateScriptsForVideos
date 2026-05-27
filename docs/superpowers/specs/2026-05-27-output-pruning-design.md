# Age-based output pruning — design

**Date:** 2026-05-27
**Status:** Approved (design); implementation pending

## Problem

The `create-script` pipeline writes one folder per processed work item to the output
bind mount: `output/<workItemId>/` containing the generated `script.md` and the demo-data
PTE source (see `src/services/orchestrator-agent.ts`, where both paths are derived as
`join(<dir>, String(itemId))`). On the VM this is bind-mounted to
`~/teams/continia-banking/output/<id>/`.

Nothing ever removes these folders, so disk usage grows without bound. `DEPLOY.md`
already flags this under "Operational notes" as a manual chore ("prune old ones").

Cleanup of the **cloud BC environments** provisioned per item is a separate concern and is
explicitly out of scope here — this design covers only the on-disk artifacts.

## Why whole-folder deletion is safe

- The **script** content is echoed back as an ADO work-item comment by
  `src/services/processor.ts`, so it survives disk deletion.
- The **PTE** source is rebuildable from the repo and is also published to the
  environment.

Disk is therefore not the system of record; deleting an aged `output/<id>/` folder loses
nothing that cannot be recovered.

## Policy

At the end of each poll cycle the watcher scans the top level of the output dir(s) and
deletes any `<workItemId>/` folder whose most-recent file write is older than a retention
window.

- **`OUTPUT_RETENTION_DAYS`** — new Zod env var, **default `14`**. A value of `0` disables
  pruning entirely (safety off-switch); the prune step is skipped without scanning.
- **Age metric:** the newest file mtime *within* the folder, not the directory's own
  mtime. This is robust to retries / partial writes — age reflects the last time the
  pipeline wrote anything for that item.
- **Scope guard:** only direct children of the output dir whose name is **purely numeric**
  (the `<id>` convention) are eligible for deletion. Any other file or directory is left
  untouched.
- **Multiple dirs:** prune the de-duplicated union of `{workspaceOutputDir, pteOutputDir}`.
  In the default deployment these are the same directory.
- **Permissions:** no `sudo` needed — the watcher runs as the same `claude` user (uid 1001)
  that wrote the files, so it owns them.
- **Logging:** every deletion logs a line, e.g. `Pruned output/<id>/ (age 17d)`.

## Code shape

All new code follows the repo's dependency-injection pattern (filesystem behind an
injectable interface) so it is unit-testable without touching a real filesystem.

- **`src/services/pruner.ts`** — exports `pruneOldOutputs(config, deps?)`. Injectable deps:
  - `readDirEntries(dir): string[]` — top-level entry names
  - `statNewestMtime(path): number | null` — newest file mtime under a folder (ms epoch);
    `null` if not a directory / unreadable
  - `removeDir(path): void` — recursive delete
  - `now(): number` — current time (ms epoch)
  - `log(message): void`
  Logic: for each distinct output dir, list entries, keep only numeric-named directories,
  compute `now - newestMtime`, and `removeDir` + `log` when it exceeds
  `outputRetentionDays` (converted to ms). Returns a count of pruned folders.

- **`src/config/index.ts`** — add `OUTPUT_RETENTION_DAYS: z.coerce.number().int().min(0).default(14)`
  to the schema, surfaced as `config.outputRetentionDays`.

- **`src/services/watcher.ts`** — add `pruneOutputs` to `WatcherDeps` (default →
  `pruner.pruneOldOutputs`). Call it once per `runPollCycle`, after the item loop and before
  returning the cycle result. Skip the call entirely when `outputRetentionDays === 0`.

- **`tests/services/pruner.test.ts`** — cases:
  - folder older than the window is deleted
  - folder newer than the window is kept
  - non-numeric-named entry is never deleted
  - retention `0` prunes nothing
  - empty / missing output dir is a no-op

## Docs

Update the "Operational notes" section of `DEPLOY.md`: the on-disk half of the cost/cleanup
note now describes automatic pruning and the `OUTPUT_RETENTION_DAYS` env var. The
cloud-environment cleanup note stays as a separate, still-manual concern.

## Out of scope

- Cleanup / teardown of the per-item cloud BC environments and their published PTEs.
- Unpublishing the PTE extension from environments.
- Any change to ADO work-item tags/comments.
