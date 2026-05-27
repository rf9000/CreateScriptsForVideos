---
name: demo-data-orchestrator
description: "End-to-end orchestrator for demo video preparation: researches data dependencies, generates AL demo data code, and produces YAML demo specs. Use when the user asks to: create a complete demo package, prepare demo data and recording spec, generate demo data for a feature, or orchestrate demo creation. Triggers on: 'demo orchestrator', 'demo package', 'prepare demo', 'demo data and spec', 'full demo', 'demo data'. For YAML-only spec generation without data research, use demo-spec-generator instead."
---

# Demo Data Orchestrator

Coordinates end-to-end demo preparation: researches what data a feature demo needs, generates a deployable AL extension (PTE) that creates data on install, then generates the human-readable Markdown recording script.

**Outputs** (write to the output directories the caller provides; NEVER write into a read-only source repo):
1. Deployable AL extension (PTE) folder → `<pte-output-dir>/` (contains `app.json`, `.vscode/launch.json`, `InstallDemoData.Codeunit.al`)
2. Markdown recording script → `<output-dir>/<feature-kebab-case>.md`

**Relationship to other skills:** The existing `demo-spec-generator` skill remains independently callable for cases where demo data already exists. This orchestrator uses Phase 4 of its workflow by referencing `demo-spec-generator` steps 4-7.

## Workflow

Follow these 5 phases in order.

**Automation mode:** When invoked by an agent or with sufficient arguments (starting page ID, feature context, and data requirements clear from context), run all phases without interactive prompts. Only ask questions when arguments are missing AND inference from context fails. Log assumptions instead of blocking on confirmations.

---

### Phase 1 — Parse & Discover

**Goal:** Identify the feature and its starting page.

This phase is identical to `demo-spec-generator` steps 1-3. Follow those steps exactly:

1. **Parse the request** — Extract feature name, specificity level, app/country context from the user's message. If vague, default to a happy-path flow and state the assumption.

2. **Discover the feature** — Search for matching pages using:
   - `workspaceSymbol` or `find_symbol` — pages matching the feature name
   - `search_for_pattern` — broaden if symbol search returns nothing
   - `Glob` with `**/*<feature>*.al` — fallback file search

   Record for each discovered page: file path, **numeric page ID** (from `documentSymbol`), page caption.

3. **Determine starting page** — Follow `demo-spec-generator` Step 3 resolution order: use argument if provided → infer from context → ask only as last resort. In automation mode, infer and log the assumption.

---

### Phase 2 — Research Data Dependencies

**Goal:** Discover what tables and records must exist for the demo flow to work.

Read `references/data-research-strategy.md` for the full algorithm. Summary:

1. **Extract SourceTable** from the target page(s) using `documentSymbol`.

2. **Get table fields** — Navigate to the table via `goToDefinition`, use `documentSymbol` to enumerate fields with types.

3. **Identify TableRelation dependencies** — Read the table `.al` file. For each field, find `TableRelation = "..."` properties. Build a dependency graph.

4. **Classify dependencies** — Cross-reference against `references/management-codeunit-catalog.md`:
   - **COVERED** — Has a management codeunit entry in the catalog → use the catalog as a **field reference** (which fields to set), then use direct Record.Init/Insert
   - **SETUP** — Standard BC setup table → skip (assume pre-populated in demo company)
   - **CUSTOM** — CTS-* table not in catalog → use direct Record.Init/Insert
   - **COMPLEX** — Requires multi-step setup → flag for manual handling

5. **Recurse** (max depth 3) — For COVERED and CUSTOM tables, repeat steps 2-4 on their own fields.

6. **Trace action code paths (CRITICAL)** — For every action the demo will click, use LSP (`goToDefinition`, `outgoingCalls`) to trace the full call chain depth 2-3. Look for `Error()`, `TestField()`, and validation procedures that require records not visible from table relations. Flag any runtime dependency found this way. See `references/data-research-strategy.md` tip 9 for the full algorithm.

