---
name: demo-spec-generator
description: "Generate a human-readable Markdown recording script for a video content creator from AL codebase knowledge. Use when the user asks to: create a recording script, produce a demo script, generate step-by-step UI instructions, or document how to demo a Continia Banking feature. Triggers on: 'recording script', 'demo script', 'video script', 'demo-spec', 'script for video'."
---

# Demo Recording-Script Generator

Generate a **human-readable Markdown recording script** by navigating the AL codebase with LSP/Serena tools. The script is followed by a human content creator while recording a demo video — it tells them exactly where they are in Business Central, what to click, what to type, and what they will see.

**Output:** Single Markdown file → `<output-dir>/<feature-kebab-case>.md` (the caller provides the output directory; default `demo-specs/` only when run standalone — NEVER write into a read-only source repo).

**Key constraint:** A human follows this script in a real browser, navigating by the **exact visible text** of pages, actions, and fields (the AL `Caption` property). Direct-URL navigation (`?page=<id>`) replaces BC's search popup, so always give the page ID for the starting point.

## Workflow

Follow these 7 steps in order.

**Automation mode:** When invoked by an agent or with sufficient arguments (starting page ID provided, feature context clear), run all steps without interactive prompts. Only ask questions when arguments are missing AND inference from context fails.

### Step 1 — Parse the Request

Extract from the user's message:
- **Feature name** — the AL feature to demo
- **Specificity level** — vague ("merge rules") vs specific ("edit an existing merge rule")
- **App/country context** — if mentioned

If vague, default to a happy-path "create new" flow. State the assumption.

### Step 2 — Discover the Feature

Search for pages, actions, and fields matching the feature name:

1. `workspaceSymbol` or `find_symbol` — search for pages matching the feature name
2. `search_for_pattern` — broaden if symbol search returns nothing
3. `Glob` with `**/*<feature>*.al` — fallback file search

**Disambiguation rules:**
- Found in multiple apps → ask user which one
- Not found → report what was searched, ask for alternative names
- Found exactly → proceed, confirm with user which page(s) are involved

Record for each discovered page: file path, **numeric page ID** (from `documentSymbol`), page caption.

### Step 3 — Determine Starting Page

The generator navigates directly via URL (`?page=<pageId>`). Search/Tell Me does NOT work.

**Resolution order:**
1. **Argument provided** — If the caller specified a starting page ID, use it directly.
2. **Infer from context** — If the feature page is a Card/Document, use its parent List page. If it's a List page, use it directly. If it's a NavigatePage (wizard), check if it's typically launched from Assisted Setup (page 1801) or another entry point.
3. **Ask the user** — Only if the above steps don't yield a clear answer. Present the discovered pages and ask which one to start on.

When running in automation mode (called by an agent), never block on a question — use inference (option 2) and document the assumption.

### Step 4 — Map Page Structure

For each page in the flow, extract:

| Data Point | Tool | Notes |
|------------|------|-------|
| Page caption + **numeric ID** | `documentSymbol` | Top-level symbol gives `Page NNNNN "Caption"` |
| Field captions (from `Caption` property) | `documentSymbol` + `hover` | Use `Caption`, not field name |
| Action captions (from `Caption` property) | `documentSymbol` + read `.al` | **Exact text including ellipsis** |
| Action area placement | Read the `.al` file | Which `area()` the action lives in — determines if tab click is needed |
| Action group nesting | Read the `.al` file | Nested groups may need additional click steps |
| ToolTips | Read the `.al` file | For synthesizing narration |
| CardPageId / DrillDownPageId | Read the `.al` file | For list → card navigation |
| Visibility conditions | Read the `.al` file | Note toggle states for prerequisites |

**Action menu structure is critical.** Determine the click path:

| AL `area()` | BC tab name | Tab click needed? |
|---|---|---|
| `area(Promoted)` | Directly in action bar | **No** — single step |
| `area(Processing)` | "Home" or "Process" | Yes |
| `area(Navigation)` | "Page" or "Navigate" | Yes |
| `area(Reporting)` | "Report" | Yes |
| `area(Creation)` | "New" | Yes |

### Step 5 — Build the Recording Steps

Read the Markdown format reference: `references/md-format.md`

Each step is a numbered instruction written for a person. Every step states **where they are**, **what to do**, and **what they should see**. One UI interaction per step.

**Critical constraints (for accurate UI pointers):**
- Give the **starting page ID** so the recorder can open it directly (`<bc-url>/?page=<pageId>`) instead of searching.
- List rows: tell them to **click the Nth row** (1-indexed) by its primary-key link — there is no "Edit" button on a list.
- Non-promoted actions need a **tab-click step first** (tell them to open the area tab, then click the action).
- Nested action groups may need an extra click — describe the full path.
- Use the **exact visible caption** from the AL `Caption` property (include ellipsis if present).
- DemoPortal renders English captions regardless of locale — write English text.

**Step assembly order:**

1. **Click the list row** that opens the record
2. **Open the action-bar tab** the action lives under (e.g., "Page", "Process") — only if the action is not promoted
3. **Click the action** by its caption
4. **Type the value** into the field (by its caption)

**Sample value generation rules:**

| AL Field Type | Sample Value Strategy |
|---------------|----------------------|
| `Code[N]` | Short uppercase codes (e.g., `BANK-001`) |
| `Text[N]` | Descriptive names from context |
| `Decimal` | Realistic amounts (e.g., `10000.00`) |
| `Boolean` | Typical usage default |
| `Enum` | First/most common value from `documentSymbol` |
| `Option` | Use OptionCaption values |
| `Date` | Concrete dates (e.g., `01-01-2025`) |

### Step 6 — Build the Script Header & Narration Hints

The script opens with a header section the recorder reads before starting:

| Section | Source |
|---------|--------|
| Title | Feature name, title-cased |
| Starting point | Page caption + **page ID** (so they can open it directly) |
| App | Monorepo folder name |
| Overview | 1-2 sentences on what the demo shows |
| Prerequisites | All data, setup, AND expected toggle/state (e.g., "Statement lines start in fewer-columns mode") |

Each step may include a **narration hint** — a natural sentence the recorder can say while performing the step:

| Step type | Style |
|-----------|-------|
| UI-only (menu/tab click) | Brief, 1 sentence |
| Row click (opening record) | Brief context |
| Feature action (the teaching moment) | Detailed — what it does + what the viewer sees |

Write narration naturally, as if speaking on camera. No markup, no timestamps, no "click on the button labeled...".

### Step 7 — Write and Present

1. Write the Markdown file to `<output-dir>/<feature-kebab-case>.md` (use the output directory the caller provided; never write into a read-only source repo).
2. Present a summary:
   - File path written
   - Number of steps generated
   - Pages covered
   - Any assumptions or gaps

## Edge Cases

### Wizard Flows (NavigatePage)
Detect `PageType = NavigatePage`. Generate steps per wizard step using visibility patterns.

### Page Extensions
Include extended fields/actions. Add a parenthetical note: _(Extended by: banking-dk)_.

### Conditional Visibility
Favor default-visible elements. Note conditions for non-default elements.

### Large Flows (>15 steps)
Suggest splitting into multiple script files. Ask user how to split.

### Uncertain Menu Structure
When unsure if a group renders as a submenu, describe the full click path and add an italic note that it may need adjustment when recording.

## What This Skill Does NOT Do

- Record videos or capture the screen
- Generate videos or handle TTS/subtitles/cursor animation
- Modify AL source code
- Handle login/authentication
