# Recording-Script Format

The reader is a content creator performing each step live in a browser while narrating. Captions
must match the AL `Caption` property so they can find each element on screen.

## File structure

```markdown
# <Feature Name> — Recording Script

## Overview
One or two sentences on what this demo shows the viewer.

## Before you record (starting state)
- The demo environment is open and you are signed in.
- <data that already exists, e.g. "The demo company has a bank account reconciliation with imported lines">
- <expected starting state, e.g. "Statement lines are in the default fewer-columns mode">

## Starting point
Open page **<Page Caption>** directly: `<bc-url>/?page=<pageId>`
(Card and worksheet pages open in view mode — click **Edit** first if you need to change values.)

## Steps

### 1. <Short action title>
- **Where:** <page / area you are on now>
- **Do:** <the single click or input, naming the exact caption>
- **You'll see:** <what visibly changes>
- **Say:** <optional narration line to speak on camera>

### 2. ...
```

"Before you record" states only what is already true; the pipeline has provisioned the environment,
the PTE, and any demo app, so it never asks the presenter to install or create anything.

## Step rules

- **One UI interaction per step**, so the recorder never has to hold two actions in mind. A dialog or
  StrMenu choice that needs OK is its own step.
- **Captions verbatim**, including any ellipsis (`Change Statement No....`), never the internal
  object or field name. DemoPortal renders English regardless of locale, so write English captions.
- **List rows:** "Click the first (Nth) row" — they click the primary-key link; lists have no Edit
  button.
- **Editing a card or worksheet:** include the step that switches to Edit mode before changing values.
- **Non-promoted actions:** add a step to open the action-bar tab first, then click the action. A
  nested group can need one more click; describe the full path.

  | AL `area()` | Where it appears |
  |---|---|
  | `area(Promoted)` | Directly in the action bar, no tab click |
  | `area(Processing)` | "Home" / "Process" tab |
  | `area(Navigation)` | "Page" / "Navigate" tab |
  | `area(Reporting)` | "Report" tab |
  | `area(Creation)` | "New" tab |

- **Wizards (NavigatePage):** the wizard opens as a dialog the creator can maximize; give each wizard
  page its own steps.
- **Toggle actions:** state the starting state under "Before you record" so the first toggle visibly
  changes something.

## Narration ("Say:")

One brief sentence for UI-only steps (opening a tab, clicking a row); a fuller explanation of what
the feature does and what the viewer sees for the teaching moment. Speak naturally: no "click the
button labeled…", timestamps, or markup.
