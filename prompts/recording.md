## Stage: recording

The demo is ready: the PTE is installed on a running environment and the recording script describes
what the video shows. Turn the recording script into a Business Central Page Scripting recording
that BC's own engine will replay on camera, plus the narration for it. You don't record anything
yourself; you write two files and prove them with the check tool.

### 1. `recording.yml`

Write it fresh from the current recording script. If a `recording.yml` or `narration.yml` from an
earlier run is in the folder, replace it; don't carry over its values.

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
  # Shapes below are from BC's own recorder (spikes/replay-video/recordings/real-banksapi-connect.yml).
  - type: set-current-row               # pick a row in a list part before editing it
    target:
      - page: CTS-CB MultiBankAccAssistSetup
      - part: SetupBankAccountList      # the part control on the host page, from the symbols
      - page: CTS-CB SetupMultiBankAccList   # the part's own page, right after the part
      - repeater: BankAccountList
    targetRecord:
      relative: -6                      # rows to move from the current row (negative = up)
    description: Set current row in <caption>BankAccountList</caption>
  - type: input                         # a field in that row
    target:
      - page: CTS-CB MultiBankAccAssistSetup
      - part: SetupBankAccountList
      - page: CTS-CB SetupMultiBankAccList
      - repeater: BankAccountList
      - field: CommunicationType
    value: Direct                       # option/enum fields take the caption, never a number
    description: Input <value>Direct</value> into <caption>Communication Type</caption>
  - type: invoke                        # a lookup: open it, the list shows, OK picks the current row
    target:
      - page: CTS-CB MultiBankAccAssistSetup
      - field: Bank System
    invokeType: Lookup
    description: Invoke <operation>Open lookup</operation> on <caption>Bank System</caption>
  - type: page-shown
    source:
      page: CTS-CB Bank System Map List
    modal: true
    runtimeId: p3
    description: Page <caption>Bank Systems</caption> was shown.
  - type: invoke
    target:
      - page: CTS-CB Bank System Map List
        runtimeRef: p3
    invokeType: LookupOk
    description: Invoke <operation>Lookup OK</operation> on <caption>Bank Systems</caption>
  - type: page-closed
    source:
      page: CTS-CB Bank System Map List
    runtimeId: p3
    description: Page <caption>Bank Systems</caption> was closed.
  - type: invoke                        # a link field (opens a pop-up on another site)
    target:
      - page: CTS-CB BANKS api Setup
        runtimeRef: p4
      - field: SyncBankAccWithBanksAPILink
    invokeType: DrillDown
    description: Invoke <operation>Drill down</operation> on <caption>Connect Bank Account</caption>
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
- A page the symbols tool lists as a `part` of another page never opens on its own: wizard steps,
  list parts and document lines are shown inside their host page. Give it no `page-shown`; target
  it through the host with `- part: <part name>` followed by `- page: <the part's page>`, as above.
  A wizard's Next keeps the same page.
- Pick a list row with `set-current-row` before acting on it. `relative` counts rows from the row
  that is current when the list opens; work it out from the order the PTE seeds the records in,
  and say in `notes` which row you meant.
- Option and enum fields take the caption shown in their dropdown (e.g. `Fixed Amount`), never a
  number: BC's engine reads a number as a position in the dropdown, which is often not the enum
  ordinal. The symbols tool lists each enum field's captions.
- Mind fields that are editable only for certain values (the symbols tool shows `[editable when:
  ...]`): set the controlling field first, in the same row, then the dependent one.
- When the flow leaves Business Central (an action opens a pop-up on another site, such as a
  bank's login), end the recording with the action that opens it. Nothing after it can be
  replayed. Narrate that step with what happens next, and say in `notes` where it stops. Such a
  recording needs no `validate` step after it.
- Cover the whole flow up to that point: every step of the recording script that happens inside
  Business Central belongs in the recording. Don't stop early.
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
