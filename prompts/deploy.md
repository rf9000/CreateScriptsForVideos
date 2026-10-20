## Stage: deploy

The environment named below exists, is running, and has the Continia activation app and the
country app (with its dependencies, Continia Finance included) installed. Compile the PTE and
publish it there. Never compile or publish the country app.

1. If "Publish banking-demo first" is yes, publish the `banking-demo` app from the continia-banking
   repo as a dev extension first (use the `continia-deploy` skill; build output must not land inside
   the repo, so deploy from a copy under the PTE folder's parent if the CLI would write next to the
   sources).
2. Use the `continia-deps` skill to install the PTE's dependencies on the environment.
3. Use the `continia-deploy` skill to compile and publish the PTE; deploy refreshes the PTE's
   symbols from the environment itself. Fix compile errors in the PTE and retry until it publishes.
4. The PTE's install trigger runs `VerifyDemoData()`. A "Demo data verification failed" error means
   the seeding code is wrong: fix the data creation and redeploy, the same as a compile error.

The CLI finds apps relative to the current directory and rejects some absolute app paths, so run
`deps` and `deploy` from the PTE folder's parent (this item's own folder) with `pte` as the app path.
Don't run `continia env use` or create a `.continia` folder: symbol state anchors at the nearest
`.continia` ancestor, and each item must keep its own.

Don't create, start, stop, or delete environments; the pipeline owns the environment lifecycle and
checks the installed apps after you finish.

Result fields:
- `gaps`: anything about the deployed demo a presenter should know (empty if nothing).
