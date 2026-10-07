## Stage: generate — video addendum

This item also gets a recorded video. In addition to the script and the PTE, write three files in
the same folder as the recording script file:

1. `recording.yml` — a Business Central Page Scripting recording of the demo, replayed by BC's own
   engine on a fresh environment where the PTE is installed. Use only these step shapes:

   ```yaml
   name: <short name>
   description: <one line>
   start:
     profile: BUSINESS MANAGER
     pageId: 371                           # the demo's first page; the recorder opens it directly
   steps:
     - type: invoke                        # on the start page: no runtimeRef
       target:
         - page: Bank Account List         # AL object name of the page
         - action: Control_New             # BC's standard New action
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
         - field: IBAN                     # AL control name of the field
       value: NL85RABO0347427693
       description: Input <value>NL85RABO0347427693</value> into <caption>IBAN</caption>
     - type: invoke                        # an action declared in AL: its AL name
       target:
         - page: Bank Account Card
           runtimeRef: p2
         - action: SetDefaultCommunication
       description: Invoke <caption>Set Default Communication</caption>
     - type: invoke                        # open the current row of a list
       target:
         - page: CTS-CB Bank Acc. Com. Setup
           runtimeRef: p3
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
   - Start on the page where the demo begins: set `start.pageId` to its page ID and give steps on
     that first page no `runtimeRef`. Do not navigate from the Role Center.
   - Page names, field names and action names are AL object and control names exactly as declared
     in the source you read (quoted names keep their spaces). Never invent a name: if you can't find
     a page's or action's AL source (Microsoft base pages aren't in continia-banking), use only the
     standard controls shown above (`Control_New`, `repeater: Control1`) or start the demo after it.
   - Put the visible caption in `<caption>` in the description.
   - Add a `page-shown` step for every page that opens (including dialogs). If a confirmation dialog
     will appear, include its `page-shown` and the button step.
   - End with `validate` steps for values the viewer is meant to see change, but only values that
     are certain: data the PTE seeds, or values the AL code sets deterministically. Never guess
     values that come from an external service (bank information lookup, exchange rates); a wrong
     guess fails the whole video. If the outcome depends on such a service, validate a field you
     entered or one the code derives from it.

2. `recording.staging.yml` — for each field the recording touches, the caption of the FastTab
   (page group) that contains it, from the AL page source:

   ```yaml
   fieldGroups:
     IBAN: Transfer
   ```

3. `narration.yml` — one short spoken sentence or two per step the viewer should hear about,
   keyed by the step's index in `recording.yml` (0-based), matching the script's "Say:" lines:

   ```yaml
   steps:
     0: Choose New to create a bank account.
     2: Enter the IBAN. Continia Banking looks up the bank and fills in the details.
   ```
