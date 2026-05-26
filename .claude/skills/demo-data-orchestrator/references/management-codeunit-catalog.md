# Banking Demo Management Codeunit Catalog

> **⚠️ DO NOT CALL these codeunits directly from generated demo extensions.** They are `Access = Internal` in the `banking-demo` app, which has no `internalsVisibleTo`. Use this catalog as a **field reference** — it tells you which fields to set on each table — then use direct `Record.Init/Insert` in generated code.

**Source directory:** `banking-demo/General/Codeunits/Management/`

---

## Bank Account

**Codeunit:** `CTS-CBAD Bank Account Mgt.` (72281972)
**File:** `banking-demo/General/Codeunits/Management/BankAccountMgt.Codeunit.al`

### InsertBankAccount
```
InsertBankAccount(
    No: Code[20];
    Name: Text[100];
    SearchName: Text[100];
    Address: Text[100];
    City: Text[30];
    BankAccountNo: Code[20];
    PostingGroup: Code[20];
    CurrencyCode: Code[10];
    CountryCode: Code[10];
    PostCode: Code[20];
    BranchCode: Code[20];
    IBAN: Code[34];
    SWIFT: Code[11];
    CreditorNo: Code[20]
)
```
**Tables:** Bank Account, CTS-CB Bank Information (auto-created when IBAN provided)
**Pattern:** Upsert (Insert or Modify)

### InsertBankAccountPostingGroup
```
InsertBankAccountPostingGroup(
    PostingGroup: Code[20];
    GLAccountNo: Code[20]
)
```
**Table:** Bank Account Posting Group
**Pattern:** Upsert

---

## Customer

**Codeunit:** `CTS-CBAD Customer Mgt.` (72281971)
**File:** `banking-demo/General/Codeunits/Management/CustomerMgt.Codeunit.al`

### InsertCustomer
```
InsertCustomer(
    No: Code[20];
    Name: Text[100];
    SearchName: Text[100];
    Address: Text[100];
    City: Text[30];
    CustomerPostingGroup: Code[20];
    CurrencyCode: Code[10];
    PaymentTermsCode: Code[10];
    InvoiceDiscCode: Code[20];
    CountryRegionCode: Code[10];
    PaymentMethodCode: Code[10];
    GenBusPostingGroup: Code[20];
    PostCode: Code[20];
    VATBusPostingGroup: Code[20];
    PreferredBankAccountCode: Code[20];
    ContactType: Text[50];
    BalAccountNo: Code[20];
    SkipPayment: Boolean
)
```
**Table:** Customer
**Pattern:** Upsert, fires OnBeforeInsertCustomer event

### InsertCustomerBankAccount
```
InsertCustomerBankAccount(
    CustomerNo: Code[20];
    BankAccountCode: Code[20];
    BankName: Text[100];
    Name2: Text[50];
    Address: Text[100];
    Address2: Text[50];
    City: Text[30];
    PostCode: Code[20];
    BankBranchNo: Code[20];
    BankAccountNo: Text[30];
    TransitNo: Text[20];
    CurrencyCode: Code[10];
    CountryRegionCode: Code[10];
    County: Text[30];
    IBAN: Code[50];
    SWIFTCode: Code[20];
    BankClearingCode: Text[50];
    VerifyAccount: Boolean
)
```
**Table:** Customer Bank Account (+ change log entries if VerifyAccount = true)
**Pattern:** Upsert

### InsertSEPADirectDebitMandate (typed overload)
```
InsertSEPADirectDebitMandate(
    MandateID: Code[20];
    CustomerNo: Code[20];
    CustomerBankAccountCode: Code[20];
    ValidFrom: Date;
    ValidTo: Date;
    DateOfSignature: Date;
    TypeOfPayment: Option;
    Blocked: Boolean;
    ExpectedNumberOfDebits: Integer;
    DebitCounter: Integer;
    NoSeries: Code[20];
    Closed: Boolean;
    IgnoreExpectedNumberOfDebits: Boolean
)
```
**Table:** SEPA Direct Debit Mandate
**Note:** Also has a Text-parameter overload that Evaluate()s the values

