# Data Dependency Research Strategy

Algorithm for tracing what demo data a feature needs, using LSP and codebase analysis.

## Algorithm: Backward Trace from Feature Page

### Input
- Target page file path(s) from Phase 1
- Feature name and country context

### Step 1: Extract SourceTable

Use `documentSymbol` on the page file. The top-level symbol includes the SourceTable reference.

If not visible in the symbol, read the page file and find:
```
SourceTable = "Table Name";
```

For page extensions, find the base page's SourceTable via `goToDefinition`.

### Step 2: Get Table Fields

Navigate to the table definition:
1. `goToDefinition` on the SourceTable name
2. `documentSymbol` on the table file to get all fields with types

OR: `hover` on a Record variable of that type to get the complete field list.

### Step 3: Identify TableRelation Dependencies

Read the table `.al` file. For each field, look for:
```
TableRelation = "Related Table"."Related Field";
```

Build a dependency list:
```
{ FieldName -> RelatedTable }
```

**Common TableRelation patterns:**
```al
TableRelation = "Bank Account";                    // Simple reference
TableRelation = Customer;                          // Simple reference
TableRelation = "G/L Account" where(...);          // Filtered reference
TableRelation = if ("Type" = const(Customer)) Customer  // Conditional
                else if ("Type" = const(Vendor)) Vendor;
```

For conditional TableRelations, include ALL referenced tables.

### Step 4: Classify Dependencies

For each related table, classify it:

| Classification | Criteria | Action |
|---------------|----------|--------|
| **COVERED** | Has a management codeunit entry in the catalog | Use the catalog as a **field reference** (which fields to set), then use direct Record.Init/Insert |
| **SETUP** | Standard BC setup table (General Ledger Setup, Payment Terms, Customer Posting Group, VAT Bus. Posting Group, Gen. Bus. Posting Group, Currency, Country/Region, No. Series) | Skip — assume pre-populated in demo company |
| **STANDARD-BC** | Standard BC master data not in catalog (e.g., Item) | Use direct Record.Init/Insert |
| **CUSTOM** | CTS-* table not in catalog | Use direct Record.Init/Insert; reference similar patterns from banking-demo |
| **COMPLEX** | Requires multi-step setup (bank system import, authentication) | Flag as "complex setup" — reference SetupBankAcc pattern |

### Step 5: Recurse (Max Depth 3)

For COVERED, STANDARD-BC, and CUSTOM tables, repeat Steps 2-4 to find their own dependencies.

**Stop recursion when:**
- Depth reaches 3
- Table is classified as SETUP
- Table is already in the dependency graph (circular reference)

### Step 6: Topological Sort

Order tables so dependencies come first:

1. Tables with no dependencies (SETUP tables, leaf nodes)
2. Tables that depend only on #1
3. Tables that depend on #1 and #2
4. Continue until all tables are ordered

This order becomes the `CreateDemoData()` procedure call sequence.

### Step 7: Present Data Map

Show the user:
```
Required Demo Data for: <Feature Name>

Tables to populate (in creation order):
1. Bank Account Posting Group  [COVERED: BankAccountMgt.InsertBankAccountPostingGroup]
2. Bank Account                [COVERED: BankAccountMgt.InsertBankAccount]
3. Vendor                      [COVERED: VendorMgt.InsertVendor]
4. Vendor Bank Account         [COVERED: VendorMgt.InsertVendorBankAccount]
5. Purchase Header/Line        [COVERED: PurchaseMgt.InsertPurchaseHeaderSimplified]

Skipped (assumed pre-populated):
- Payment Terms, Customer Posting Group, Gen. Bus. Posting Group, ...

Flagged (complex setup):
- CTS-CB Bank System — requires bank system import flow
```

Ask the user to confirm or adjust before generating code.

---

## Common Dependency Chains

### Payment Journal Flow
```
Payment Journal (page 256)
  → Gen. Journal Line
    → Vendor → Vendor Bank Account
    → Bank Account → Bank Acc. Posting Group → G/L Account
    → Payment Terms (SETUP - skip)
    → Payment Method (SETUP - skip)
```

### Bank Account Reconciliation Flow
```
Bank Acc. Reconciliation (page 379)
  → Bank Acc. Reconciliation (table)
    → Bank Account → Bank Acc. Posting Group → G/L Account
  → Bank Acc. Reconciliation Line
    → CTS-PI Bank Transac. Header/Line (COMPLEX - transaction import)
```

### Payment Register / Status Flow
```
Payment Register (CTS-CB page)
  → CTS-CB Payment Register
    → Bank Account
    → CTS-PE Payment Ledger Entry
      → Vendor / Customer
      → Vendor Bank Account / Customer Bank Account
```

