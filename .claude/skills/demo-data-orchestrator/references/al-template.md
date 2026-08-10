# AL Demo Data Extension Template

Template for generated demo data as a **deployable AL extension folder**. The output is a self-contained extension that can be compiled and published directly to a BC environment. Follow this structure exactly.

## Extension Folder Structure

Write the three files **directly into the PTE output directory the caller gives you**
(the orchestrator passes its absolute path). Produce exactly **one** extension (one
`app.json`); do **NOT** create a nested or feature-named subfolder:

```
<pte-output-dir>/            ← the exact path the caller provided
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
  "name": "Continia Demo Data - <Feature Name>",
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
    },
    {
      "id": "6e549e35-d1b2-4878-a37a-a736c22f35bf",
      "name": "Continia Banking Internal Access",
      "publisher": "Continia Software Partner",
      "version": "1.0.0.0"
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
- **Internal access**: the "Continia Banking Internal Access" dependency is REQUIRED — it is how the PTE reaches `Access = Internal` CTS-* objects. If compilation reports a version mismatch on it, use the version `continia deps` downloaded. Never solve internal access any other way.
- Add additional dependencies if the codeunit references tables from other apps (Import, Export, etc.)
- The `idRanges` 50000-50099 is for demo extensions only — these are outside the Continia reserved ranges

## .vscode/launch.json Template

```json
{
    "version": "0.2.0",
    "configurations": []
}
```

## Install Codeunit Template

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
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    begin
        CreateDemoData();
        VerifyDemoData();
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

    // -------------------------------------------------------------------------
    // Runtime Verification — one check per seeded record
    // -------------------------------------------------------------------------

    /// <summary>
    /// Re-reads every record CreateDemoData() seeded. A missing record aborts
    /// the install with a clear error, which surfaces as a publish failure the
    /// deploy step must fix. Keep this in sync with CreateDemoData().
    /// </summary>
    local procedure VerifyDemoData()
    var
        BankAccountPostingGroup: Record "Bank Account Posting Group";
        BankAccount: Record "Bank Account";
    begin
        if not BankAccountPostingGroup.Get(BankAccPostGroupLbl) then
            Error(MissingRecordErr, BankAccountPostingGroup.TableCaption(), BankAccPostGroupLbl);
        if not BankAccount.Get(BankAccNoLbl) then
            Error(MissingRecordErr, BankAccount.TableCaption(), BankAccNoLbl);
        // ... one check per seeded record, in the same order as CreateDemoData()
    end;

    var
        MissingRecordErr: Label 'Demo data verification failed: %1 "%2" was not created.', Comment = '%1 = table caption, %2 = record key';

    // Repeat this pattern for all entity types. See management-codeunit-catalog.md
    // for which fields to set on each table (use as field reference, not for calling).
}
```

## Rules

### Extension Folder
- **Always output a complete extension folder**, not a loose `.al` file
- **Location:** write the files **directly into the caller-provided PTE output directory** —
  exactly one extension (one `app.json`), no nested or feature-named subfolder
- The extension is self-contained and can be compiled + published independently
- Use the Continia Banking base-application as the primary dependency
- **Generate a real GUID** for `app.json` `id` at creation time: `powershell -Command "[guid]::NewGuid().ToString()"`. A zero GUID causes AL1053 compilation error
- **Match platform/application versions** to `base-application/app.json` — never hardcode

### Object Header
- **Use ID 50000** in the template — this falls in the demo extension range (50000-50099)
- **File name:** Always `InstallDemoData.Codeunit.al`
- **Name format:** `"Continia Demo Data - <Feature Name>"` (e.g., `"Continia Demo Data - Bank Reconciliation"`) — the PTE name must always start with "Continia"
- **`Access = Internal`** — internal to this demo extension
- **`Subtype = Install`** — the pipeline provisions a FRESH environment per work item, so the install trigger always fires on first publish. If the install fails, the app is left uninstalled and republishing re-fires the trigger. Because data creation is idempotent (`if not Get() then Insert` guards), re-installing on an environment where the data already exists is safe.
- **`Permissions`** — declare all `tabledata` permissions explicitly:
  - `RIM` (Read + Insert + Modify) for tables where records are created
  - `RIMD` (Read + Insert + Modify + Delete) for tables that need cleanup before recreation
  - `RM` (Read + Modify) for tables where only existing records are modified
  - List every table the codeunit touches, including tables written to by management codeunits
- **`OnInstallAppPerCompany()`** — the install trigger calls `CreateDemoData()` which orchestrates all sub-procedures
- **`VerifyDemoData()`** — mandatory; one `Get()`/`IsEmpty()` check per seeded record, `Error(MissingRecordErr, ...)` on the first miss. The install trigger calls it after `CreateDemoData()`.
- **launch.json** stays minimal (empty `configurations`) — publishing goes through `continia-deploy`, not VS Code

### Why a Deployable Extension?
- Can be compiled and published directly to any BC environment (DemoPortal, sandbox, CI)
- No need to integrate into the banking-demo app — keeps demo data isolated per feature
- Install trigger fires on first publish to the fresh per-item environment; failed installs leave the app uninstalled so a fixed redeploy re-fires it
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

### Internal Access via Dependency (NOT internalsVisibleTo)
All CTS-CB tables, enums, and codeunits are `Access = Internal`. The PTE gains access by depending on the **"Continia Banking Internal Access"** app (`6e549e35-d1b2-4878-a37a-a736c22f35bf`, publisher "Continia Software Partner") declared in `app.json`. Do **NOT** modify `base-application/app.json` or any other file in the read-only continia-banking repo.

### Symbol Package Prerequisites
The `continia deps` CLI only fetches direct dependencies. For a demo extension to compile:
- **Microsoft Application/System symbols** must be available — copy from the main repo's `.alpackages/`
- **Transitive Continia symbols** (e.g., import, export apps) must also be copied
- Symbols go in the extension's own `.alpackages/` (i.e. `<pte-output-dir>/.alpackages/`) — `continia deps download` writes here
- Match the symbol package versions to the environment's BC version

### Do Not Call banking-demo Management Codeunits
The management codeunits in `banking-demo/General/Codeunits/Management/` are `Access = Internal` with **no `internalsVisibleTo`**. They cannot be called from external extensions. Use `management-codeunit-catalog.md` as a **field reference** (which fields to set on each table), then use direct `Record.Init/Insert` in generated code.