---

## Vendor

**Codeunit:** `CTS-CBAD Vendor Mgt.` (72281964)
**File:** `banking-demo/General/Codeunits/Management/VendorMgt.Codeunit.al`

### InsertVendor (full overload)
```
InsertVendor(
    No: Code[20];
    Name: Text[100];
    SearchName: Text[100];
    Address: Text[100];
    Address2: Text[50];
    City: Text[30];
    Contact: Text[50];
    TerritoryCode: Code[10];
    VendorPostingGroup: Code[20];
    CurrencyCode: Code[10];
    PaymentTermsCode: Code[10];
    InvoiceDiscCode: Code[20];
    CountryRegionCode: Code[10];
    PayToVendorNo: Code[20];
    PaymentMethodCode: Code[10];
    ApplicationMethod: Text[50];
    GenBusPostingGroup: Code[20];
    PostCode: Code[20];
    VATBusPostingGroup: Code[20];
    PreferredBankAccountCode: Code[20];
    AllowSummarizingPayments: Boolean;
    CompressRemittanceText: Boolean;
    CostType: Text;
    BalAccountNo: Code[20];
    CreditorNo: Code[20];
    PmtRefTemplate: Code[20];
    SkipPayments: Boolean
)
```
**Table:** Vendor
**Pattern:** Skip if exists (Get then exit), fires OnBeforeInsertVendor event
**Note:** Has 3 overload variants with fewer parameters (Text-based Evaluate and without SkipPayments)

### InsertVendorBankAccount
```
InsertVendorBankAccount(
    VendorNo: Code[20];
    BankAccountCode: Code[20];
    BankName: Text[100];
    Address: Text[100];
    City: Text[30];
    PostCode: Code[20];
    PhoneNo: Text[30];
    BankBranchNo: Code[20];
    BankAccountNo: Text[30];
    CurrencyCode: Code[10];
    CountryRegionCode: Code[10];
    County: Text[30];
    IBAN: Code[50];
    SWIFTCode: Code[20];
    BankClearingCode: Text[50];
    BankClearingStandard: Text[50];
    VerifyAccount: Boolean
)
```
**Table:** Vendor Bank Account (+ change log entries if VerifyAccount = true)
**Pattern:** Skip if exists

---

## G/L Account

**Codeunit:** `CTS-CBAD G/L Account Mgt.` (72281973)
**File:** `banking-demo/General/Codeunits/Management/GLAccountMgt.Codeunit.al`

### InsertGLAccount
```
InsertGLAccount(
    No: Code[20];
    Name: Text[100];
    SearchName: Text[100];
    AccountType: Text[50];
    AccountCategory: Text[50];
    IncomeBalance: Text[50];
    DebitCredit: Text[50];
    DirectPosting: Boolean;
    GenPostingType: Text[50];
    GenBusPostingGroup: Code[20];
    GenProdPostingGroup: Code[20];
    VATBusPostingGroup: Code[20];
    VATProdPostingGroup: Code[20];
    ExchangeRateAdjustment: Text[50];
    AccountSubcategoryEntryNo: Integer;
    APIAccountType: Text[50]
)
```
**Table:** G/L Account
**Pattern:** Upsert
**Note:** Uses Evaluate() for enum/option fields (AccountType, AccountCategory, etc.)

---

## Sales Documents

**Codeunit:** `CTS-CBAD Sales Mgt.` (72281942)
**File:** `banking-demo/General/Codeunits/Management/SalesMgt.Codeunit.al`