### Direct Debit Flow
```
Direct Debit Collection (page)
  → Customer → Customer Bank Account
  → SEPA Direct Debit Mandate
  → Sales Header/Line (for open invoices)
```

### Approval Flow
```
Payment Journal with Approval
  → (same as Payment Journal Flow)
  → CTS-AW Approval Flow + Flow Lines (COVERED: CreatePmtAppFlows)
  → User Setup (email addresses for approvers)
```

---

## Tips for Data Research

1. **Start from the page, not the table.** The page shows what fields are visible and therefore what data matters for the demo.

2. **Check FlowFields.** FlowFields (CalcFormula) indicate related tables that need data for computed values to show meaningful numbers.

3. **Look at page actions.** Some actions require specific data states (e.g., "Send for Approval" needs an approval flow configured).

4. **Check visibility conditions.** Fields with `Visible = SomeCondition` may need setup to make them appear.

5. **Prefer simplified overloads.** When both detailed and simplified Insert procedures exist (e.g., PurchaseMgt), use the simplified one — it inherits values from master data and needs fewer parameters.

6. **Keep data minimal.** Only create records that the demo flow actually touches or displays. A payment journal demo doesn't need 50 vendors — 2-3 is enough.

7. **Verify enum identifiers.** Enum values in AL use identifier names (e.g., `PAIN001`), not display captions (e.g., `pain.001`). Always use `documentSymbol` or read the enum `.al` file to discover the correct AL identifier before using enum values in generated code. Never guess from captions.

8. **Detect table extension fields.** When a field on a standard BC table (e.g., Bank Account) has a field ID in the Continia range (71553575+), it comes from a table extension. These fields cannot be accessed via `Record."Field Name"` in external extensions — use the RecordRef pattern instead (see `al-template.md` → "Accessing Table Extension Fields").

9. **Trace action code paths with LSP (CRITICAL).** TableRelation analysis only finds static data dependencies. Actions triggered during the demo may have **runtime validations** that require additional records not visible from table structure alone.

   For every action the demo will click, use LSP to trace the full code path:
   1. `goToDefinition` on the action's `OnAction` trigger → find the procedure it calls
   2. `outgoingCalls` on that procedure → find what it calls
   3. Repeat depth 2-3, looking for `Error()`, `TestField()`, and validation procedures
   4. For each validation found, identify what records/state it checks

   **Example:** The "All Direct" action on Bank Acc. Com. Setup calls `SwitchTransferType` → `ValidateTransfer` → `CheckBankAccComSetupOnBank` → `AuthenticationEntryIsValid`. This last procedure requires `CTS-CB Bank Per Company Auth` and `CTS-CB Authentication Entry` records — neither of which appears in any TableRelation on the page's source table.

   **What to look for:**
   - `Error()` calls with conditional checks (the condition tells you what data is needed)
   - `TestField()` calls (the field must have a value)
   - Interface method calls like `GetAuthenticationSetup()` (follow the implementation)
   - `if not Record.Get() then Error()` patterns (the record must exist)

   **Flag as COMPLEX** any validation that requires secure storage, external API state, or records that can't be trivially inserted (e.g., authentication entries with encrypted keys).

---

## Mine Automated Tests for Data and Flow Patterns

Automated tests for the same feature area are a rich, battle-tested source of data setup patterns and action flow sequences. Tests must compile and pass against the real runtime, so their data creation code reflects actual requirements — not just what the table schema implies.

### When to Use This

**Always** run this step after the LSP-based dependency trace (Steps 1-6). Tests serve as a cross-reference and gap-filler: they may reveal setup records, initialization steps, or field values that static analysis missed.

### Algorithm

#### Step A: Find Relevant Tests

Search the `*-test/` directories for test codeunits that exercise the target feature. Use multiple search strategies:

1. **Search by page name/caption:** `Grep` for the target page name (e.g., `"Bank Acc. Com. Setup"`) in `*-test/**/*.al`
2. **Search by source table name:** `Grep` for the source table name (e.g., `"CTS-CB Bank Acc. Com. Setup"`) in `*-test/**/*.al`
3. **Search by key action procedures:** `Grep` for procedure names found during action code-path tracing (e.g., `SwitchTransferType`, `ValidateTransfer`)
4. **Search Library folders:** `Glob` for `*-test/Libraries/**/*.al` and check for Library codeunits that create data for the same tables

Record the file paths and codeunit names of all matches.

#### Step B: Read Library Data-Creation Procedures

Library codeunits follow the naming pattern `CTS-{prefix} Library {Domain}` (e.g., `"CTS-CB Library Bank Account"`, `"CTS-PI Library Bank Recon."`). They contain reusable `Create*()` procedures.

