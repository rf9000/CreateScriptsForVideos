# AL Demo Data Extension Template

Template for generated demo data as a **deployable AL extension folder**. The output is a self-contained extension that can be compiled and published directly to a BC environment. Follow this structure exactly.

## Extension Folder Structure

```
demo-specs/data/<feature-kebab-case>/
  .vscode/
    launch.json
  app.json
  InstallDemoData.Codeunit.al
```

Each output is a **complete, deployable extension** — not a loose file. It contains:
1. `app.json` — extension manifest with dependency on Continia Banking
2. `.vscode/launch.json` — minimal VS Code config (empty configurations)
3. `InstallDemoData.Codeunit.al` — Install codeunit that creates demo data on app install

## app.json Template

**Before generating app.json**, run these two commands:
1. Generate a real GUID: `powershell -Command "[guid]::NewGuid().ToString()"`
2. Read `base-application/app.json` to get the current `platform`, `application`, and dependency `version` values

```json
{
  "id": "<GENERATE-REAL-GUID>",
  "name": "Demo Data - <Feature Name>",
  "publisher": "Continia Software",
  "version": "1.0.0.0",
  "runtime": "17.0",
  "target": "Cloud",
  "platform": "<match base-application/app.json>",
  "application": "<match base-application/app.json>",
  "resourceExposurePolicy": {
    "allowDebugging": true,
    "allowDownloadingSource": true,
    "includeSourceInSymbolFile": true,
    "applyToDevExtension": false
  },
  "dependencies": [
    {
      "id": "83461f48-dd16-49ea-b00c-e656830c640f",
      "name": "Continia Banking",
      "publisher": "Continia Software",
      "version": "<match base-application/app.json version>"
    }
  ],
  "idRanges": [
    {
      "from": 50000,
      "to": 50099
    }
  ]
}
```

**Notes:**
- **GUID**: Must be a real GUID — `00000000-0000-0000-0000-000000000000` causes AL1053 compilation error
- **Versions**: Read `base-application/app.json` for current `platform` and `application` values. Hardcoding a mismatched version (e.g., `28.0.0.0` when symbols are v27) causes compilation failure
- Add additional dependencies if the codeunit references tables from other apps (Import, Export, etc.)
- The `idRanges` 50000-50099 is for demo extensions only — these are outside the Continia reserved ranges

## .vscode/launch.json Template

```json
{
    "version": "0.2.0",
    "configurations": []
}
```

## Upgrade Codeunit Template

```al
codeunit 50000 "Demo Data - <Feature Name>"
{
    Access = Internal;
    Permissions =
        tabledata "Bank Account" = RM,
        tabledata "<Table 1>" = RIM,
        tabledata "<Table 2>" = RIM;
        // List ALL tables this codeunit inserts into or modifies.
        // Use RIM for tables where records are created (Read + Insert + Modify).
        // Use RIMD for tables that need cleanup before recreation.
        // Use RM for tables where only existing records are modified.
    Subtype = Upgrade;

    trigger OnUpgradePerCompany()
    begin
        CreateDemoData();
    end;

    // -------------------------------------------------------------------------
    // Data Labels — ALL hardcoded values as Labels (never inline strings)
    // -------------------------------------------------------------------------

    // Bank Accounts
    var
        BankAccNoLbl: Label '<VALUE>', Comment = 'Bank Account No.';
        BankAccNameLbl: Label '<VALUE>', Comment = 'Bank Account Name';
        // ... one Label per parameter value

    // Vendors / Customers (if needed)
    var
        VendorNoLbl: Label '<VALUE>', Comment = 'Vendor No.';
        // ...

    // -------------------------------------------------------------------------
    // Main Entry Point
    // -------------------------------------------------------------------------

    /// <summary>
    /// Creates all demo data required for the <Feature Name> demo.
    /// Calls sub-procedures in dependency order (tables with no deps first).
    /// </summary>
    local procedure CreateDemoData()
    begin
        CreateBankAccountPostingGroups();
        CreateBankAccounts();
        // CreateVendors();
        // CreateVendorBankAccounts();
        // CreatePurchaseDocuments();
        // ... add in topological dependency order
    end;

    // -------------------------------------------------------------------------
    // Sub-Procedures — One per entity type
    // -------------------------------------------------------------------------

    local procedure CreateBankAccountPostingGroups()
    var
        BankAccountPostingGroup: Record "Bank Account Posting Group";
    begin
        if BankAccountPostingGroup.Get(BankAccPostGroupLbl) then
            exit;
        BankAccountPostingGroup.Init();
        BankAccountPostingGroup.Code := BankAccPostGroupLbl;
        BankAccountPostingGroup."G/L Account No." := GLAccountNoLbl;
        BankAccountPostingGroup.Insert();
    end;

    local procedure CreateBankAccounts()
    var
        BankAccount: Record "Bank Account";
    begin
        if BankAccount.Get(BankAccNoLbl) then
            exit;
        BankAccount.Init();
        BankAccount."No." := BankAccNoLbl;
        BankAccount.Name := BankAccNameLbl;
        BankAccount."Search Name" := BankAccSearchNameLbl;
        BankAccount.Address := BankAccAddressLbl;
        BankAccount.City := BankAccCityLbl;
        BankAccount."Bank Account No." := BankAccBankAccountNoLbl;
        BankAccount."Bank Acc. Posting Group" := BankAccPostGroupLbl;
        BankAccount."Currency Code" := BankAccCurrencyCodeLbl;
        BankAccount."Country/Region Code" := BankAccCountryCodeLbl;
        BankAccount."Post Code" := BankAccPostCodeLbl;
        BankAccount."Bank Branch No." := BankAccBranchCodeLbl;
        BankAccount.IBAN := BankAccIBANLbl;
        BankAccount."SWIFT Code" := BankAccSWIFTLbl;
        BankAccount.Insert();
    end;

    // Repeat this pattern for all entity types. See management-codeunit-catalog.md
    // for which fields to set on each table (use as field reference, not for calling).
}
```

