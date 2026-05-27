# Recording-Script Markdown Format Reference

This is the authoritative format for the human-readable recording script. The audience is a **content creator recording a demo video**. They read the script and perform each step live in a browser, narrating as they go. Be precise about **where they are**, **what to do**, and **what they should see** — the captions must match the AL `Caption` property exactly so the creator can find them on screen.

## File structure

```markdown
# <Feature Name> — Recording Script

## Overview
One or two sentences describing what this demo shows the viewer.

## Before you record (prerequisites)
- The demo environment is open and you are signed in.
- <data/setup required, e.g. "At least one bank account reconciliation exists with imported lines">
- <expected starting state, e.g. "Statement lines are in the default fewer-columns mode">

## Starting point
Open page **<Page Caption>** directly: `<bc-url>/?page=<pageId>`
(Card/worksheet pages open in read-only view — click **Edit** first if you need to change values.)

## Steps

### 1. <Short action title>
- **Where:** <page / area you are on now>
- **Do:** <the single click or input, naming the exact caption>
- **You'll see:** <what visibly changes>
- **Say:** <optional narration line to speak on camera>

### 2. ...
```

## Step-writing rules

- **One UI interaction per step.** A click, or an input. If an action opens a dialog/StrMenu that needs an OK, that confirmation is its own step.
- **Use exact captions.** Quote the AL `Caption` property verbatim, including any ellipsis (`Change Statement No....`). Never use the internal object/field name.
- **List rows:** "Click the first row" (or Nth) — they click the primary-key link; lists have no Edit button.
- **Action-bar tabs:** Non-promoted actions live under a tab. Tell them to open the tab first, then click the action. Mapping:

  | AL `area()` | Tab to open first | Needs a tab click? |
  |---|---|---|
  | `area(Promoted)` | (in the action bar already) | No |
  | `area(Processing)` | "Home" / "Process" | Yes |
  | `area(Navigation)` | "Page" / "Navigate" | Yes |
  | `area(Reporting)` | "Report" | Yes |
  | `area(Creation)` | "New" | Yes |

- **Wizards (NavigatePage):** Note that the wizard opens as a dialog; the creator can maximize it. Walk each wizard step.
- **Toggle actions:** State the expected starting state in prerequisites so the first toggle produces a visible change.
- **English captions:** DemoPortal renders English regardless of locale — write English text.

## Narration ("Say:") guidance

- UI-only steps (open a tab, click a row): one brief sentence.
- The feature action (the teaching moment): a fuller explanation of what it does and what the viewer sees.
- Speak naturally. No "click the button labeled…", no timestamps, no markup.

## Checklist before submitting

- [ ] Starting point gives a real numeric page ID.
- [ ] Every caption matches the AL `Caption` property exactly (including ellipsis).
- [ ] Non-promoted actions have a preceding "open the tab" step.
- [ ] List navigation says "click the Nth row", not "click Edit".
- [ ] Each step has Where / Do / You'll see (and a Say hint where it helps).
- [ ] Prerequisites list all data, setup, and expected starting/toggle state.
- [ ] Steps that edit fields tell the creator to enter Edit mode first.
- [ ] Dialog/StrMenu selections include the follow-up OK/Cancel step.
