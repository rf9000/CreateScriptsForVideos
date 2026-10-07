---
name: continia-test
description: Runs AL test codeunits on a Business Central environment with the continia CLI and interprets the results, including failure messages and AL call stacks. Use it for interactive test runs after code is deployed; the demo pipeline doesn't run tests.
---

# Run AL tests

## Running the CLI

- The CLI is `continia` on PATH in Docker. The pipeline passes its path as `CONTINIA_CLI_PATH` (locally `.claude/.tools/continia.exe`); use that path wherever the examples say `continia`.
- Every `test` command calls the DemoPortal API and needs `--token "$CONTINIA_API_TOKEN"`. The examples omit it for brevity; write it as `continia --token "$CONTINIA_API_TOKEN" test run <envId> <codeunitId> --json`. Never write the token's value into a file or output.

Prerequisites: a running environment, the test app and its runtime dependencies installed there (`continia-deps`, `continia-deploy`), and the test codeunit id.

## Finding the codeunit id

```bash
grep -rn "Subtype = Test" --include="*.al" -i .
```

The id is the number in the declaration, for example `codeunit 50100 "My Feature Tests"`.

## Running tests

```bash
continia test run <envId> <codeunitId>                    # whole codeunit
continia test run <envId> <codeunitId> <functionName>     # one test function
continia test run <envId> <codeunitId> --timeout 300      # default timeout is 120 s
```

Output modes: the default is a human-readable summary; `--json` gives structured results without the XML; `--raw` prints the raw xUnit XML.

Run test jobs one at a time per environment. BC doesn't support concurrent test jobs on the same environment, and parallel runs fail or return wrong results. Wait for each `test run` to finish before starting the next.

## Interpreting results

Default output:

```
FAIL: 2/3 passed (41.0s) — My Feature Tests

  PASS  PostDocument_CreatesEntry (12.1s)
  FAIL  PostDocument_RejectsBlankAccount (8.4s)
        → Assert.AreEqual failed. Expected:<...> Actual:<...>
```

`--json`:

```json
{
  "status": "completed",
  "passed": false,
  "summary": { "total": 3, "passed": 2, "failed": 1, "skipped": 0, "durationSeconds": 41.0, "codeunitName": "My Feature Tests" },
  "tests": [
    { "name": "PostDocument_RejectsBlankAccount", "fullName": "My Feature Tests:PostDocument_RejectsBlankAccount", "result": "Fail", "durationSeconds": 8.4, "errorMessage": "...", "stackTrace": "..." }
  ]
}
```

In `stackTrace`, lines such as `"My Feature"(Codeunit 50101).Calculate line 123` point to the failing AL code.

The command exits with code 1 when any test fails, so `&&` chains stop at the first failing codeunit. Use `;` to run several codeunits in sequence regardless: `continia test run <envId> 50100 ; continia test run <envId> 50101`.

## Fix, deploy, retest

1. Take the failing function and line from the results and fix the code.
2. Redeploy with `continia-deploy`.
3. Rerun the failing function, then the whole codeunit to catch regressions.

## Gotchas

- A test app can compile locally and still fail at runtime when a runtime dependency (for example the Continia Core Internal Activation App) isn't installed on the environment. Install dependencies first with `continia-deps`.
- `Assert.AreEqual(0, SomeBigIntegerField)` fails with `Expected:<0> (Integer). Actual:<0> (BigInteger).` because AL treats the two types as distinct. Compare against a typed local:

  ```al
  var
      ZeroBigInt: BigInteger;
  begin
      ZeroBigInt := 0; // explicit assignment; AA0205 flags unassigned locals
      Assert.AreEqual(ZeroBigInt, SomeRecord."Big Int Field", 'message');
  end;
  ```

## Code coverage

```bash
continia test coverage <envId> <jobId> [--timeout <seconds>]
```

Prints CSV of the AL lines executed by that test job.