For each relevant Library codeunit:
1. Use `documentSymbol` to list all procedures
2. Read the `Create*()` procedures that set up the target tables
3. Note:
   - **Which fields are set** and in what order
   - **Dependency chain**: which other `Create*()` procedures are called first
   - **Default/sample values**: IBANs, bank codes, amounts, enum values used
   - **RecordRef usage**: indicates table extension fields

These procedures are **authoritative field references** — more reliable than the management codeunit catalog because they're validated by the compiler and test runner.

#### Step C: Read Test Methods for Flow Patterns

Test methods follow **Given-When-Then** structure, which maps directly to demo structure:

| Test Section | Demo Equivalent | What to Extract |
|-------------|----------------|-----------------|
| **Given** (Initialize + setup) | Data extension + prerequisites | Required records, field values, setup state |
| **When** (action under test) | Demo action steps | Exact procedure calls, action sequence, parameters |
| **Then** (verification) | Expected visible result | What changes after the action — fields updated, records created, status changed |

For each relevant test method:
1. Read the `Initialize()` procedure — it reveals suite-level setup requirements (permissions, setup records, work date)
2. Read the Given section — it shows the minimal data state needed for the action to succeed
3. Read the When section — it shows the exact action sequence (this is your demo flow)
4. Read the Then section — it shows what visibly changes (useful for narration and visual contrast design)

#### Step D: Cross-Reference with LSP Findings

Compare test-discovered dependencies against the dependency graph built in Steps 1-6:

1. **New tables** found in test setup but missing from the LSP trace → add to the data map
2. **Additional fields** that tests set but weren't in the management codeunit catalog → add to field requirements
3. **Initialization requirements** (e.g., `SetPaymentImportAdminPermissions()`, `InitializePaymentImportSetup()`) → note as prerequisites
4. **Order differences** — if tests create records in a different order than the topological sort, investigate why (there may be a runtime dependency the sort missed)

#### Step E: Extract Sample Values

Library procedures often contain realistic sample values that make better demo data than random or placeholder values:

- **IBANs**: Country-appropriate format (e.g., `DK5000400440116243` for Denmark)
- **Bank codes**: Real bank system codes used in test fixtures
- **Amounts**: Realistic payment amounts (not `0.01` or `999999`)
- **Enum values**: The correct AL identifier (not the display caption)
- **Code fields**: Meaningful codes (e.g., `BANK-DK` not `TEST001`)

Prefer test-sourced sample values over invented ones, as they've been validated against the actual business logic.

### What NOT to Do

- **Don't copy test code verbatim** into the demo data extension. Tests use different patterns (test isolation, randomization, library abstraction layers). Extract the data requirements, not the code structure.
- **Don't depend on test Library codeunits** from the demo data extension. They are `Access = Internal` in test apps. Use the patterns you learn to write direct `Record.Init()/Insert()` code.
- **Don't assume test data is demo-appropriate**. Tests use minimal/edge-case data. Demo data should be realistic and visually meaningful. Use test data as a starting point, then adjust values for demo impact.

---

## Data State Design for Demo Flows

The initial data state is not just about having records — it must be designed so the **viewer sees meaningful changes** when the demo executes. A demo where nothing visibly happens is worse than no demo.

### Core Principle: Every Action Must Produce Visible Contrast

Walk through the demo spec steps sequentially. For each action that changes data, ask: "Will the viewer see something different after this step?" If the answer is no, the initial data state is wrong.

### Patterns

| Demo Flow Type | Initial State Should Be | Why |
|---------------|------------------------|-----|
| **Toggle** (A → B) | State A's opposite (B) | So toggling to A is visible |
| **Reset to defaults** | Customized / non-default | So the reset produces a visible change |
| **Enable records** | Some records disabled | So enabling them is visible |
| **Configure / fill in** | Empty or incomplete | So the viewer sees fields being populated |
| **Approve / send** | Ready but not yet sent | So the action transitions to a new status |
| **Import / receive** | No imported data yet | So the import produces new visible records |

### Multiple Demos Sharing One Data Extension

When multiple demo specs share the same data extension (e.g., "All Manual" and "Direct with Reset" both use the bank-acc-com-setup data):

1. **List the first action of each demo** and what initial state it needs
2. **Find a compatible initial state** — one that creates contrast for all flows
3. **If incompatible** — flag the conflict and consider separate data extensions, or choose the state that works for the more complex demo and note the trade-off

Example: "All Manual" needs Direct initial state (so switching to Manual is visible). "Direct with Reset" needs Manual initial state (so switching to Direct is visible). These are incompatible — pick Manual since the "Direct with Reset" demo is longer and more complex, and the "All Manual" demo can be reordered to run second.

### Presenting Initial State to the User

When presenting the data map (Phase 2 step 8), always include:
- The chosen initial data state values (not just which tables)
- Which demo flow step(s) drove the choice
- Any trade-offs if multiple demos share the data
