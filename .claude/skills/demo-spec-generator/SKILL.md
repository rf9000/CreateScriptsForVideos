---
name: demo-spec-generator
description: Writes a Markdown recording script that a video creator follows step by step to demo a Continia Banking feature in Business Central, derived from the AL source. Use it on its own when the demo data already exists, or through demo-data-orchestrator, which runs steps 4-7 after building the PTE.
---

# Demo Recording-Script Generator

The script is read by a person recording a demo video in a real browser. They find things on screen
by their visible text, so every page, action, and field must be named by its AL `Caption`, and every
step must say where they are, what to do, and what they will see. You get that information by
reading the AL code, mostly through LSP.

The run is unattended: when something is ambiguous, pick the most plausible option and record it as
an assumption in your result rather than asking. The continia-banking repo is read-only (see
`prompts/invariants.md`).

## Output

Write the script to the file path the caller provides. Only when run standalone with no path, use
`demo-specs/<feature-kebab-case>.md` in the working directory.

## Step 1 — Parse the request

Identify the feature to demo, how specific the request is ("merge rules" vs "edit an existing merge
rule"), and any app or country context. If it is vague, demo the happy-path "create new" flow and
note that as an assumption.

## Step 2 — Discover the feature

Find the pages, actions, and fields involved:

- LSP `workspaceSymbol` for pages and actions matching the feature name.
- Grep for captions or keywords, and Glob for `**/*<feature>*.al`, when symbol search finds nothing.
- `documentSymbol` on a page file gives its numeric ID and caption (`Page NNNNN "Caption"`).
- `goToDefinition`, `findReferences`, and `outgoingCalls` trace from an action to the code it runs
  and to the pages it opens.

If the feature exists in several apps, prefer the base `banking` app unless the request names a
country or app, and record the choice. If nothing matches, record what you searched and fall back to
the closest related page.

## Step 3 — Determine the starting page

The recorder opens the starting page directly by URL (`<bc-url>/?page=<pageId>`), which is quicker
and more reliable on camera than BC's search, so the script needs a real numeric page ID.

- Use the starting page ID if the caller gave one.
- Otherwise infer it: for a Card or Document page start from its parent List page (the list whose
  `CardPageId` points at it); start a List page directly; for a NavigatePage wizard use its usual
  entry point, often Assisted Setup (page 1801).

## Step 4 — Map the page structure

For each page in the flow, read the `.al` file (with `documentSymbol` and `hover` to navigate) and
collect what the steps need: field and action captions, which `area()` and nested groups each action
sits in, ToolTips (raw material for narration), `CardPageId`/`DrillDownPageId` for list-to-card
navigation, and visibility conditions on fields and actions.

Where an action sits determines the click path, because BC only shows promoted actions directly in
the action bar. Use the `area()` to action-bar tab mapping in `references/md-format.md`. Page
extensions can add fields and actions; include them and note the source, e.g. _(Extended by:
banking-dk)_.

## Step 5 — Build the recording steps

Follow `references/md-format.md` for the file layout and step rules. A typical sequence to reach and
use an action: click the list row that opens the record, open the action-bar tab if the action is not
promoted, click the action, then fill in fields by caption.

For values the recorder types, use realistic, consistent data that fits the feature and matches what
the PTE seeds (same codes, names, and amounts the script refers to). Use short uppercase codes for
`Code` fields, plausible business names and amounts, valid enum/option captions, and dates relative
to the work date rather than fixed calendar dates, since the environment's work date varies.

## Step 6 — Header and narration

The header gives the title, overview, starting state ("Before you record"), and starting point with
page ID, as laid out in `references/md-format.md`. "Before you record" describes the state the
pipeline has already set up, including the expected starting state of any toggle, so the first
toggle produces a visible change. It never lists chores like installing an app or creating data,
because the pipeline supplies all of that; data the presenter creates on camera belongs in the steps.

Add a "Say:" narration hint where it helps: one short sentence for UI-only steps such as opening a
tab or a row, and a fuller explanation for the feature action itself, the teaching moment. Write it
as natural speech.

## Step 7 — Write the file and report

Write the script to the output path, then report the path, the number of steps, the pages covered,
and any assumptions or gaps.

## Edge cases

- **Wizards (`PageType = NavigatePage`):** walk each wizard step, using the step-visibility variables
  to tell which fields show on which step.
- **Conditional visibility:** prefer elements visible by default; when the flow needs a hidden one,
  state the condition that shows it.
- **Long flows (more than about 15 steps):** split into parts at natural boundaries (setup vs. use,
  or one sub-feature per part) as `## Part N` sections in the same file, and note the split.
- **Uncertain menu structure:** when you can't tell whether a group renders as a submenu, give the
  full click path and add an italic note that it may need adjusting during recording.

This skill does not record video, modify AL source, or handle login.
