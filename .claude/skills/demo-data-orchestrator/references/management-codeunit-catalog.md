# Banking Demo Management Codeunit Catalog

A field reference for the tables the `banking-demo` app populates. Each entry's parameter list
tells you which fields matter for that table. The codeunits are internal to banking-demo, which
grants no internal access to other apps, so the PTE can't call them; write direct
`Init`/`Insert` code that sets the same fields.

Source directory: `banking-demo/General/Codeunits/Management/`. Open the file when you need field
types or the exact assignment logic.

"Upsert" means the procedure inserts or modifies; "skip if exists" means it exits when the record
is already there (the PTE's idempotent pattern). Procedures that use `Validate` pull defaults from
master data, which a direct assignment won't do; set those fields yourself or call `Validate` in
the PTE.

## Bank Account — `CTS-CBAD Bank Account Mgt.` (72281972), `BankAccountMgt.Codeunit.al`

- **InsertBankAccount**(No, Name, SearchName, Address, City, BankAccountNo, PostingGroup,
  CurrencyCode, CountryCode, PostCode, BranchCode, IBAN: Code[34], SWIFT: Code[11], CreditorNo).
  Tables: Bank Account, plus CTS-CB Bank Information (created when an IBAN is given). Upsert.
- **InsertBankAccountPostingGroup**(PostingGroup, GLAccountNo). Table: Bank Account Posting Group.
  Upsert.

## Customer — `CTS-CBAD Customer Mgt.` (72281971), `CustomerMgt.Codeunit.al`

- **InsertCustomer**(No, Name, SearchName, Address, City, CustomerPostingGroup, CurrencyCode,
  PaymentTermsCode, InvoiceDiscCode, CountryRegionCode, PaymentMethodCode, GenBusPostingGroup,
  PostCode, VATBusPostingGroup, PreferredBankAccountCode, ContactType: Text[50], BalAccountNo,
  SkipPayment: Boolean). Table: Customer. Upsert; fires `OnBeforeInsertCustomer`.
- **InsertCustomerBankAccount**(CustomerNo, BankAccountCode, BankName, Name2, Address, Address2,
  City, PostCode, BankBranchNo, BankAccountNo: Text[30], TransitNo, CurrencyCode,
  CountryRegionCode, County, IBAN: Code[50], SWIFTCode, BankClearingCode, VerifyAccount: Boolean).
  Table: Customer Bank Account, plus change log entries when VerifyAccount is true. Upsert.
- **InsertSEPADirectDebitMandate**(MandateID, CustomerNo, CustomerBankAccountCode, ValidFrom,
  ValidTo, DateOfSignature, TypeOfPayment: Option, Blocked, ExpectedNumberOfDebits, DebitCounter,
  NoSeries, Closed, IgnoreExpectedNumberOfDebits). Table: SEPA Direct Debit Mandate. A Text
  overload `Evaluate`s the same values.

## Vendor — `CTS-CBAD Vendor Mgt.` (72281964), `VendorMgt.Codeunit.al`

- **InsertVendor**(No, Name, SearchName, Address, Address2, City, Contact, TerritoryCode,
  VendorPostingGroup, CurrencyCode, PaymentTermsCode, InvoiceDiscCode, CountryRegionCode,
  PayToVendorNo, PaymentMethodCode, ApplicationMethod: Text[50], GenBusPostingGroup, PostCode,
  VATBusPostingGroup, PreferredBankAccountCode, AllowSummarizingPayments: Boolean,
  CompressRemittanceText: Boolean, CostType: Text, BalAccountNo, CreditorNo, PmtRefTemplate,
  SkipPayments: Boolean). Table: Vendor. Skip if exists; fires `OnBeforeInsertVendor`. Three
  shorter overloads exist (Text-based `Evaluate`, and without SkipPayments). CostType is resolved
  from its caption through `CTS-CBAD Field Management`.
- **InsertVendorBankAccount**(VendorNo, BankAccountCode, BankName, Address, City, PostCode,
  PhoneNo, BankBranchNo, BankAccountNo: Text[30], CurrencyCode, CountryRegionCode, County,
  IBAN: Code[50], SWIFTCode, BankClearingCode, BankClearingStandard, VerifyAccount: Boolean).
  Table: Vendor Bank Account, plus change log entries when VerifyAccount is true. Skip if exists.

## G/L Account — `CTS-CBAD G/L Account Mgt.` (72281973), `GLAccountMgt.Codeunit.al`

- **InsertGLAccount**(No, Name, SearchName, AccountType, AccountCategory, IncomeBalance,
  DebitCredit, DirectPosting: Boolean, GenPostingType, GenBusPostingGroup, GenProdPostingGroup,
  VATBusPostingGroup, VATProdPostingGroup, ExchangeRateAdjustment, AccountSubcategoryEntryNo:
  Integer, APIAccountType). Table: G/L Account. Upsert. Enum and option fields arrive as Text and
  are `Evaluate`d; in the PTE, assign the enum identifiers directly.

## Sales documents — `CTS-CBAD Sales Mgt.` (72281942), `SalesMgt.Codeunit.al`

- **InsertSalesHeader**(DocumentType: Enum "Sales Document Type", DocumentNo, CustomerNo,
  PostingDate, ExternalDocumentNo: Code[35], PaymentTermsCode, DueDate, PaymentReference: Code[35],
  PaymentMethodCode, RecipientBankAccount, CreditorNo). Table: Sales Header. Skip if the header or
  a matching Cust. Ledger Entry exists; uses `Validate`.
- **InsertSalesLine**(DocumentType, DocumentNo, LineNo, CustomerNo, Type: Enum "Sales Line Type",
  No, LocationCode, ShipmentDate, Description, Description2, UnitOfMeasure, Quantity, UnitPrice,
  VATPercent, LineDiscountPercent, LineDiscountAmount). Table: Sales Line. Skip if exists; uses
  `Validate`.
- **PostDocuments**(DocumentType, DocNoList: List of [Code[20]]) posts through Sales-Post.

## Purchase documents — `CTS-CBAD Purchase Mgt.` (72281965), `PurchaseMgt.Codeunit.al`

- **InsertPurchaseHeaderSimplified**(DocumentType: Enum "Purchase Document Type", DocumentNo,
  VendorNo, PostingDate, ExternalDocumentNo, PaymentTermsCode, DueDate, PaymentReference,
  PaymentMethodCode, RecipientBankAccount, CreditorNo). Table: Purchase Header. Skip if exists;
  uses `Validate` and inherits the rest from the vendor. Prefer this field set over the DE-style
  `InsertPurchaseHeader` with 50+ parameters.
- **InsertPurchaseLineSimplified**(DocumentType, DocumentNo, LineNo, VendorNo,
  Type: Enum "Purchase Line Type", No, LocationCode, ShipmentDate, Description, Description2,
  UnitOfMeasure, Quantity, UnitPrice, VATPercent, LineDiscountPercent, LineDiscountAmount,
  EnableDirectUnitCostValidation: Boolean). Table: Purchase Line. Skip if exists; uses `Validate`.
- **PostDocuments**(DocumentType, DocNoList) releases, then posts each document.

## General journal lines — `CTS-CBAD Journal Line Mgt.` (72281945), `JournalLineMgt.Codeunit.al`

- **InsertGeneralJournalLine**(JournalTemplateName, JournalBatchName, LineNo, AccountType: Text,
  AccountNo, PostingDate, DocumentType: Text, DocumentNo, Description, BalAccountNo, Amount,
  DebitAmount, CreditAmount, AmountLCY, ... 50+ more). Table: Gen. Journal Line. Skip if the line
  or a matching ledger entry exists; assigns fields directly. Read the file and pick only the
  fields your journal lines need.

## Bank transactions — `CTS-CBAD Transaction Data Mgt.` (72281967), `TransactionDataMgt.Codeunit.al`

- **CreateAccStmntTransactions**(var BankAccount). Tables: CTS-PI Bank Transac. Header, Line, and
  Dtl. Creates the header, lines from the `CTS-CBAD Export Data` table, then fixed DK transactions,
  and calculates balances.
- **CreateTransactions**(var BankAccount) creates CAMT.054-style transactions.

These are multi-step operations that depend on Export Data records and DK localized data, so treat
the tables as COMPLEX: insert a minimal header and lines directly, or rely on `banking-demo`.

## Approval flows — `CTS-CBAD Create Pmt.App.Flow` (72281948), `CreatePmtAppFlow.Codeunit.al`

- **CreatePmtAppFlows**(ApprovalFlowCode: Code[10], FlowDescription: Text[50],
  SendAppRequestTo: Text[30], RequiredNoOfApproves: Integer,
  UserDictionary: Dictionary of [Text[50], Text[100]]). Tables: CTS-AW Approval Flow, CTS-AW
  Approval Flow Line, User Setup, CTS-CB Payment Journal Setup. Creates the flow, one line per user,
  sets the user's email in User Setup, and creates and assigns the workflow.

## G/L Setup — `CTS-CBAD G/L Setup Mgt.` (72281974), `GLSetupMgt.Codeunit.al`

- **UpdateGLSetup**(PmtDiscGracePeriod: Text, MaxPmtToleranceAmtText: Text). Modifies the
  existing General Ledger Setup record.

## Utility codeunits

- `CTS-CBAD Create BankAccChgLog` (72281961) writes bank account change log entries; the customer
  and vendor codeunits call it when VerifyAccount is true.
- `CTS-CBAD Field Management` (72281968) resolves enum values from captions.

## Tables without a management codeunit

| Table | Model on |
|-------|----------|
| CTS-PI Search Rule | `banking-demo/General/Codeunits/NonLocalized/CreateSearchRules.Codeunit.al` |
| CTS-PI Split Rule Header / Line | `banking-demo/General/Codeunits/NonLocalized/CreateSplitRules.Codeunit.al` |
| CTS-CB Payment Journal Setup | `banking-demo/General/Codeunits/DK/CreatePJnlSetupDK.Codeunit.al` |
| CTS-CB Bank System / Bank Setup | `banking-demo/General/Codeunits/NonLocalized/SetupBankAcc.Codeunit.al` (normally an import flow; COMPLEX) |
| Payment Terms, Customer Posting Group, other BC setup | None; SETUP tables already exist in the demo company |