## Rules

### Extension Folder
- **Always output a complete extension folder**, not a loose `.al` file
- **Folder name:** `<feature-kebab-case>` under `demo-specs/data/`
- The extension is self-contained and can be compiled + published independently
- Use the Continia Banking base-application as the primary dependency
- **Generate a real GUID** for `app.json` `id` at creation time: `powershell -Command "[guid]::NewGuid().ToString()"`. A zero GUID causes AL1053 compilation error
- **Match platform/application versions** to `base-application/app.json` — never hardcode

### Object Header
- **Use ID 50000** in the template — this falls in the demo extension range (50000-50099)
- **File name:** Always `InstallDemoData.Codeunit.al`
- **Name format:** `"Demo Data - <Feature Name>"` (e.g., `"Demo Data - Bank Reconciliation"`)
- **`Access = Internal`** — internal to this demo extension
- **`Subtype = Upgrade`** — use Upgrade (not Install) so data creation can be forced on every publish via `"forceUpgrade": true` in launch.json. Install triggers only run once and can't be re-triggered without version bumps.
- **`Permissions`** — declare all `tabledata` permissions explicitly:
  - `RIM` (Read + Insert + Modify) for tables where records are created
  - `RIMD` (Read + Insert + Modify + Delete) for tables that need cleanup before recreation
  - `RM` (Read + Modify) for tables where only existing records are modified
  - List every table the codeunit touches, including tables written to by management codeunits
- **`OnUpgradePerCompany()`** — the upgrade trigger calls `CreateDemoData()` which orchestrates all sub-procedures
- **launch.json** must include `"forceUpgrade": true` and `"schemaUpdateMode": "ForceSync"` to ensure the trigger runs on every publish

### Why a Deployable Extension?
- Can be compiled and published directly to any BC environment (DemoPortal, sandbox, CI)
- No need to integrate into the banking-demo app — keeps demo data isolated per feature
- Upgrade trigger with `forceUpgrade: true` creates data reliably on every publish — no version bumping needed
- Can be uninstalled to cleanly remove demo data
- Self-contained: all dependencies declared in app.json

### Labels
- **Every hardcoded value must be a Label** — never inline strings in procedure calls
- **Naming:** `<Entity><Field>Lbl` (e.g., `BankAccNoLbl`, `VendorNameLbl`)
- **Comment:** Always add `Comment = '<description>'`
- Group labels by entity type with section comments

### Country-Aware Sample Values
Use existing localized codeunits as templates for realistic values:

| Country | Reference File |
|---------|---------------|
| DK | `banking-demo/General/Codeunits/DK/CreateBankAccDK.Codeunit.al` |
| DE | `banking-demo/General/Codeunits/DE/CreateBankAccDE.Codeunit.al` |
| W1 (generic) | Use DK as baseline, remove DK-specific values |

