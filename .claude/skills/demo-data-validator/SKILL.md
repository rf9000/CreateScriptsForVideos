---
name: demo-data-validator
description: Validates a generated demo-data PTE against its Markdown recording script and the AL codebase, returning blockers, warnings, and suggestions. Use after the PTE and script are generated and before they are deployed.
---

# Demo Data Validator

A demo fails on camera when the script points at data the PTE never created, when a required field
or related record is missing, or when the data is too thin to teach anything. This skill catches
those problems before deploy by checking the PTE against the script and against the actual AL code,
not against assumptions. The goal: data that is coherent with the script, realistic, complete, and
good enough to teach a beginner.

## Inputs

- The recording script file.
- The PTE folder (`app.json`, `InstallDemoData.Codeunit.al`).
- The continia-banking repo, read-only, for LSP tracing and its automated tests.

## Workflow

Dispatch the four sub-agents below in parallel: one `Agent` call each, all in a single message. Give
each the three inputs, its check, and the findings format. When all have returned, aggregate.

Each sub-agent returns a JSON list of findings:

```json
[{ "severity": "blocker|warning|suggestion", "check": "<agent>", "finding": "...", "suggestion": "..." }]
```

- **blocker:** the demo will not work or actively misleads (missing record, unset required field, a
  script step that relies on data that isn't seeded). Must be fixed.
- **warning:** likely to confuse or look unrealistic; fix if cheap.
- **suggestion:** polish.

### Sub-agent 1 — Script and data coherency

Cross-check every entity and value the script tells the recorder to open, select, or type against
what the PTE inserts. A step that depends on a record or value the PTE doesn't create is a blocker.
Data the PTE seeds but the script never uses is a warning.

Any script text (starting state, narration, gaps) that asks the presenter to install an app, publish
an extension, or prepare setup data is a blocker, because the pipeline supplies all of that. The fix
is to seed the data in the PTE or rely on the deploy stage publishing `banking-demo`. The presenter
may create only records whose creation is itself an on-camera demo step.

### Sub-agent 2 — Value realism

Inspect every field value the PTE sets. Flag placeholders and gibberish (`TEST`, `asdf`, `xxx`,
sequential `123`), implausible amounts, and malformed IBANs, bank codes, or dates. Base realistic
replacements on the localized templates in `banking-demo` (e.g. the DK and DE folders) and the
`Library Create*` procedures in the test apps. Realism issues are usually warnings; a malformed value
that will fail validation is a blocker.

### Sub-agent 3 — Data completeness

The code-driven check. Follow
`.claude/skills/demo-data-orchestrator/references/data-research-strategy.md` (the backward trace and
the "Mine Automated Tests" section), using LSP `documentSymbol`, `goToDefinition`, `findReferences`,
and `outgoingCalls`. For each table the PTE inserts, confirm:

- all primary-key fields are set;
- all mandatory fields are set, meaning those guarded by `TestField`, `NotBlank`, or `Error()` in the
  table triggers and in the action code paths the script triggers;
- every `TableRelation` on a set field points at a record that exists, recursing into those tables;
- every setup record the feature's tests create (`Initialize()` and `Create*` library procedures) is
  also created by the PTE, since tests often reveal setup in unrelated tables that a relation trace
  misses.

A missing related or setup record is a blocker until shown to be unneeded. The remedy is to create it
in the PTE, or for baseline demo-company data to rely on `banking-demo`, never a presenter
prerequisite.

### Sub-agent 4 — Teaching fit

Judge whether the data and script support a step-by-step learning video for a customer with no prior
product knowledge: enough records to show the concept (not just one), a clear before/after contrast
for toggles and actions, no confusing leftover or ambiguous state, and names that explain rather than
obscure. Mostly warnings and suggestions; a state that makes a teaching step impossible, such as
nothing to contrast, is a blocker.

## Verdict

Merge all findings, remove duplicates, sort by severity, and return:

```json
{ "passed": <true if zero blockers>, "blockers": [...], "warnings": [...], "suggestions": [...] }
```

## How the validate stage uses the verdict

The validate stage (`prompts/validate.md`) fixes the blockers in the PTE or the script and runs this
skill again, for at most three fix rounds. It then reports `passed` or `blocked`, with the blockers
still open and the warnings it chose not to fix.

This skill only reads. It never modifies continia-banking, and it doesn't compile, deploy, or run the
PTE; runtime verification happens in the deploy stage.
