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
   steps:
     - type: navigate                      # Role Center action
       target:
         - page: Business Manager Role Center
         - action: Bank Accounts
       description: Navigate to <caption>Bank Accounts</caption>
     - type: page-shown                    # after every page that opens
       source:
         page: Bank Account List           # AL object name of the page
       modal: false
       runtimeId: p1                       # unique id, referenced by later steps
       description: Page <caption>Bank Accounts</caption> was shown.
     - type: invoke                        # action button, by AL control name
       target:
         - page: Bank Account List
           runtimeRef: p1
         - action: Control_New
       invokeType: New
       description: Invoke <operation>Create new</operation> on <caption>New</caption>
     - type: invoke                        # open the current row of a list
       target:
         - page: Customer List
           runtimeRef: p1
         - repeater: Control1
       invokeType: Edit
       description: Invoke row on <caption>Control1</caption>
     - type: input
       target:
         - page: Bank Account Card
           runtimeRef: p2
         - field: IBAN                     # AL control name of the field
       value: NL85RABO0347427693
       description: Input <value>NL85RABO0347427693</value> into <caption>IBAN</caption>
     - type: validate                      # prove every outcome the video shows
       target:
         - page: Bank Account Card
           runtimeRef: p2
         - field: City
       operation: =
       value: UTRECHT
       description: Validate <caption>City</caption> <operation>is</operation> <value>UTRECHT</value>
   ```

   Rules: page names and action/field/repeater names are the AL object and control names from the
   continia-banking source, never captions; put the visible caption in `<caption>` in the
   description; add a `page-shown` step for every page that opens (including dialogs); end with
   `validate` steps for the values the viewer is meant to see change. If a confirmation dialog will
   appear, include its `page-shown` and the button step.

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
     0: Open the list of bank accounts.
     4: Enter the IBAN. Continia Banking looks up the bank and fills in the details.
   ```