7. **Mine automated tests for data and flow patterns** — Search the `*-test/` apps for tests that exercise the same feature area. See `references/data-research-strategy.md` "Mine Automated Tests" section for the full algorithm. Summary:

   a. **Find relevant tests** — `Grep` for the target page name, source table name, or key action procedure names across `*-test/` directories. Also search `*-test/Libraries/` for Library codeunits that create data for the same tables.

   b. **Read Library data-creation procedures** — Library codeunits (e.g., `CTS-CB Library Bank Account`, `CTS-PI Library Bank Recon.`) contain battle-tested `Create*()` procedures showing exactly which fields to set, in what order, with what dependencies. Use these as authoritative field references — they reflect real runtime requirements, not just table schema.

   c. **Read test methods for flow patterns** — Test methods follow Given-When-Then, which maps to demo setup→action→result. The "Given" section reveals required data state, the "When" section reveals the exact action sequence, and the "Then" section shows what visible result to expect.

   d. **Cross-reference with LSP findings** — Tests may reveal runtime dependencies that the static TableRelation trace and action code-path trace missed (e.g., setup records created in `Initialize()` that are needed but not directly related via TableRelation). Add any newly discovered dependencies to the data map.

   e. **Extract sample values** — Library procedures often use realistic sample values (IBANs, bank codes, amounts) that are more meaningful than generated placeholders.

8. **Topological sort** — Order tables so dependencies come first.

9. **Design initial data state for visual contrast** — Walk through the demo spec steps and determine what data state each step expects. The initial data must be set so that:
   - The **first action produces a visible change** for the viewer (e.g., if the demo clicks "All Direct", data must start in Manual state)
   - **Toggle actions** start in the opposite state of what the action switches to
   - **Reset/restore actions** start in a customized state so the reset is visible
   - **Enable/disable flows** start with some records in the opposite state
   - If multiple demo specs share the same data extension, find an initial state that works for all flows or note conflicts

10. **Present or log data map** — Show discovered tables, their classifications, the creation order, **and the chosen initial data state with reasoning tied to the demo flow**. In interactive mode, ask the user to confirm or adjust before generating code. In automation mode, log the data map as assumptions and proceed.

---

### Phase 3 — Generate Deployable Demo Data Extension

**Goal:** Produce a complete, deployable AL extension folder that creates demo data automatically when installed on a BC environment.

Read `references/al-template.md` for the exact structure. The output is a folder with three files:

1. **`app.json`** — Extension manifest with:
   - Dependency on Continia Banking (`83461f48-dd16-49ea-b00c-e656830c640f`)
   - **Dependency on "Continia Banking Internal Access"** (`6e549e35-d1b2-4878-a37a-a736c22f35bf`, publisher "Continia Software Partner") — this grants the PTE access to the `Access = Internal` CTS-* tables/enums it needs. Do NOT edit base-application to gain internal access.
   - Additional dependencies if referencing tables from other apps (Import, Export, etc.)
   - ID range 50000-50099 (demo extension range)
   - **Real GUID** as `id` — generate via `powershell -Command "[guid]::NewGuid().ToString()"` (zero GUID causes AL1053)
   - **Platform/application versions** matching `base-application/app.json` (never hardcode)

2. **`.vscode/launch.json`** — Minimal VS Code config (empty configurations)

3. **`InstallDemoData.Codeunit.al`** — Install codeunit with:
   - `Access = Internal`
   - `Subtype = Install` — runs automatically on app install
   - `Permissions = tabledata "..." = RIM` — declare ALL table permissions explicitly
   - `OnInstallAppPerCompany()` trigger calls `CreateDemoData()`
   - `CreateDemoData()` is a `local procedure` (only called from the trigger)
   - Object ID 50000 (in the demo extension range)

4. **Name format:** `"Demo Data - <Feature Name>"`

5. **Labels for ALL values** — Every hardcoded value must be a Label with a Comment. Never use inline strings in procedure calls. Group labels by entity type.

6. **Direct Insert for ALL tables** — Use the idempotent `if not Record.Get() then begin Record.Init(); ... Record.Insert(); end;` pattern. Do NOT call banking-demo management codeunits (they are `Access = Internal` with no `internalsVisibleTo`). Reference `management-codeunit-catalog.md` for which fields to set on each table.

7. **Table extension fields** — Fields from table extensions (field IDs in Continia range 71553575+) must use the RecordRef pattern. See `al-template.md` → "Accessing Table Extension Fields".

8. **Enum values** — Always verify enum AL identifiers (e.g., `PAIN001`) vs display captions (e.g., `pain.001`) using `documentSymbol` or reading the `.al` file. Never guess from captions.

9. **Dependency order** — Call sub-procedures in topological order (tables with no deps first).

10. **Country-aware sample values** — Use existing localized codeunits as templates:
    - DK: `banking-demo/General/Codeunits/DK/CreateBankAccDK.Codeunit.al`
    - DE: `banking-demo/General/Codeunits/DE/CreateBankAccDE.Codeunit.al`

11. **Minimal data** — Only create records the demo flow actually touches. 2-3 records per entity type.

12. **Complex setup** — For flagged tables (bank system import, auth), add a comment block explaining the manual steps required. Reference `banking-demo/General/Codeunits/NonLocalized/SetupBankAcc.Codeunit.al`.

