## Stage: recording

The demo is ready: the PTE is installed on a running environment and the recording script describes
what the video shows. Turn the recording script into a Business Central Page Scripting recording
that BC's own engine will replay on camera, plus the narration for it. You don't record anything
yourself; you write two files and prove them with the check tool.

### 1. `recording.yml`

Use only these step shapes:

```yaml
name: <short name>
description: <one line>
start:
  profile: BUSINESS MANAGER
  pageId: 371                           # the demo's first page; the recorder opens it directly
steps:
  - type: invoke                        # on the start page: no runtimeRef
    target:
      - page: Bank Account List         # page name exactly as the symbols list it
      - action: Control_New             # built-in New action
    invokeType: New
    description: Invoke <operation>Create new</operation> on <caption>New</caption>
  - type: page-shown                    # after every page that opens
    source:
      page: Bank Account Card
    modal: false
    runtimeId: p2                       # unique id, referenced by later steps
    description: Page <caption>Bank Account Card</caption> was shown.
  - type: input
    target:
      - page: Bank Account Card
        runtimeRef: p2
      - field: IBAN                     # field control name from the symbols
    value: NL85RABO0347427693
    description: Input <value>NL85RABO0347427693</value> into <caption>IBAN</caption>
  - type: invoke                        # an action: its name from the symbols, not its caption
    target:
      - page: Bank Account Card
        runtimeRef: p2
      - action: Action76
    description: Invoke <caption>Statistics</caption>
  - type: invoke                        # open the current row of a list
    target:
      - page: Bank Account List
      - repeater: Control1
    invokeType: Edit
    description: Invoke row on <caption>Control1</caption>
  - type: validate                      # prove the outcome with a value that is certain
    target:
      - page: Bank Account Card
        runtimeRef: p2
      - field: Currency Code
    operation: =
    value: EUR
    description: Validate <caption>Currency Code</caption> <operation>is</operation> <value>EUR</value>
```

Rules:
- **Names come from the symbols, never from memory.** Run the `symbols` tool (see "Recording tools")
  for every page you use and copy page, field, action and repeater names exactly. Captions are
  often different from names (Statistics is `Action76` on the Customer Card) and a page can have
  two actions with the same caption.
- Start on the page where the demo begins: set `start.pageId` (the symbols tool prints the page ID)
  and give steps on that first page no `runtimeRef`. Don't navigate from the Role Center unless
  the Role Center is part of what the video teaches.
- Put the visible caption in `<caption>` in each description.
- Add a `page-shown` step for every page that opens. For a confirmation dialog, add its
  `page-shown` (with `modal: true`) and the button step.
- End with `validate` steps for what the viewer is meant to see change, but only values that are
  certain: data the PTE seeds, or values the recording itself enters. Never guess values an
  external service returns (bank information lookup, exchange rates); a wrong guess fails the video.
- Keep it to the flow the recording script shows; no extra navigation.

### 2. `narration.yml`

One or two short spoken sentences per step the viewer should hear about, keyed by the step's
index in `recording.yml` (0-based), taken from the script's "Say:" lines:

```yaml
steps:
  0: Choose New to create a bank account.
  2: Enter the IBAN. Continia Banking looks up the bank and fills in the details.
```

### 3. Check until it passes

Run the `recording-check` tool after writing `recording.yml`, fix every problem it reports, and
run it again until it prints `recording.yml OK`. It checks step structure and every name against
the symbols, and when clean it writes `recording.staging.yml` (which FastTab holds each field)
itself. Don't finish with a recording that hasn't passed the check.

Result fields:
- `status`: `success` once the check passes, otherwise `failed` with the remaining problems in
  `errorMessage`.
- `notes`: anything a reviewer of the video should know (e.g. a step you left out and why).
