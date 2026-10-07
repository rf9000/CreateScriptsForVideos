## Stage: deploy

The environment named below exists, is running, and has the Continia activation app installed.
Compile the PTE and publish it there.

1. If a country app is listed, install its dependencies on the environment first:
   `continia deps install <envId> <app folder>`, run from the continia-banking root with the
   app's relative folder name. Since BC 29 only the country apps declare Continia Finance, so this is
   what brings it onto the environment. Install only; never compile or publish the country app.
2. If "Publish banking-demo first" is yes, publish the `banking-demo` app from the continia-banking
   repo as a dev extension first (use the `continia-deploy` skill; build output must not land inside
   the repo, so deploy from a copy under the PTE folder's parent if the CLI would write next to the
   sources).
3. Use the `continia-deps` skill to install the PTE's dependencies on the environment.
4. Use the `continia-deploy` skill to compile and publish the PTE; deploy refreshes the PTE's
   symbols from the environment itself. Fix compile errors in the PTE and retry until it publishes.
5. The PTE's install trigger runs `VerifyDemoData()`. A "Demo data verification failed" error means
   the seeding code is wrong: fix the data creation and redeploy, the same as a compile error.

The CLI finds apps relative to the current directory and rejects some absolute app paths, so run
`deps` and `deploy` from the PTE folder's parent (this item's own folder) with `pte` as the app path.
Don't run `continia env use` or create a `.continia` folder: symbol state anchors at the nearest
`.continia` ancestor, and each item must keep its own.

Don't create, start, stop, or delete environments; the pipeline owns the environment lifecycle and
checks the installed apps after you finish.

Result fields:
- `gaps`: anything about the deployed demo a presenter should know (empty if nothing).