13. **Internal access via dependency (NOT internalsVisibleTo).** All CTS-CB tables/enums/codeunits are `Access = Internal`. The PTE gains access by depending on the **"Continia Banking Internal Access"** app (`6e549e35-d1b2-4878-a37a-a736c22f35bf`) declared in `app.json` (see step 1). Do **NOT** modify `base-application/app.json` or any other file in the read-only continia-banking repo.

**Write** the extension folder to the caller-provided PTE output directory with all three files (`app.json`, `.vscode/launch.json`, `InstallDemoData.Codeunit.al`). Never write into the read-only continia-banking repo.

**Present** the generated code to the user for review before proceeding to Phase 4. In automation mode, log a summary of the generated extension and proceed directly.

---

### Phase 4 — Generate the Markdown Recording Script

**Goal:** Produce the human-readable Markdown recording script.

**Follow `demo-spec-generator` steps 4-7 exactly.** Those steps are:

- **Step 4 — Map Page Structure** — Extract captions, action areas, visibility conditions from the AL page files using LSP tools.
- **Step 5 — Build the Recording Steps** — Read `demo-spec-generator/references/md-format.md` for the Markdown format. Assemble numbered steps in order (row clicks, tab clicks, action clicks, field inputs), each with Where / Do / You'll see.
- **Step 6 — Build the Script Header & Narration Hints** — Header with feature name, starting page + ID, overview, prerequisites; plus per-step "Say:" narration hints.
- **Step 7 — Write and Present** — Write the Markdown to the caller-provided output directory as `<feature-kebab-case>.md`.

**Additional prerequisite:** In the script's prerequisites section, add a line noting the demo data extension must be published:
- "The demo-data PTE has been compiled and published to the environment."

---

### Phase 5 — Self-Review (2-3 passes)

**Goal:** Re-examine the generated Markdown script and data extension against the actual AL code to catch gaps, missed steps, and imprecise captions.

Run **2-3 review passes**. Each pass re-reads the generated script and walks through the AL code path again with fresh eyes. Stop early if a pass finds nothing to fix.

#### Pass 1 — Step completeness
For each step in the script, re-read the AL trigger/action it corresponds to and verify:
- **Missing intermediate steps** — Does the action open a dialog, StrMenu, or confirmation that needs extra clicks? Does a drilldown open a subpage that needs a close step?
- **Missing navigation steps** — Are there tab clicks needed before non-promoted actions? Does the page load in view mode but need edit mode?
- **Correct step order** — Walk through the steps as a user would. Does each step make sense given the page state left by the previous step?

#### Pass 2 — Caption and value precision
For each caption and field value in the script, verify against the AL source:
- **Exact caption match** — Re-read the AL `Caption` property. Check for ellipsis, abbreviations, locked captions, HTML entities (`&nbsp;`).
- **Correct page** — Is the page named in each step the one actually visible at that point? (e.g., after a drilldown, name the drilldown page, not the parent)
- **Narration accuracy** — Does each "Say:" hint accurately describe what happens? Does it mention UI elements that actually exist?

#### Pass 3 — Data dependency completeness (if data extension was generated)
Re-trace every action's code path one more time, looking specifically for:
- **Validation calls** (`TestField`, `Error`, `if not ... then Error`) that need records not yet in the data extension
- **Visibility conditions** — Fields or groups with `Visible = SomeCondition` that might not be met
- **State prerequisites** — Record statuses or flags that must be set for the flow to work
- **Test cross-check** — Compare the data extension's table/field coverage against what automated tests create for the same feature. If tests create records that the data extension doesn't, investigate whether they're needed for the demo flow

After each pass, apply fixes directly to the generated files. Log what was changed and why.

---

### Phase 6 — Summary

Present a summary with:

- **File paths** — Both output files with their locations
- **Data created** — Tables populated, approximate record counts per table
- **Pages covered** — Pages in the demo spec flow
- **Review fixes** — What the self-review passes caught and corrected
- **Assumptions** — Any assumptions made during research
- **Gaps** — Tables needing manual setup, conditions not automatically resolvable
- **Complex setup** — Any flagged items requiring manual intervention

---

## What This Skill Does NOT Do

- Record videos or capture the screen
- Generate videos or handle TTS/subtitles
- Modify existing AL source code in the main apps (continia-banking is read-only)
- Handle login/authentication
- Compile or deploy the extension to a BC environment (it generates the folder; compiling and publishing is a separate step)
- Replace the `demo-spec-generator` skill (which remains independently callable)