### InsertSalesHeader (typed overload)
```
InsertSalesHeader(
    DocumentType: Enum "Sales Document Type";
    DocumentNo: Code[20];
    CustomerNo: Code[20];
    PostingDate: Date;
    ExternalDocumentNo: Code[35];
    PaymentTermsCode: Code[10];
    DueDate: Date;
    PaymentReference: Code[35];
    PaymentMethodCode: Code[10];
    RecipientBankAccount: Code[20];
    CreditorNo: Code[20]
)
```
**Table:** Sales Header
**Pattern:** Skip if exists or if matching Cust. Ledger Entry exists. Uses Validate.

### InsertSalesLine (typed overload)
```
InsertSalesLine(
    DocumentType: Enum "Sales Document Type";
    DocumentNo: Code[20];
    LineNo: Integer;
    CustomerNo: Code[20];
    Type: Enum "Sales Line Type";
    No: Code[20];
    LocationCode: Code[10];
    ShipmentDate: Date;
    Description: Text[100];
    Description2: Text[50];
    UnitOfMeasure: Code[10];
    Quantity: Decimal;
    UnitPrice: Decimal;
    VATPercent: Decimal;
    LineDiscountPercent: Decimal;
    LineDiscountAmount: Decimal
)
```
**Table:** Sales Line
**Pattern:** Skip if exists. Uses Validate.

### PostDocuments
```
PostDocuments(
    DocumentType: Enum "Sales Document Type";
    DocNoList: List of [Code[20]]
)
```
Posts all documents in the list using Sales-Post codeunit.

---

## Purchase Documents

**Codeunit:** `CTS-CBAD Purchase Mgt.` (72281965)
**File:** `banking-demo/General/Codeunits/Management/PurchaseMgt.Codeunit.al`

### InsertPurchaseHeaderSimplified (typed overload, recommended for generated code)
```
InsertPurchaseHeaderSimplified(
    DocumentType: Enum "Purchase Document Type";
    DocumentNo: Code[20];
    VendorNo: Code[20];
    PostingDate: Date;
    ExternalDocumentNo: Code[35];
    PaymentTermsCode: Code[10];
    DueDate: Date;
    PaymentReference: Code[35];
    PaymentMethodCode: Code[10];
    RecipientBankAccount: Code[20];
    CreditorNo: Code[20]
)
```
**Table:** Purchase Header
**Pattern:** Skip if exists. Uses Validate. Inherits values from vendor master data.
**Note:** Also has a full DE-style `InsertPurchaseHeader` with 50+ parameters (avoid for generated code).

### InsertPurchaseLineSimplified (typed overload, recommended for generated code)
```
InsertPurchaseLineSimplified(
    DocumentType: Enum "Purchase Document Type";
    DocumentNo: Code[20];
    LineNo: Integer;
    VendorNo: Code[20];
    Type: Enum "Purchase Line Type";
    No: Code[20];
    LocationCode: Code[10];
    ShipmentDate: Date;
    Description: Text[100];
    Description2: Text[50];
    UnitOfMeasure: Code[10];
    Quantity: Decimal;
    UnitPrice: Decimal;
    VATPercent: Decimal;
    LineDiscountPercent: Decimal;
    LineDiscountAmount: Decimal;
    EnableDirectUnitCostValidation: Boolean
)
```
**Table:** Purchase Line
**Pattern:** Skip if exists. Uses Validate.

### PostDocuments
```
PostDocuments(
    DocumentType: Enum "Purchase Document Type";
    DocNoList: List of [Code[20]]
)
```
Posts all documents in the list. Sets status to Released before posting.

---

## General Journal Lines

**Codeunit:** `CTS-CBAD Journal Line Mgt.` (72281945)
**File:** `banking-demo/General/Codeunits/Management/JournalLineMgt.Codeunit.al`

