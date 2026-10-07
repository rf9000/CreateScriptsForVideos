# Data Dependency Research Strategy

How to work out what demo data a feature needs, using the LSP tool (`documentSymbol`,
`workspaceSymbol`, `goToDefinition`, `findReferences`, `outgoingCalls`, `hover`) plus `Grep` and
`Glob` over the read-only continia-banking repo.

Start from the page, not the table: the page shows which fields and actions the viewer sees, and
therefore which data matters.

## Backward trace from the feature page

Input: the target page file(s) from Phase 1, the feature name, and the country context.

### Step 1: SourceTable

Run `documentSymbol` on the page file, or read the `SourceTable = "..."` property. For a page
extension, `goToDefinition` on the base page to find its SourceTable.

### Step 2: Table fields

`goToDefinition` on the SourceTable name, then `documentSymbol` on the table file for fields and
types. `hover` on a Record variable of that type also lists the fields.

Note FlowFields (`CalcFormula`): the tables they sum or count need data for the computed values to
show meaningful numbers. Note `Visible = <condition>` on page fields too; the condition may need
setup data before the field appears.

### Step 3: TableRelation dependencies

Read the table `.al` file and collect every `TableRelation`. For conditional relations
(`if ("Type" = const(Customer)) Customer else if ...`), include every referenced table. Build a
`{ field -> related table }` list.

### Step 4: Classify

| Class | Criteria | Action |
|-------|----------|--------|
| COVERED | Has an entry in `management-codeunit-catalog.md` | Use the catalog entry as a field reference; create with direct `Init`/`Insert` |
| SETUP | Standard BC setup table (General Ledger Setup, Payment Terms, Customer/Vendor/Gen. Bus./VAT Bus. Posting Group, Currency, Country/Region, No. Series) | Skip; the demo company already has it |
| STANDARD-BC | Standard BC master data not in the catalog (e.g. Item) | Direct `Init`/`Insert` |
| CUSTOM | CTS-* table not in the catalog | Direct `Init`/`Insert`; look for a similar pattern in banking-demo |
| COMPLEX | Needs multi-step setup (bank system import, authentication) | Insert minimal records directly in the PTE, modelled on `banking-demo/General/Codeunits/NonLocalized/SetupBankAcc.Codeunit.al`; for baseline demo-company data the PTE cannot reproduce, rely on `banking-demo` being published (`needsBankingDemo: true`) |

### Step 5: Recurse

Repeat Steps 2-4 for COVERED, STANDARD-BC, CUSTOM, and COMPLEX tables. Stop at depth 3, at SETUP
tables, and at tables already in the graph.

### Step 6: Trace action code paths

Table relations only reveal static dependencies. The actions the demo clicks often run validations
that need records no relation points to, and those are what break a demo on camera. For every
action in the flow:

1. `goToDefinition` on the action's `OnAction` trigger to find the procedure it calls.
2. `outgoingCalls` on that procedure, and repeat to depth 2-3.
3. Collect `Error()` calls and their conditions, `TestField()` calls, `if not Rec.Get() then Error()`
   patterns, and interface calls such as `GetAuthenticationSetup()` (follow the implementation).
4. For each, note the record or state it requires and add it to the data map.

Example: the "All Direct" action on Bank Acc. Com. Setup calls `SwitchTransferType` ->
`ValidateTransfer` -> `CheckBankAccComSetupOnBank` -> `AuthenticationEntryIsValid`, which needs
`CTS-CB Bank Per Company Auth` and `CTS-CB Authentication Entry` records. Neither appears in any
TableRelation on the page's source table.

Treat a validation as COMPLEX when it needs secure storage, external API state, or records that
can't be inserted trivially (such as authentication entries with encrypted keys). If neither a
direct insert nor `banking-demo` can satisfy it, choose a flow that avoids that action and record
the limitation in `gaps`.

### Step 7: Mine automated tests

Run this after the trace, as a cross-check and gap-filler (see the next section).

### Step 8: Topological sort

Order tables so dependencies come first: leaf tables, then tables depending only on those, and so
on. This becomes the call order in `CreateDemoData()`.

### Step 9: Design the initial data state

Choose field values so each action produces visible contrast (see "Data state design" below).

### Step 10: Log the data map

Record in the assumptions: tables in creation order with their class, skipped SETUP tables, how
COMPLEX tables were handled, and the chosen initial state with the demo step that drove each
choice. For example:

