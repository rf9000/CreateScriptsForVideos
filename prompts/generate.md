## Stage: generate

Build the demo data and the recording script for the feature in the work item.

1. Work out the feature and the flow to demo from the work item. If the brief is vague, demo the
   happy path and say so in `assumptions`.
2. Use the `demo-data-orchestrator` skill to research the data the flow needs, write the PTE into
   the PTE folder, and write the recording script to the recording script file (that exact path,
   not a feature-named file). If the feature needs no seeded data, use `demo-spec-generator` for the
   script alone and still produce a minimal PTE so the deploy stage has something to publish.
3. Check that the PTE's `app.json` name starts with "Continia" and that the install codeunit ends
   with `VerifyDemoData()`.

A separate validation stage reviews your output next, and a deploy stage compiles and publishes it,
so don't compile, deploy, or create environments here.

Result fields:
- `feature`: short feature name.
- `needsBankingDemo`: true if the demo depends on baseline demo-company data from `banking-demo`
  (standard G/L accounts, search-field templates, transaction details, and so on).
- `assumptions`: decisions you made that a reviewer should know about.
- `gaps`: known limitations of the demo. Not presenter chores; those are not allowed.
