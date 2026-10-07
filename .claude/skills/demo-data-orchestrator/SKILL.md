---
name: demo-data-orchestrator
description: "Builds a demo package for a Continia Banking feature: researches the data the demo flow needs, writes a demo-data PTE (AL extension that seeds the data on install), and writes a Markdown recording script. Use it when a feature demo needs seeded data; for a script alone, use demo-spec-generator."
---

# Demo Data Orchestrator

Researches what data a feature demo needs, generates a deployable AL extension (PTE) that creates
that data on install, then writes the human-readable Markdown recording script.

The skill runs unattended inside the pipeline's generate stage. Make reasonable decisions yourself
and record them as assumptions; nobody is available to answer questions. The pipeline invariants
apply (read-only continia-banking repo, internal access via the Internal Access dependency, one PTE
in place, no presenter prerequisites).

**Outputs**, at the paths the caller provides:
1. The PTE folder: `app.json`, `.vscode/launch.json`, `InstallDemoData.Codeunit.al` written directly
   into it.
2. The recording script, written to the recording script file path the caller gives.

Compiling and publishing the PTE is a separate deploy stage; this skill only writes the files.

## Workflow

Six phases, in order.

### Phase 1 — Parse and discover

Follow `demo-spec-generator` steps 1-3 to identify the feature and its starting page. Find pages
with the LSP tool (`workspaceSymbol`, then `documentSymbol` for the numeric page ID), falling back
to `Grep` and `Glob` (`**/*<feature>*.al`). Record each page's file path, numeric ID, and caption.
If the brief is vague, pick the happy path and log that as an assumption.

### Phase 2 — Research data dependencies

Follow `references/data-research-strategy.md`. In outline:

1. Get the page's SourceTable, then the table's fields and `TableRelation` dependencies.
2. Classify each related table as COVERED, SETUP, STANDARD-BC, CUSTOM, or COMPLEX (definitions in
   the strategy file). Everything except SETUP is created by direct `Init`/`Insert` in the PTE.
3. Recurse up to depth 3.
4. Trace the code path of every action the demo clicks. Static table relations miss runtime
   validations (`Error`, `TestField`, `if not Get() then Error`), and those are the usual reason a
   demo fails on camera.
5. Mine the `*-test/` apps: Library `Create*()` procedures are compiler- and runtime-validated
   field references, and Given-When-Then test methods map onto demo setup, action, and result.
6. Topologically sort the tables so dependencies are created first.
7. Design the initial data state for visual contrast: the first action must produce a visible
   change, toggles start in the opposite state, resets start customized.
8. Log the data map (tables, classifications, creation order, chosen initial state and the demo
   step that drove it) as assumptions.

### Phase 3 — Generate the PTE

Follow `references/al-template.md` for the file contents. The essentials:

- `app.json` depends on Continia Banking (`83461f48-dd16-49ea-b00c-e656830c640f`) and on Continia
  Banking Internal Access (`6e549e35-d1b2-4878-a37a-a736c22f35bf`), plus any other Continia app
  whose objects the codeunit references. Generate the `id` with
  `bun -e "console.log(crypto.randomUUID())"`; a zero GUID fails with AL1053. Copy `platform`,
  `application`, and the Continia Banking version from `base-application/app.json` so the PTE
  compiles against the same symbols.
- The name is `"Continia Demo Data - <Feature Name>"`; the pipeline requires the "Continia" prefix.
- The install codeunit (ID 50000, range 50000-50099) runs `CreateDemoData()` then `VerifyDemoData()`
  from `OnInstallAppPerCompany()`. `VerifyDemoData()` re-reads every seeded record and raises an
  error naming the first missing one, so a broken PTE fails at publish time instead of producing an
  empty demo.
- Every insert is idempotent (`if not Get() then Init/Insert`), because a failed install is retried
  by republishing.
- Every hardcoded value is a Label with a Comment, grouped by entity.
- Use the management-codeunit catalog only as a field reference. The banking-demo codeunits are
  internal to that app and cannot be called from the PTE.
- Fields from Continia table extensions (field IDs 71553575 and up) are set through RecordRef,
  because the compiler resolves `Record` against the base table symbol.
- Use enum AL identifiers (`PAIN001`), not captions (`pain.001`); check the enum's `.al` file.
- Create only what the flow touches: 2-3 records per entity, with country-appropriate sample values.
- COMPLEX tables (bank systems, authentication) are created directly in the PTE, modelled on
  `banking-demo/General/Codeunits/NonLocalized/SetupBankAcc.Codeunit.al`. When the data is baseline
  demo-company data the PTE cannot reasonably reproduce, rely on the deploy stage publishing
  `banking-demo` and report `needsBankingDemo: true`.

Revisions edit the existing files in place. Log a short summary of what the PTE creates.

### Phase 4 — Write the recording script

Follow `demo-spec-generator` steps 4-7, writing the script to the recording script file path the
caller gave.

The script's "Before you record" section describes the state the pipeline has already set up (for
example, "The demo company has bank accounts A and B with imported statement lines"). It never asks
the presenter to install apps or create data, because the pipeline provisions the environment and
publishes the PTE and `banking-demo` before recording.

### Phase 5 — Self-review (2-3 passes)

Re-read the script and the PTE against the AL code. Stop early when a pass finds nothing. Apply
fixes directly to the files and log what changed and why.

1. **Step completeness.** For each step, re-read the AL trigger or action behind it. Look for
   dialogs, StrMenus, and confirmations that need extra clicks; drilldowns that need a close step;
   tab clicks before non-promoted actions; view mode versus edit mode; and step order as a user
   would experience it.
2. **Caption and value precision.** Match every caption against its AL `Caption` property
   (ellipses, abbreviations, locked captions, `&nbsp;`). Make sure each step names the page that is
   actually visible at that point (after a drilldown, the drilldown page) and that each "Say:" hint
   describes UI that exists.
3. **Data completeness.** Re-trace each action's code path for validations, visibility conditions,
   and required statuses the PTE does not yet satisfy. Compare the PTE's table and field coverage
   with what the tests create for the same feature, and add whatever the demo flow needs.

### Phase 6 — Summary

Report:
- The paths of both outputs.
- Tables populated and approximate record counts.
- Pages covered by the script.
- Fixes made during self-review.
- Assumptions made during research and generation.
- Gaps: known limitations of the demo (for example, an action skipped because its validation needs
  data no insert can produce). These are limitations, not tasks for the presenter.
