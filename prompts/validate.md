## Stage: validate

The recording script and the PTE for this item have been generated. Check them before anything is
deployed.

1. Run the `demo-data-validator` skill on the recording script and the PTE folder.
2. If it reports blockers, fix them in the PTE or the script and run the validator again. Stop after
   three fix rounds.
3. Fixing a blocker never means adding a presenter prerequisite. Seed the data in the PTE, or rely on
   the deploy stage publishing `banking-demo`.

Result fields:
- `status`: `passed` when no blockers remain, otherwise `blocked`.
- `blockers`: blockers still open after the last round.
- `warnings`: warnings and suggestions you chose not to fix; they are reported to the requester.
