# AL Demo Data Extension Template

The PTE is a self-contained extension that the deploy stage compiles and publishes as-is. Write
these files directly into the PTE folder the caller gives you (no subfolder, one `app.json`):

```
<pte-folder>/
  .vscode/launch.json
  app.json
  InstallDemoData.Codeunit.al
```

## app.json

Before writing it, generate the id with `bun -e "console.log(crypto.randomUUID())"` and read
`base-application/app.json` for the `platform`, `application`, and Continia Banking `version`.

```json
{
  "id": "<generated GUID>",
  "name": "Continia Demo Data - <Feature Name>",
  "publisher": "Continia Software",
  "version": "1.0.0.0",
  "runtime": "17.0",
  "target": "Cloud",
  "platform": "<from base-application/app.json>",
  "application": "<from base-application/app.json>",
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
      "version": "<base-application/app.json version>"
    },
    {
      "id": "6e549e35-d1b2-4878-a37a-a736c22f35bf",
      "name": "Continia Banking Internal Access",
      "publisher": "Continia Software Partner",
      "version": "1.0.0.0"
    }
  ],
  "idRanges": [{ "from": 50000, "to": 50099 }]
}
```

- A zero GUID fails compilation with AL1053.
- Versions must match the symbols: hardcoding, say, `28.0.0.0` when the symbols are v27 fails
  compilation.
- The Internal Access dependency is how the PTE reaches `Access = Internal` CTS-* tables, enums,
  and codeunits. If compilation reports a version mismatch on it, use the version that
  `continia deps` downloaded.
- Add a dependency for each other Continia app (Import, Export, ...) whose objects the codeunit
  references. The deploy stage refreshes the PTE's symbols from the environment when it compiles.
- 50000-50099 lies outside the Continia reserved ranges and is used for demo extensions.

## .vscode/launch.json

Keep it minimal; publishing goes through the deploy stage, not VS Code.

```json
{
    "version": "0.2.0",
    "configurations": []
}
```

## InstallDemoData.Codeunit.al

```al
codeunit 50000 "Demo Data - <Feature Name>"
{
    Access = Internal;
    Permissions =
        tabledata "Bank Account Posting Group" = RIM,
        tabledata "Bank Account" = RIM;
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    begin
        CreateDemoData();
        VerifyDemoData();
    end;

    var
        // Bank Account Posting Groups
        BankAccPostGroupLbl: Label '<value>', Comment = 'Bank Account Posting Group code';
        GLAccountNoLbl: Label '<value>', Comment = 'G/L Account No. for the posting group';
        // Bank Accounts
        BankAccNoLbl: Label '<value>', Comment = 'Bank Account No.';
        BankAccNameLbl: Label '<value>', Comment = 'Bank Account Name';
        BankAccIBANLbl: Label '<value>', Comment = 'Bank Account IBAN';
        MissingRecordErr: Label 'Demo data verification failed: %1 "%2" was not created.', Comment = '%1 = table caption, %2 = record key';

    /// <summary>Creates the <Feature Name> demo data, dependencies first.</summary>
    local procedure CreateDemoData()
    begin
        CreateBankAccountPostingGroups();
        CreateBankAccounts();
        // ... remaining entities in topological order
    end;

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
        BankAccount."No." := BankAccNoLbl;   // primary key first
        BankAccount.Name := BankAccNameLbl;
        BankAccount."Bank Acc. Posting Group" := BankAccPostGroupLbl;
        BankAccount.IBAN := BankAccIBANLbl;
        // ... other fields from the catalog or test Library procedures
        BankAccount.Insert();
    end;

    /// <summary>
    /// Re-reads every record CreateDemoData() seeded, in the same order. A missing record
    /// aborts the install, which surfaces as a publish failure instead of an empty demo.
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
    end;
}
```

## Rules and their reasons

**Object header.** ID 50000, file name `InstallDemoData.Codeunit.al`, `Access = Internal`. The
`app.json` name must start with "Continia" (e.g. `"Continia Demo Data - Bank Reconciliation"`)
because the pipeline checks for that prefix.

**Install subtype and idempotency.** The pipeline provisions a fresh environment per work item, so
`OnInstallAppPerCompany()` fires on the first publish. A failed install leaves the app uninstalled
and a republish fires the trigger again, so every insert is guarded with `if Get() then exit` (or
`if not Get() then ... Insert`) to make re-runs safe.

**Permissions.** Declare `tabledata` for every table the codeunit touches: `RIM` where records are
created, `RIMD` where records are deleted before recreation, `RM` where existing records are only
modified.

**VerifyDemoData.** Required. One `Get()` (or `IsEmpty()` for a filtered range) per record
`CreateDemoData()` seeds, raising `MissingRecordErr` on the first miss. Keep it in sync with
`CreateDemoData()`.

**Labels.** Every hardcoded value is a Label with a `Comment`, named `<Entity><Field>Lbl` (e.g.
`BankAccNoLbl`, `VendorNameLbl`) and grouped by entity. Never pass inline strings to procedures.

**Field references, not calls.** The management codeunits in
`banking-demo/General/Codeunits/Management/` are internal to banking-demo, which grants no internal
access to other apps, so the PTE can't call them. Use `management-codeunit-catalog.md` to learn
which fields to set and which side tables they also fill (such as `CTS-CB Bank Information` for a
bank account with an IBAN). Direct assignment skips the codeunits' logic, so if the demo needs
such a side record, insert it yourself and declare it in `Permissions`.

**Procedure order.** Call creators in topological order, typically: G/L Accounts, Bank Account
Posting Groups, Bank Accounts, Vendors/Customers, Vendor/Customer Bank Accounts,
Purchase/Sales Documents, Journal Lines, then feature-specific records (search rules, split rules,
and so on).

**Minimal, consistent data.** Create only records the flow touches or displays, usually 2-3 per
entity. Cross-entity references must agree (the vendor No. on a purchase header matches a seeded
vendor).

**Country-aware values.** Use the localized banking-demo codeunits as templates:
`banking-demo/General/Codeunits/DK/CreateBankAccDK.Codeunit.al` and
`banking-demo/General/Codeunits/DE/CreateBankAccDE.Codeunit.al`. For W1, start from DK and drop
DK-specific values. Example IBANs: DK `DK5000400440116243`, DE `DE89370400440532013000`, NL
`NL85RABO0347427693`, SE `SE4550000000058398257466`.

**Complex setup.** Tables that normally come from a multi-step flow (bank system import,
authentication) are inserted directly with minimal records, modelled on
`banking-demo/General/Codeunits/NonLocalized/SetupBankAcc.Codeunit.al`. A short comment saying the
records stand in for the import flow helps reviewers.

## Enum values: AL identifiers, not captions

Identifiers and captions often differ, and code must use the identifier:

| Enum | Identifier | Caption |
|------|-----------|---------|
| CTS-CB File Type | `PAIN001` | `pain.001` |
| CTS-CB File Type | `CAMT053` | `camt.053` |

Check the enum's `.al` file or `documentSymbol` before using a value.

## Table extension fields: RecordRef

Fields added by a table extension (e.g. `CTS-CB Bank Code` on `Bank Account`) can't be accessed as
`Record."Field Name"` from another extension, because the compiler resolves the `Record` type
against the base table symbol. Fields with IDs in the Continia range (71553575 and up) on standard
tables come from extensions; set them through RecordRef:

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
