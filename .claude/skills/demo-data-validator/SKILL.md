---
name: demo-data-validator
description: "Use when a demo-data PTE and its Markdown recording script have been generated and need validation before the demo package is considered complete. Triggers on: validate demo data, check the PTE, verify demo data, demo data review, before publishing demo data."
---

# Demo Data Validator

Validate a generated demo-data PTE against its recording script and the AL codebase before the demo
package is trusted. Runs **four specialized sub-agents in parallel**, then aggregates their findings
into a single verdict. The caller uses the verdict as a **blocking gate with a fix loop**: blockers
must be fixed and re-validated before reporting success.

**Core principle:** the demo data must be coherent with the script, realistic, complete (every
required field and related record exists), and good enough to teach a beginner — verified against the
actual AL code, not assumed.

## Inputs

- Path to the generated `.md` recording script.
- Path to the generated PTE folder (`app.json`, `InstallDemoData.Codeunit.al`).
- Read-only continia-banking repo (for LSP tracing and automated tests).

## Workflow

Dispatch the four sub-agents below **concurrently** (one `Task` per agent, single message — see
`superpowers:dispatching-parallel-agents`). Give each the three inputs above and the findings
contract. When all return, aggregate and emit the verdict.

Each sub-agent returns a JSON list of findings:

```json
[{ "severity": "blocker|warning|suggestion", "check": "<agent>", "finding": "...", "suggestion": "..." }]
```

- **blocker** — the demo will not work or actively misleads (missing record, unset required field, script step referencing data that isn't seeded). Must be fixed.
- **warning** — likely to confuse or look unrealistic; fix if cheap.
- **suggestion** — polish.

### Sub-agent 1 — Script ↔ data coherency
Cross-check every entity and value the script tells the recorder to open, select, or type against
what the PTE actually inserts. **Blocker** when a script step depends on a record/value the PTE does
not create. **Warning** when the PTE seeds entities the script never uses (dead data) — unless they
are required prerequisites.

### Sub-agent 2 — Value realism
Inspect every field value the PTE sets. Flag placeholder/gibberish values (`TEST`, `asdf`, `xxx`,
sequential `123`), implausible amounts, malformed IBANs/bank codes/dates. Ground realistic
replacements in the localized templates (`banking-demo/.../DK`, `.../DE`) and the test
`Library Create*` procedures. Realism issues are usually **warnings**; malformed values that fail
validation are **blockers**.

### Sub-agent 3 — Data completeness (LSP)
The heavy, code-driven check. For each table the PTE inserts, using LSP
(`documentSymbol`, `goToDefinition`, `outgoingCalls`) and `references/data-research-strategy.md`
from `demo-data-orchestrator`:
- Verify **all primary-key fields** are set.
- Verify **all mandatory fields** are set — those guarded by `TestField`, `NotBlank`, or `Error()`
  in the table's `OnInsert`/validation and in the action code paths the script triggers.
- Follow every set field's **`TableRelation`** to confirm the referenced record is also created;
  recurse into those tables (including "seemingly unrelated" ones). **Blocker** on any missing
  related record.
- **Mine the automated tests** (`*-test/Libraries/` `Create*` procedures and `Initialize()`) for the
  same feature — tests routinely create setup records in unrelated tables that the static relation
  trace misses. Any table the tests create but the PTE omits is a **blocker** until proven unneeded.

### Sub-agent 4 — Pedagogical fit
Judge whether the data + script support a **detailed, step-by-step learning video for an end customer
with no prior product knowledge**: enough records to demonstrate the concept (not just one), clear
contrasts for before/after and toggle steps, no confusing leftover or ambiguous state, and naming
that teaches rather than obscures. Mostly **warnings/suggestions**; a state that makes a teaching
step impossible (e.g. nothing to contrast) is a **blocker**.

## Aggregation & verdict

Merge all findings, de-duplicate, sort by severity. Emit:

```json
{ "passed": <true if zero blockers>, "blockers": [...], "warnings": [...], "suggestions": [...] }
```

## Caller contract (blocking fix loop)

The caller (e.g. `create-script`) must:
1. Run this validator after generating the PTE + script.
2. If `passed` is false: apply fixes for the **blockers** (and cheap warnings) to the PTE and/or
   script, then re-run the validator. Repeat up to 3 times.
3. If blockers remain after the retries: report a `failed` result with the blockers as the reason.
4. Carry remaining warnings/suggestions into the result's `gaps`.

## What this skill does NOT do

- Modify continia-banking (read-only) — fixes go to the PTE/script only.
- Compile, deploy, or run the PTE (validation is static + LSP; runtime verification is a separate step).
- Record or generate videos.

> Note: the four sub-agents have not yet been empirically pressure-tested against a real PTE; run a
> baseline before relying on the gate in production (see `superpowers:writing-skills`).