### InsertGeneralJournalLine
```
InsertGeneralJournalLine(
    JournalTemplateName: Code[10];
    JournalBatchName: Code[10];
    LineNo: Integer;
    AccountType: Text[50];
    AccountNo: Code[20];
    PostingDate: Date;
    DocumentType: Text[50];
    DocumentNo: Code[20];
    Description: Text[100];
    BalAccountNo: Code[20];
    Amount: Decimal;
    DebitAmount: Decimal;
    CreditAmount: Decimal;
    AmountLCY: Decimal;
    ... (50+ additional parameters)
)
```
**Table:** Gen. Journal Line
**Pattern:** Skip if exists or if matching ledger entry exists. Direct field assignment.
**Note:** Very large parameter list. Best used for detailed journal line creation only.

---

## Bank Account Transactions

**Codeunit:** `CTS-CBAD Transaction Data Mgt.` (72281967)
**File:** `banking-demo/General/Codeunits/Management/TransactionDataMgt.Codeunit.al`

### CreateAccStmntTransactions
```
CreateAccStmntTransactions(var BankAccount: Record "Bank Account")
```
**Tables:** CTS-PI Bank Transac. Header, CTS-PI Bank Transac. Line, CTS-PI Bank Transac. Dtl.
**Pattern:** Creates header, then transaction lines from CTS-CBAD Export Data table, then fixed transactions from DK data. Calculates balances.

### CreateTransactions
```
CreateTransactions(var BankAccount: Record "Bank Account")
```
Creates CAMT.054-style transaction records.

**Note:** These procedures depend on existing Export Data records and localized data (DK). They are complex multi-step operations, not simple inserts.

---

## Approval Flows

**Codeunit:** `CTS-CBAD Create Pmt.App.Flow` (72281948)
**File:** `banking-demo/General/Codeunits/Management/CreatePmtAppFlow.Codeunit.al`

### CreatePmtAppFlows
```
CreatePmtAppFlows(
    ApprovalFlowCode: Code[10];
    FlowDescription: Text[50];
    SendAppRequestTo: Text[30];
    RequiredNoOfApproves: Integer;
    UserDictionary: Dictionary of [Text[50], Text[100]]
)
```
**Tables:** CTS-AW Approval Flow, CTS-AW Approval Flow Line, User Setup, CTS-CB Payment Journal Setup
**Pattern:** Creates flow, flow lines per user, sets email on user setup, creates and assigns workflow.

---

## G/L Setup

**Codeunit:** `CTS-CBAD G/L Setup Mgt.` (72281974)
**File:** `banking-demo/General/Codeunits/Management/GLSetupMgt.Codeunit.al`

### UpdateGLSetup
```
UpdateGLSetup(
    PmtDiscGracePeriod: Text;
    MaxPmtToleranceAmtText: Text
)
```
**Table:** General Ledger Setup
**Pattern:** Modify existing record.

---

## Utility Codeunits (Not Insert Procedures)

### CTS-CBAD Create BankAccChgLog (72281961)
Creates bank account change log entries. Called internally by CustomerMgt and VendorMgt when VerifyAccount = true.

### CTS-CBAD Field Management (72281968)
Utility for resolving enum values from captions. Called by VendorMgt for CostType field.

---

## Tables NOT Covered by Management Codeunits

These tables require **direct Record.Init/Insert** in generated code:

| Table | Notes |
|-------|-------|
| CTS-PI Search Rule | Use direct Insert (see `banking-demo/General/Codeunits/NonLocalized/CreateSearchRules.Codeunit.al`) |
| CTS-PI Split Rule Header / Line | Use direct Insert (see `banking-demo/General/Codeunits/NonLocalized/CreateSplitRules.Codeunit.al`) |
| CTS-CB Payment Journal Setup | Use direct Insert (see `banking-demo/General/Codeunits/DK/CreatePJnlSetupDK.Codeunit.al`) |
| CTS-CB Bank System / Bank Setup | Complex import flow (see `banking-demo/General/Codeunits/NonLocalized/SetupBankAcc.Codeunit.al`) |
| Payment Terms / Customer Posting Group / other BC setup | Assume pre-populated in demo company |