```
1. Bank Account Posting Group  [COVERED]
2. Bank Account                [COVERED]
3. Vendor / Vendor Bank Account [COVERED]
4. CTS-CB Bank System          [COMPLEX: inserted directly, modelled on SetupBankAcc]
Skipped (SETUP): Payment Terms, Gen. Bus. Posting Group
Initial state: Transfer Type = Manual, so step 4 "All Direct" visibly switches it
```

## Common dependency chains

```
Payment Journal (page 256)
  -> Gen. Journal Line
    -> Vendor -> Vendor Bank Account
    -> Bank Account -> Bank Acc. Posting Group -> G/L Account
    -> Payment Terms, Payment Method (SETUP)

Bank Acc. Reconciliation (page 379)
  -> Bank Acc. Reconciliation -> Bank Account -> Bank Acc. Posting Group -> G/L Account
  -> Bank Acc. Reconciliation Line
    -> CTS-PI Bank Transac. Header/Line (COMPLEX: transaction import)

Payment Register (CTS-CB page)
  -> CTS-CB Payment Register -> Bank Account
  -> CTS-PE Payment Ledger Entry -> Vendor/Customer -> Vendor/Customer Bank Account

Direct Debit Collection
  -> Customer -> Customer Bank Account
  -> SEPA Direct Debit Mandate
  -> Sales Header/Line (open invoices)

Payment Journal with Approval
  -> (Payment Journal chain)
  -> CTS-AW Approval Flow + Flow Lines (COVERED: CreatePmtAppFlows)
  -> User Setup (approver email addresses)
```

## Mine automated tests

Tests for the same feature area have to compile and pass against the real runtime, so their data
setup reflects actual requirements rather than what the schema implies.

**Find relevant tests.** `Grep` in `*-test/**/*.al` for the page name, the source table name, and
the procedure names found during the action trace (e.g. `SwitchTransferType`). `Glob`
`*-test/Libraries/**/*.al` for Library codeunits that create the same tables.

**Read Library `Create*()` procedures.** Library codeunits are named `CTS-{prefix} Library {Domain}`
(e.g. `CTS-CB Library Bank Account`, `CTS-PI Library Bank Recon.`). List procedures with
`documentSymbol` and read the ones that create your tables. Note which fields are set and in what
order, which other `Create*()` calls come first, the sample values used, and any RecordRef use
(which signals table extension fields). These are more reliable field references than the catalog.

**Read test methods.** Given-When-Then maps onto the demo:

| Test section | Demo equivalent | Extract |
|---|---|---|
| Given (`Initialize()` + setup) | PTE data | Required records, field values, setup state |
| When | Demo action steps | Action sequence and parameters |
| Then | Visible result | What changes, for narration and contrast design |

**Cross-reference with the trace.** Add tables that tests create but the trace missed, fields tests
set that the catalog omits, and initialization requirements (e.g.
`SetPaymentImportAdminPermissions()`, `InitializePaymentImportSetup()`), which the PTE must then
replicate. If tests create records in a different order than your sort, look for a runtime
dependency you missed.

**Take sample values.** Prefer test values (country-format IBANs, real bank system codes, realistic
amounts, correct enum identifiers, meaningful codes such as `BANK-DK` rather than `TEST001`) over
invented ones, then adjust for demo impact.

Learn from tests; don't reuse them. Test Library codeunits are internal to the test apps, and test
code relies on isolation and randomization that a PTE doesn't have, so write direct
`Init`/`Insert` code. Test data also tends toward edge cases; make demo data realistic.

## Data state design

The initial state must make every data-changing action visibly change something. Walk the script
steps in order and ask whether the viewer will see a difference after each one; if not, change the
initial state.

| Flow type | Initial state | Why |
|---|---|---|
| Toggle (to A) | Not A | Switching to A is visible |
| Reset to defaults | Customized | The reset visibly changes values |
| Enable records | Some disabled | Enabling them is visible |
| Configure / fill in | Empty or incomplete | Fields visibly get populated |
| Approve / send | Ready, not yet sent | Status visibly transitions |
| Import / receive | No imported data | New records visibly appear |

If several flows share one PTE, list each flow's first action and the state it needs, and find one
state that gives contrast for all. If they conflict (e.g. "All Manual" needs a Direct start while
"Direct with Reset" needs a Manual start), choose the state that suits the more complex flow, order
the flows so the other still shows a change, and log the trade-off.