**IBAN examples per country:**
- DK: `DK5000400440116243`
- DE: `DE89370400440532013000`
- NL: `NL85RABO0347427693`
- SE: `SE4550000000058398257466`

### Procedure Order
Call sub-procedures in **topological dependency order**:
1. G/L Accounts (if needed)
2. Bank Account Posting Groups
3. Bank Accounts
4. Vendors / Customers
5. Vendor / Customer Bank Accounts
6. Purchase / Sales Documents
7. Journal Lines
8. Feature-specific records (search rules, split rules, etc.)

### Minimal Data
- Only create records the demo flow actually **touches or displays**
- 2-3 records per entity type is usually sufficient
- Cross-entity references must be consistent (vendor No. in purchase header matches the vendor record)

### Direct Insert Pattern (for uncovered tables)
When no management codeunit exists:
```al
local procedure Create<Entity>()
var
    <Record>: Record "<Table Name>";
begin
    if <Record>.Get(<PK Label>) then
        exit;

    <Record>.Init();
    // Set primary key fields first
    <Record>."<PK Field>" := <PK Label>;
    // Set remaining fields
    <Record>."<Field>" := <Field Label>;
    <Record>.Insert();
end;
```

### Complex Setup (flagged tables)
For tables requiring multi-step setup (bank system import, authentication), add a comment block:
```al
// COMPLEX SETUP NOTE: CTS-CB Bank System
// In a live environment, bank systems are imported via CTS-CB Import Setup.
// For demo purposes, we insert minimal records directly.
// See: banking-demo/General/Codeunits/NonLocalized/SetupBankAcc.Codeunit.al
```

### Enum Values — Use AL Identifiers, Not Display Names
Enum values in AL use **identifier names**, not display captions. These often differ significantly:

| Enum | AL Identifier | Display Caption |
|------|--------------|-----------------|
| CTS-CB File Type | `PAIN001` | `pain.001` |
| CTS-CB File Type | `CAMT053` | `camt.053` |

**Always verify** the actual enum definition using `documentSymbol` or by reading the enum `.al` file before using enum values in code. Never guess from the caption.

### Accessing Table Extension Fields (RecordRef Pattern)
Fields defined in **table extensions** (e.g., `CTS-CB Bank Code` on `Bank Account`) cannot be accessed directly via `Record."Field Name"` from external extensions. The compiler resolves the Record type against the Microsoft base symbol, which doesn't include extension fields.

**Use RecordRef with the field number:**
```al
local procedure SetBankCode(var BankAccount: Record "Bank Account"; BankCode: Code[20])
var
    BankAccountRecRef: RecordRef;
    BankCodeFieldRef: FieldRef;
begin
    BankAccountRecRef.GetTable(BankAccount);
    BankCodeFieldRef := BankAccountRecRef.Field(71553575); // CTS-CB Bank Code
    BankCodeFieldRef.Value := BankCode;
    BankAccountRecRef.SetTable(BankAccount);
    BankAccount.Modify();
end;
```

**When to use this:** If a field ID is in the Continia range (71553575+), it's from a table extension. Always use RecordRef for these fields.

### internalsVisibleTo Requirement
All CTS-CB tables, enums, and codeunits are `Access = Internal`. The demo extension's app ID **must** be added to `base-application/app.json` `internalsVisibleTo` array before compiling. After generating the extension:
1. Generate the GUID for the extension's `app.json`
2. Add that GUID to `base-application/app.json` → `internalsVisibleTo`
3. Then compile

### Symbol Package Prerequisites
The `continia deps` CLI only fetches direct dependencies. For a demo extension to compile:
- **Microsoft Application/System symbols** must be available — copy from the main repo's `.alpackages/`
- **Transitive Continia symbols** (e.g., import, export apps) must also be copied
- Use a **shared `.alpackages/`** at the parent folder level (`demo-specs/data/.alpackages/`) rather than per-extension
- Match the symbol package versions to the environment's BC version

### Do Not Call banking-demo Management Codeunits
The management codeunits in `banking-demo/General/Codeunits/Management/` are `Access = Internal` with **no `internalsVisibleTo`**. They cannot be called from external extensions. Use `management-codeunit-catalog.md` as a **field reference** (which fields to set on each table), then use direct `Record.Init/Insert` in generated code.
