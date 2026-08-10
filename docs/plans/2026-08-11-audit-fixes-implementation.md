# Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five audit findings accepted for implementation: (1) contradictions between `demo-data-orchestrator/SKILL.md`, its `al-template.md` reference, and `create-script.md`; (2) no runtime verification of seeded demo data; (4) work-item briefs polluted by raw ADO HTML and the bot's own prior comments; (5) pipeline reliability/cost issues (no result schema validation, leaked environments on failure, missing 429 handling, retries on non-idempotent POSTs, triple-fetch discovery, unguarded tag rewrite, misleading `--dry-run`, tight `maxTurns`, sequential processing); (6) hygiene (dead config/code, stale docs, unverified agent `cwd`).

**Architecture:** Tasks 1–2 are prompt/skill-document changes only (no TypeScript). Tasks 3–10 are TypeScript changes in `src/` with tests in `tests/` (Bun test, dependency-injection mocks — no network). Task 11 is deletions and doc updates. Each task is independently committable and keeps `bun test` + `bun run typecheck` green.

**Tech Stack:** Bun (TypeScript), Zod, `@anthropic-ai/claude-agent-sdk`, Bun built-in test framework.

## Global Constraints

- `continia-banking` is READ-ONLY — this plan never touches it (it isn't even in this repo; it's a mounted clone).
- Runtime is Bun; imports use explicit `.ts` extensions (existing style).
- Tests use `bun:test` (`describe`/`test`/`expect`/`mock`) and dependency injection — never real network calls.
- Verification commands: `bun test` and `bun run typecheck`. Run both before every commit.
- Commit after every task. Conventional-commit style subjects (`fix:`, `feat:`, `docs:`, `refactor:`). End every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- The PTE convention decided in Task 1 is **`Subtype = Install`** with `OnInstallAppPerCompany()`. Do not reintroduce `Subtype = Upgrade`, `forceUpgrade`, or `internalsVisibleTo` anywhere.
- The internal-access mechanism is the **"Continia Banking Internal Access" dependency app**, id `6e549e35-d1b2-4878-a37a-a736c22f35bf`, publisher `Continia Software Partner`. Never `internalsVisibleTo`.

---

### Task 1: Reconcile the demo-data skill documents (finding 1)

Three documents disagree about how the generated PTE must look. `SKILL.md` (the controlling doc) says `Subtype = Install` + empty launch.json + internal access via the dependency app. `references/al-template.md` says `Subtype = Upgrade` + `forceUpgrade` launch.json + editing `base-application/app.json` (`internalsVisibleTo`) — the latter directly violates the hard rules in `create-script.md:22-27`. The template's `app.json` example also lacks the Internal Access dependency that `SKILL.md` step 1 of Phase 3 requires. **Decision: standardize on Install.** Every work item gets a fresh environment, so the install trigger always fires; if install fails, the app is left uninstalled and a redeploy re-fires it. Data creation is idempotent (`if not Get() then Insert`) so re-installs are safe. The `forceUpgrade` rationale assumed VS Code dev-publish, which this pipeline does not use (it publishes via `continia-deploy`).

**Files:**
- Modify: `.claude/skills/demo-data-orchestrator/references/al-template.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a template consistent with `SKILL.md` Phase 3 and `create-script.md`. Task 2 edits the same files afterwards.

- [ ] **Step 1: Fix the app.json template — add the Internal Access dependency**

In `al-template.md`, inside the `## app.json Template` JSON block, replace the `"dependencies"` array with:

```json
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
```

And add to the **Notes** bullet list directly below the JSON block:

```markdown
- **Internal access**: the "Continia Banking Internal Access" dependency is REQUIRED — it is how the PTE reaches `Access = Internal` CTS-* objects. If compilation reports a version mismatch on it, use the version `continia deps` downloaded. Never solve internal access any other way.
```

- [ ] **Step 2: Convert the codeunit template from Upgrade to Install**

In `al-template.md`:
1. Change the heading `## Upgrade Codeunit Template` to `## Install Codeunit Template`.
2. In the AL code block below it, change `Subtype = Upgrade;` to `Subtype = Install;` and change:

```al
    trigger OnUpgradePerCompany()
    begin
        CreateDemoData();
    end;
```

to:

```al
    trigger OnInstallAppPerCompany()
    begin
        CreateDemoData();
    end;
```

- [ ] **Step 3: Fix the Object Header rules to match**

In the `### Object Header` rules section, replace the two bullets

```markdown
- **`Subtype = Upgrade`** — use Upgrade (not Install) so data creation can be forced on every publish via `"forceUpgrade": true` in launch.json. Install triggers only run once and can't be re-triggered without version bumps.
```
and
```markdown
- **`OnUpgradePerCompany()`** — the upgrade trigger calls `CreateDemoData()` which orchestrates all sub-procedures
- **launch.json** must include `"forceUpgrade": true` and `"schemaUpdateMode": "ForceSync"` to ensure the trigger runs on every publish
```

with:

```markdown
- **`Subtype = Install`** — the pipeline provisions a FRESH environment per work item, so the install trigger always fires on first publish. If the install fails, the app is left uninstalled and republishing re-fires the trigger. Because data creation is idempotent (`if not Get() then Insert` guards), re-installing on an environment where the data already exists is safe.
- **`OnInstallAppPerCompany()`** — the install trigger calls `CreateDemoData()` which orchestrates all sub-procedures
- **launch.json** stays minimal (empty `configurations`) — publishing goes through `continia-deploy`, not VS Code
```

- [ ] **Step 4: Fix the "Why a Deployable Extension?" rationale**

Replace the bullet

```markdown
- Upgrade trigger with `forceUpgrade: true` creates data reliably on every publish — no version bumping needed
```

with:

```markdown
- Install trigger fires on first publish to the fresh per-item environment; failed installs leave the app uninstalled so a fixed redeploy re-fires it
```

- [ ] **Step 5: Delete the stale internalsVisibleTo section**

Delete the entire `### internalsVisibleTo Requirement` section (the heading and its 4 lines including the numbered list). Replace it with:

```markdown
### Internal Access via Dependency (NOT internalsVisibleTo)
All CTS-CB tables, enums, and codeunits are `Access = Internal`. The PTE gains access by depending on the **"Continia Banking Internal Access"** app (`6e549e35-d1b2-4878-a37a-a736c22f35bf`, publisher "Continia Software Partner") declared in `app.json`. Do **NOT** modify `base-application/app.json` or any other file in the read-only continia-banking repo.
```

- [ ] **Step 6: Verify no contradictions remain**

Run:
```bash
grep -n "Upgrade\|forceUpgrade\|internalsVisibleTo" ".claude/skills/demo-data-orchestrator/references/al-template.md"
```
Expected: no hits for `Subtype = Upgrade`, `forceUpgrade`, or `internalsVisibleTo` except inside the new "Internal Access via Dependency" heading text (`NOT internalsVisibleTo`) and, if kept, historical mentions in the RIMD permission bullet (`RIMD` is unrelated — keep). If `OnUpgradePerCompany` still appears anywhere, fix it.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/demo-data-orchestrator/references/al-template.md
git commit -m "docs: align al-template with SKILL.md — Install subtype, internal-access dependency

The template still described the Upgrade-subtype/forceUpgrade convention and
instructed editing base-application internalsVisibleTo, both of which
contradict SKILL.md Phase 3 and the create-script hard rules. Standardize on
Subtype = Install (fresh env per item; failed installs re-fire on redeploy)
and the Internal Access dependency app.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Runtime verification of seeded demo data (finding 2)

Validation today is static (LSP) only; nothing proves the data landed on the environment. Add a `VerifyDemoData()` procedure to the generated PTE that re-reads every seeded record after creation and `Error()`s on the first missing one. Because it runs inside the install trigger, a data bug fails the publish — inside the deploy fix loop the pipeline already has — instead of silently shipping an empty demo.

**Files:**
- Modify: `.claude/skills/demo-data-orchestrator/SKILL.md`
- Modify: `.claude/skills/demo-data-orchestrator/references/al-template.md`
- Modify: `.claude/commands/create-script.md`

**Interfaces:**
- Consumes: Task 1's Install-subtype template.
- Produces: prompt-level contract that a successful PTE install implies verified demo data.

- [ ] **Step 1: Add the verification requirement to SKILL.md Phase 3**

In `SKILL.md` Phase 3, item 3 (`InstallDemoData.Codeunit.al`), change the bullet

```markdown
   - `OnInstallAppPerCompany()` trigger calls `CreateDemoData()`
```

to:

```markdown
   - `OnInstallAppPerCompany()` trigger calls `CreateDemoData()` then `VerifyDemoData()`
```

and after the bullet `- `CreateDemoData()` is a `local procedure` (only called from the trigger)` add:

```markdown
   - `VerifyDemoData()` is a `local procedure` that re-reads EVERY seeded record (`Get()` for keyed records, `IsEmpty()` checks for ranges) and calls `Error()` naming the first missing one. A verification failure aborts the install, so a broken PTE fails at publish time instead of producing an empty demo. Every record `CreateDemoData()` inserts must have a matching verification check.
```

- [ ] **Step 2: Add the VerifyDemoData template to al-template.md**

In `al-template.md`, in the Install codeunit template AL block, change the trigger to:

```al
    trigger OnInstallAppPerCompany()
    begin
        CreateDemoData();
        VerifyDemoData();
    end;
```

and after the `CreateBankAccounts()` sub-procedure add:

```al
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
```

Also add a rule bullet under `### Object Header`:

```markdown
- **`VerifyDemoData()`** — mandatory; one `Get()`/`IsEmpty()` check per seeded record, `Error(MissingRecordErr, ...)` on the first miss. The install trigger calls it after `CreateDemoData()`.
```

- [ ] **Step 3: Strengthen the Verify step in create-script.md**

In `.claude/commands/create-script.md`, replace workflow step 7

```markdown
7. **Verify** the environment is running and the PTE is installed (`continia-test` / `continia env`
   commands as appropriate).
```

with:

```markdown
7. **Verify** the environment is running and the PTE is listed as installed (`continia-test` /
   `continia env` commands as appropriate). The PTE's install trigger ends with `VerifyDemoData()`,
   which re-reads every seeded record and errors on the first missing one — so a successful
   publish+install is runtime proof the demo data landed. If publish fails with a
   "Demo data verification failed" error, treat it as a compile-error-equivalent: fix the PTE's
   data creation and redeploy (step 6 fix loop).
```

- [ ] **Step 4: Verify consistency**

Run:
```bash
grep -n "VerifyDemoData" ".claude/skills/demo-data-orchestrator/SKILL.md" ".claude/skills/demo-data-orchestrator/references/al-template.md" ".claude/commands/create-script.md"
```
Expected: hits in all three files.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/demo-data-orchestrator .claude/commands/create-script.md
git commit -m "feat: runtime demo-data verification via VerifyDemoData in the install trigger

A data bug now fails the PTE publish (inside the existing deploy fix loop)
instead of silently shipping an empty demo. Static validation alone could not
prove the data actually landed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Clean work-item briefs — HTML-to-text + bot-comment filtering (finding 4)

`processor.ts` feeds raw ADO HTML (description + all comments) into the agent prompt, including the bot's own prior failure/env comments — so a re-tagged item gets the previous run's password block and error text as its "brief". Strip HTML to text and filter the bot's own comments (marker-based for new comments, phrase-based for legacy ones).

**Files:**
- Create: `src/services/html.ts`
- Modify: `src/services/processor.ts`
- Modify: `src/services/orchestrator-agent.ts` (comment layout in the prompt)
- Test: `tests/services/html.test.ts`, `tests/services/processor.test.ts`, `tests/services/orchestrator-agent.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `htmlToText(html: string): string` (src/services/html.ts); `BOT_COMMENT_MARKER: string` and `isBotComment(text: string): boolean` exported from `src/services/processor.ts`. Multi-line comments now render in the prompt as `### Comment N` sections instead of `- ` bullets.

- [ ] **Step 1: Write failing tests for htmlToText**

Create `tests/services/html.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import { htmlToText } from '../../src/services/html.ts';

describe('htmlToText', () => {
  test('strips tags and keeps text', () => {
    expect(htmlToText('<div>Show how to <b>create</b> a merge rule.</div>')).toBe(
      'Show how to create a merge rule.',
    );
  });

  test('converts block ends and <br> to newlines', () => {
    expect(htmlToText('<p>Line one</p><p>Line two</p>Line<br>three')).toBe(
      'Line one\nLine two\nLine\nthree',
    );
  });

  test('renders list items as dashes', () => {
    expect(htmlToText('<ul><li>First</li><li>Second</li></ul>')).toBe('- First\n- Second');
  });

  test('decodes common entities', () => {
    expect(htmlToText('A&nbsp;&amp;&nbsp;B &lt;tag&gt; &quot;q&quot; &#39;s&#39;')).toBe(
      'A & B <tag> "q" \'s\'',
    );
  });

  test('collapses excess blank lines and trims', () => {
    expect(htmlToText('<p></p><p>Text</p><p></p>')).toBe('Text');
  });

  test('returns empty string for empty/undefined-ish input', () => {
    expect(htmlToText('')).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/html.test.ts`
Expected: FAIL — cannot resolve `../../src/services/html.ts`.

- [ ] **Step 3: Implement htmlToText**

Create `src/services/html.ts`:

```ts
/**
 * Convert ADO's HTML field/comment bodies to plain text for the agent prompt.
 * Regex-based on purpose: ADO emits simple markup, and we only need legibility,
 * not fidelity.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/services/html.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write failing tests for bot filtering and description stripping**

Add to `tests/services/processor.test.ts` (uses the existing `mockConfig`/`mockWorkItem`/`makeDeps` helpers):

```ts
import { isBotComment, BOT_COMMENT_MARKER } from '../../src/services/processor.ts';

describe('processItem — brief hygiene', () => {
  test('filters bot comments and strips HTML from the rest', async () => {
    const deps = makeDeps({
      fetchComments: mock(async () => [
        '<p>Use <b>DK</b> localization</p>',
        `<p>Recording environment ready for <strong>Merge Rules</strong>.</p><p><code>${BOT_COMMENT_MARKER}</code></p>`,
        '<p>Script generation failed for this work item:</p><blockquote>boom</blockquote>',
      ]),
    });
    await processItem(mockConfig(), mockWorkItem(), deps);

    const call = (deps.runOrchestrator as ReturnType<typeof mock>).mock.calls[0]!;
    const context = call[1] as { comments: string[] };
    expect(context.comments).toEqual(['Use DK localization']);
  });

  test('strips HTML from the description', async () => {
    const deps = makeDeps();
    const item = mockWorkItem({
      fields: {
        'System.Title': 'Demo merge rules',
        'System.WorkItemType': 'Product Backlog Item',
        'System.Description': '<div>Show how to create<br>a merge rule.</div>',
      },
    });
    await processItem(mockConfig(), item, deps);

    const call = (deps.runOrchestrator as ReturnType<typeof mock>).mock.calls[0]!;
    const context = call[1] as { itemDescription: string };
    expect(context.itemDescription).toBe('Show how to create\na merge rule.');
  });

  test('bot comments carry the marker so future runs filter them', async () => {
    const deps = makeDeps();
    await processItem(mockConfig(), mockWorkItem(), deps);
    const commentCall = (deps.addComment as ReturnType<typeof mock>).mock.calls[0]!;
    expect(String(commentCall[2])).toContain(BOT_COMMENT_MARKER);
  });

  test('failure comments carry the marker too', async () => {
    const deps = makeDeps({
      runOrchestrator: mock(async () => ({ status: 'failed', errorMessage: 'boom' }) as ScriptResult),
    });
    await processItem(mockConfig(), mockWorkItem(), deps);
    const commentCall = (deps.addComment as ReturnType<typeof mock>).mock.calls[0]!;
    expect(String(commentCall[2])).toContain(BOT_COMMENT_MARKER);
  });
});

describe('isBotComment', () => {
  test('matches marker and legacy phrases, not user text', () => {
    expect(isBotComment(`anything ${BOT_COMMENT_MARKER} anything`)).toBe(true);
    expect(isBotComment('Recording environment ready for X')).toBe(true);
    expect(isBotComment('Script generation failed for this work item: y')).toBe(true);
    expect(isBotComment('Please use DK localization')).toBe(false);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `bun test tests/services/processor.test.ts`
Expected: FAIL — `isBotComment`/`BOT_COMMENT_MARKER` not exported; comments/description not transformed.

- [ ] **Step 7: Implement filtering in processor.ts**

In `src/services/processor.ts`:

1. Add import: `import { htmlToText } from './html.ts';`
2. Below the `escapeHtml` helper add:

```ts
/** Marker embedded in every comment this pipeline posts, so later runs can filter them out of the brief. */
export const BOT_COMMENT_MARKER = '[create-scripts]';

/** Phrases identifying comments posted by builds that predate the marker. */
const LEGACY_BOT_PHRASES = [
  'Recording environment ready for',
  'Script generation failed for this work item',
];

export function isBotComment(text: string): boolean {
  return (
    text.includes(BOT_COMMENT_MARKER) ||
    LEGACY_BOT_PHRASES.some((phrase) => text.includes(phrase))
  );
}

const botFooter = `<p><em>Posted automatically by the create-scripts pipeline</em> <code>${BOT_COMMENT_MARKER}</code></p>`;
```

3. In `buildEnvComment`, change the final push to:

```ts
  lines.push(
    `<p>The recording script is attached to this work item as <code>${escapeHtml(fileName)}</code>.</p>`,
    botFooter,
  );
```

4. In `buildFailureComment`, append `botFooter` as the last array element before `.join('\n')`.
5. In `processItem`, replace

```ts
    const comments = await deps.fetchComments(config, item.id);
```

with:

```ts
    const rawComments = await deps.fetchComments(config, item.id);
    // ADO stores comments as HTML and includes this pipeline's own past posts
    // (env credentials, failure reports). Neither belongs in the agent's brief.
    const comments = rawComments
      .filter((c) => !isBotComment(c))
      .map((c) => htmlToText(c))
      .filter((c) => c.length > 0);
```

and change the context's description line to:

```ts
      itemDescription: htmlToText(String(item.fields['System.Description'] ?? '')),
```

- [ ] **Step 8: Switch the prompt's comment layout to sections (multi-line safe)**

In `src/services/orchestrator-agent.ts`, `buildOrchestratorPrompt`, replace

```ts
  if (context.comments.length > 0) {
    lines.push('', '## Comments');
    for (const comment of context.comments) {
      lines.push(`- ${comment}`);
    }
  }
```

with:

```ts
  if (context.comments.length > 0) {
    lines.push('', '## Comments');
    context.comments.forEach((comment, i) => {
      lines.push('', `### Comment ${i + 1}`, comment);
    });
  }
```

Update any test in `tests/services/orchestrator-agent.test.ts` that asserts the `- comment` bullet format to expect the `### Comment 1` section format instead (search that file for `'## Comments'` / `'- '` assertions).

- [ ] **Step 9: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/services/html.ts src/services/processor.ts src/services/orchestrator-agent.ts tests/services/html.test.ts tests/services/processor.test.ts tests/services/orchestrator-agent.test.ts
git commit -m "fix: strip ADO HTML and filter the bot's own comments from the agent brief

Re-tagged items previously received the prior run's env-credential and
failure comments (raw HTML included) as part of the feature brief.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Validate the agent's JSON result with Zod (finding 5)

`parseResult` accepts anything whose `status` is `success`/`failed` — a success with a garbage `env` or missing `scriptPath` sails through to the ADO comment. Validate with Zod: success requires `scriptPath` + full `env`; failed requires `errorMessage`. On schema failure, degrade to a `failed` result that still salvages a valid `env` if one was provisioned (so Task 5's failure comment can surface it).

**Files:**
- Modify: `src/services/orchestrator-agent.ts`
- Test: `tests/services/orchestrator-agent.test.ts`

**Interfaces:**
- Consumes: existing `ScriptResult` / `EnvDetails` types (`src/types/index.ts:65-87`).
- Produces: `parseResult(raw: string): ScriptResult` (same signature, stricter semantics). A schema-invalid "success" now returns `status: 'failed'` with `errorMessage` beginning `Agent result failed schema validation:`.

- [ ] **Step 1: Write failing tests**

Add to `tests/services/orchestrator-agent.test.ts` (it already imports `parseResult`; if not, add the import):

```ts
describe('parseResult — schema validation', () => {
  const validEnv = {
    id: 'env-1', name: 'Demo', url: 'https://e.example.com',
    username: 'admin', password: 'pw',
  };

  test('accepts a fully-formed success', () => {
    const raw = '```json\n' + JSON.stringify({
      status: 'success', feature: 'Merge Rules',
      scriptPath: '/out/42/script.md', ptePath: '/out/42/pte',
      env: validEnv, assumptions: [], gaps: [],
    }) + '\n```';
    expect(parseResult(raw).status).toBe('success');
  });

  test('rejects success without env', () => {
    const raw = '```json\n' + JSON.stringify({
      status: 'success', scriptPath: '/out/42/script.md',
    }) + '\n```';
    const result = parseResult(raw);
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('schema validation');
    expect(result.errorMessage).toContain('env');
  });

  test('rejects success without scriptPath', () => {
    const raw = '```json\n' + JSON.stringify({ status: 'success', env: validEnv }) + '\n```';
    const result = parseResult(raw);
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('scriptPath');
  });

  test('salvages a valid env from a schema-invalid success', () => {
    const raw = '```json\n' + JSON.stringify({ status: 'success', env: validEnv }) + '\n```';
    const result = parseResult(raw);
    expect(result.status).toBe('failed');
    expect(result.env).toEqual(validEnv);
  });

  test('rejects failed without errorMessage', () => {
    const raw = '```json\n' + JSON.stringify({ status: 'failed' }) + '\n```';
    const result = parseResult(raw);
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('schema validation');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/orchestrator-agent.test.ts`
Expected: FAIL — success-without-env currently parses as `success`.

- [ ] **Step 3: Implement the schema**

In `src/services/orchestrator-agent.ts`, add `import { z } from 'zod';` and above `parseResult`:

```ts
const envSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

const commonFields = {
  feature: z.string().optional(),
  ptePath: z.string().optional(),
  assumptions: z.array(z.string()).optional(),
  gaps: z.array(z.string()).optional(),
};

// Success must carry everything the processor posts to ADO; failed must explain itself.
const scriptResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    scriptPath: z.string().min(1),
    env: envSchema,
    errorMessage: z.string().optional(),
    ...commonFields,
  }),
  z.object({
    status: z.literal('failed'),
    errorMessage: z.string().min(1),
    scriptPath: z.string().optional(),
    env: envSchema.optional(),
    ...commonFields,
  }),
]);
```

Replace the body of `parseResult` with:

```ts
export function parseResult(raw: string): ScriptResult {
  const candidate = extractJson(raw);
  if (candidate !== undefined) {
    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>;
      const parsed = scriptResultSchema.safeParse(obj);
      if (parsed.success) return parsed.data;

      // Salvage a provisioned environment so the failure report can surface it.
      const env = envSchema.safeParse(obj['env']);
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      return {
        status: 'failed',
        errorMessage: `Agent result failed schema validation: ${issues}`,
        ...(env.success ? { env: env.data } : {}),
      };
    } catch {
      // fall through to failure
    }
  }
  return {
    status: 'failed',
    errorMessage: `Could not parse a result from the agent output: ${raw.slice(0, 200)}`,
  };
}
```

- [ ] **Step 4: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: PASS. If an existing `parseResult` test used a minimal success object (e.g. `{"status":"success"}`), update it to include `scriptPath` and a full `env` — that's the new contract.

- [ ] **Step 5: Commit**

```bash
git add src/services/orchestrator-agent.ts tests/services/orchestrator-agent.test.ts
git commit -m "fix: validate the agent's JSON result with zod

A success without a scriptPath or complete env details previously reached
the ADO comment unvalidated.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Surface leaked environments and assumptions; raise maxTurns (finding 5)

Every failed run leaves a running BC environment (`create-script.md:44` forbids deleting it) that nothing reports — pure cost leak. Also `assumptions` are parsed but never shown to a human, and `maxTurns: 120` is tight for research + 3 validation rounds + compile-fix loops.

**Files:**
- Modify: `.claude/commands/create-script.md`
- Modify: `src/services/processor.ts`
- Modify: `src/config/index.ts`
- Modify: `src/cli/index.ts` (help text default)
- Modify: `.env.example`, `.env.create-scripts.example` (if they mention AGENT_MAX_TURNS)
- Test: `tests/services/processor.test.ts`, `tests/config/config.test.ts`

**Interfaces:**
- Consumes: `ScriptResult.env` optional-on-failure (already in the type; Task 4's schema allows it).
- Produces: failure comments that include env details when present; env comments that include `assumptions`; `AGENT_MAX_TURNS` default 200.

- [ ] **Step 1: Update the prompt's failure contract**

In `.claude/commands/create-script.md`, replace the failure-output line

```markdown
On failure use `{"status":"failed","errorMessage":"...","assumptions":[],"gaps":[]}` and include
whatever partial paths you did produce.
```

with:

```markdown
On failure use `{"status":"failed","errorMessage":"...","assumptions":[],"gaps":[]}` and include
whatever partial paths you did produce. **If an environment was already provisioned when the
failure occurred, include its full `env` object** (id, name, url, username, password) — the
environment is left running and the failure report must tell a human it exists.
```

- [ ] **Step 2: Write failing tests for the comment changes**

Add to `tests/services/processor.test.ts`:

```ts
describe('failure comment env reporting', () => {
  test('failure comment includes provisioned env details when present', async () => {
    const deps = makeDeps({
      runOrchestrator: mock(async () => ({
        status: 'failed',
        errorMessage: 'compile failed',
        env: {
          id: 'env-9', name: 'Leaked Env', url: 'https://leak.example.com',
          username: 'admin', password: 'pw',
        },
      }) as ScriptResult),
    });
    await processItem(mockConfig(), mockWorkItem(), deps);
    const html = String((deps.addComment as ReturnType<typeof mock>).mock.calls[0]![2]);
    expect(html).toContain('still running');
    expect(html).toContain('https://leak.example.com');
    expect(html).toContain('env-9');
  });

  test('env comment lists assumptions when present', async () => {
    const deps = makeDeps({
      runOrchestrator: mock(async () => ({
        ...successResult,
        assumptions: ['Assumed DK localization'],
      }) as ScriptResult),
    });
    await processItem(mockConfig(), mockWorkItem(), deps);
    const html = String((deps.addComment as ReturnType<typeof mock>).mock.calls[0]![2]);
    expect(html).toContain('Assumptions');
    expect(html).toContain('Assumed DK localization');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/services/processor.test.ts`
Expected: FAIL — failure comment has no env block; env comment has no assumptions block.

- [ ] **Step 4: Implement the comment changes**

In `src/services/processor.ts`:

1. In `buildEnvComment`, before the `gaps` block, add:

```ts
  if (result.assumptions && result.assumptions.length > 0) {
    lines.push('<p><strong>Assumptions made:</strong></p>', '<ul>');
    for (const a of result.assumptions) lines.push(`<li>${escapeHtml(a)}</li>`);
    lines.push('</ul>');
  }
```

2. Replace `buildFailureComment` with:

```ts
function buildFailureComment(result: ScriptResult): string {
  const lines = [
    '<p>Script generation failed for this work item:</p>',
    `<blockquote>${escapeHtml(result.errorMessage ?? 'unknown error')}</blockquote>`,
  ];
  if (result.env) {
    lines.push(
      '<p><strong>An environment was provisioned before the failure and is still running:</strong></p>',
      '<ul>',
      `<li><strong>Environment:</strong> ${escapeHtml(result.env.name)} (${escapeHtml(result.env.id)})</li>`,
      `<li><strong>URL:</strong> <a href="${escapeHtml(result.env.url)}">${escapeHtml(result.env.url)}</a></li>`,
      `<li><strong>Username:</strong> ${escapeHtml(result.env.username)}</li>`,
      `<li><strong>Password:</strong> ${escapeHtml(result.env.password)}</li>`,
      '</ul>',
    );
  }
  lines.push(
    '<p>The tag has been removed. <strong>Re-add the tag</strong> (e.g. after adding more detail) to try again.</p>',
    botFooter,
  );
  return lines.join('\n');
}
```

(`botFooter` exists from Task 3.)

- [ ] **Step 5: Raise the maxTurns default**

In `src/config/index.ts` change `AGENT_MAX_TURNS: z.coerce.number().default(120)` to `.default(200)`. Update `src/cli/index.ts` HELP line to `AGENT_MAX_TURNS           Max agentic turns per item (default: 200)`. Grep `.env.example` and `.env.create-scripts.example` for `AGENT_MAX_TURNS` and update any `=120` default/comment to 200. If `tests/config/config.test.ts` asserts the 120 default, update it to 200.

- [ ] **Step 6: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .claude/commands/create-script.md src/services/processor.ts src/config/index.ts src/cli/index.ts .env.example .env.create-scripts.example tests/
git commit -m "feat: report leaked environments and assumptions; raise AGENT_MAX_TURNS to 200

Failed runs leave their BC environment running by design; the failure comment
now surfaces it instead of silently accumulating cost. Assumptions from the
data-map now reach the work item. 120 turns was too tight for research plus
three validation rounds plus deploy fix loops.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: ADO retry hardening — 429 support, no retry on non-idempotent POSTs (finding 5)

`adoFetchWithRetry` rethrows immediately on 429 (ADO throttling = hard failure, `Retry-After` ignored) while blanket-retrying 5xx on non-idempotent POSTs (duplicate comments/attachments on timeout).

**Files:**
- Modify: `src/sdk/azure-devops-client.ts`
- Test: `tests/sdk/azure-devops-client.test.ts`

**Interfaces:**
- Consumes: existing `AzureDevOpsError`.
- Produces: `AzureDevOpsError.retryAfterMs?: number`; `adoFetchWithRetry<T>(config, path, options?, retryDelays?, idempotent = true)`; exported `DEFAULT_RETRY_DELAYS`. Non-idempotent callers (`addWorkItemComment`, `uploadAttachment`, `linkAttachment`) retry ONLY on 429 (request was rejected, not processed).

- [ ] **Step 1: Write failing tests**

Add to `tests/sdk/azure-devops-client.test.ts` (uses existing `setSequentialMockFetch`; extend it or set a manual mock where a header is needed):

```ts
describe('retry policy', () => {
  test('adoFetch exposes Retry-After as retryAfterMs', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response('slow down', {
          status: 429,
          headers: { 'Retry-After': '7' },
        }),
      ),
    ) as unknown as typeof fetch;
    try {
      await adoFetch(mockConfig(), 'wit/anything?api-version=7.0');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      expect((err as AzureDevOpsError).statusCode).toBe(429);
      expect((err as AzureDevOpsError).retryAfterMs).toBe(7000);
    }
  });

  test('adoFetchWithRetry retries 429 and succeeds', async () => {
    setSequentialMockFetch(
      { body: 'throttled', status: 429 },
      { body: { ok: true } },
    );
    const result = await adoFetchWithRetry<{ ok: boolean }>(
      mockConfig(), 'wit/x?api-version=7.0', undefined, [1],
    );
    expect(result.ok).toBe(true);
    expect(mockFn.mock.calls.length).toBe(2);
  });

  test('non-idempotent calls do NOT retry 5xx', async () => {
    setSequentialMockFetch({ body: 'boom', status: 503 }, { body: { ok: true } });
    await expect(
      adoFetchWithRetry(mockConfig(), 'wit/x?api-version=7.0', { method: 'POST' }, [1], false),
    ).rejects.toThrow('503');
    expect(mockFn.mock.calls.length).toBe(1);
  });

  test('non-idempotent calls still retry 429', async () => {
    setSequentialMockFetch({ body: 'throttled', status: 429 }, { body: { ok: true } });
    const result = await adoFetchWithRetry<{ ok: boolean }>(
      mockConfig(), 'wit/x?api-version=7.0', { method: 'POST' }, [1], false,
    );
    expect(result.ok).toBe(true);
    expect(mockFn.mock.calls.length).toBe(2);
  });

  test('non-idempotent calls do not retry network errors', async () => {
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls++;
      return Promise.reject(new Error('socket hang up'));
    }) as unknown as typeof fetch;
    await expect(
      adoFetchWithRetry(mockConfig(), 'wit/x?api-version=7.0', { method: 'POST' }, [1], false),
    ).rejects.toThrow('socket hang up');
    expect(calls).toBe(1);
  });
});
```

Note: `setSequentialMockFetch` currently builds `Response` from JSON body only — the 429 body being a plain string is fine (it's read via `res.text()` on the error path). If `Response` construction needs a string, pass `'throttled'` as shown.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/sdk/azure-devops-client.test.ts`
Expected: FAIL — no `retryAfterMs`; 429 not retried; POST 5xx currently retried.

- [ ] **Step 3: Implement**

In `src/sdk/azure-devops-client.ts`:

1. Extend the error class:

```ts
export class AzureDevOpsError extends Error {
  override readonly name = 'AzureDevOpsError';
  readonly statusCode: number;
  /** Milliseconds from a Retry-After header, when the API sent one (429). */
  readonly retryAfterMs?: number;

  constructor(message: string, statusCode: number, retryAfterMs?: number) {
    super(message);
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}
```

2. In `adoFetch`, replace the `if (!res.ok)` block body with:

```ts
  if (!res.ok) {
    const body = await res.text();
    const retryAfterSec = Number(res.headers.get('Retry-After'));
    throw new AzureDevOpsError(
      `Azure DevOps API error ${res.status}: ${body}`,
      res.status,
      Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : undefined,
    );
  }
```

3. Export the delays and rework the retry loop:

```ts
export const DEFAULT_RETRY_DELAYS = [1000, 2000, 4000];

/**
 * Fetch with retry. 429 (throttling) is always retryable — ADO rejected the
 * request without processing it — honoring Retry-After when present. 5xx and
 * network errors are retried only for idempotent requests; retrying a POST
 * that may have been applied server-side duplicates comments/attachments.
 */
export async function adoFetchWithRetry<T>(
  config: AppConfig,
  path: string,
  options?: RequestInit,
  retryDelays: number[] = DEFAULT_RETRY_DELAYS,
  idempotent = true,
): Promise<T> {
  const maxAttempts = retryDelays.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await adoFetch<T>(config, path, options);
    } catch (err: unknown) {
      const isLastAttempt = attempt === maxAttempts;
      let delay = retryDelays[attempt - 1] ?? 0;

      if (err instanceof AzureDevOpsError) {
        const retryable =
          err.statusCode === 429 || (idempotent && err.statusCode >= 500);
        if (!retryable || isLastAttempt) throw err;
        if (err.statusCode === 429 && err.retryAfterMs !== undefined) {
          delay = err.retryAfterMs;
        }
      } else {
        if (!idempotent || isLastAttempt) throw err;
      }

      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('adoFetchWithRetry: unexpected code path');
}
```

4. Mark the non-idempotent callers — in `addWorkItemComment`, `uploadAttachment`, and `linkAttachment`, change their `adoFetchWithRetry(config, path, { ... })` calls to `adoFetchWithRetry(config, path, { ... }, DEFAULT_RETRY_DELAYS, false)`.

- [ ] **Step 4: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: PASS (existing 5xx-retry tests for idempotent paths must still pass).

- [ ] **Step 5: Commit**

```bash
git add src/sdk/azure-devops-client.ts tests/sdk/azure-devops-client.test.ts
git commit -m "fix: retry ADO 429s (honoring Retry-After); stop retrying non-idempotent POSTs

Throttling was a hard failure while comment/attachment POSTs could be
duplicated by blanket 5xx/network retries.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Single-fetch discovery (finding 5)

Discovery fetches each item up to three times: WIQL, batch tag re-check, then `defaultFetchItems` re-fetches with `$expand=all`. Fold the tag re-check and the field fetch into one call.

**Files:**
- Modify: `src/sdk/azure-devops-client.ts` (replace `queryWorkItemsByTag` with `queryTaggedWorkItems`)
- Modify: `src/services/watcher.ts` (`defaultFetchItems`)
- Modify: `scripts/diagnose-discovery.ts`
- Test: `tests/sdk/azure-devops-client.test.ts`

**Interfaces:**
- Consumes: `queryWorkItems`, `adoFetchWithRetry` (Task 6 signature — defaults suffice here).
- Produces: `queryTaggedWorkItems(config: AppConfig): Promise<WorkItemResponse[]>` — full items with fields `System.Tags`, `System.Title`, `System.Description`, `System.WorkItemType` (these are all the processor reads). `queryWorkItemsByTag` is REMOVED.

- [ ] **Step 1: Write failing tests**

In `tests/sdk/azure-devops-client.test.ts`, replace the `queryWorkItemsByTag` describe block (and its import) with:

```ts
import { queryTaggedWorkItems } from '../../src/sdk/azure-devops-client.ts';

describe('queryTaggedWorkItems', () => {
  test('returns full items for exact tag matches using exactly two requests', async () => {
    setSequentialMockFetch(
      { body: { workItems: [{ id: 1, url: 'u1' }, { id: 2, url: 'u2' }] } },
      {
        body: {
          value: [
            {
              id: 1, rev: 3, url: 'u1',
              fields: {
                'System.Tags': 'create script; other',
                'System.Title': 'Item one',
                'System.Description': '<p>desc</p>',
                'System.WorkItemType': 'Product Backlog Item',
              },
            },
            {
              id: 2, rev: 1, url: 'u2',
              fields: { 'System.Tags': 'create scripts', 'System.Title': 'Item two' },
            },
          ],
        },
      },
    );
    const items = await queryTaggedWorkItems(mockConfig());
    expect(items.map((i) => i.id)).toEqual([1]);
    expect(items[0]!.fields['System.Title']).toBe('Item one');
    expect(mockFn.mock.calls.length).toBe(2);
    const batchUrl = String(mockFn.mock.calls[1]![0]);
    expect(batchUrl).toContain('System.Title');
    expect(batchUrl).not.toContain('$expand');
  });

  test('returns empty without a batch call when WIQL finds nothing', async () => {
    setMockFetch({ workItems: [] });
    const items = await queryTaggedWorkItems(mockConfig());
    expect(items).toEqual([]);
    expect(mockFn.mock.calls.length).toBe(1);
  });
});
```

Port over any other behaviors the old describe block covered (area-path clause in the WIQL body, chunking) by adapting those tests to the new return type.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/sdk/azure-devops-client.test.ts`
Expected: FAIL — `queryTaggedWorkItems` does not exist.

- [ ] **Step 3: Implement**

In `src/sdk/azure-devops-client.ts`, replace the whole `queryWorkItemsByTag` function with:

```ts
const DISCOVERY_FIELDS = [
  'System.Tags',
  'System.Title',
  'System.Description',
  'System.WorkItemType',
].join(',');

/**
 * Find work items carrying the configured tag and return them with the fields
 * the processor needs — one WIQL round-trip plus one batch fetch, no $expand.
 *
 * Scoped to the project via the request URL (NOT a `[System.TeamProject]`
 * clause — that's fragile and can zero out results if config.project doesn't
 * exactly match the stored value).
 *
 * `[System.Tags] CONTAINS` is substring-based, so the WIQL only narrows to
 * candidates; we exact-match per tag in code from the fetched System.Tags.
 */
export async function queryTaggedWorkItems(
  config: AppConfig,
): Promise<WorkItemResponse[]> {
  let wiql =
    `SELECT [System.Id] FROM workitems ` +
    `WHERE [System.Tags] CONTAINS '${config.createScriptTag}'`;
  // Area path is how work items are classified under a product (e.g.
  // "Continia Software\Continia Banking") — UNDER matches the node and all
  // descendants. This is the real scope signal; Git artifact links are absent.
  if (config.areaPath) {
    wiql += ` AND [System.AreaPath] UNDER '${config.areaPath}'`;
  }
  const candidateIds = await queryWorkItems(config, wiql);
  if (candidateIds.length === 0) return [];

  const tagLower = config.createScriptTag.toLowerCase();
  const tagged: WorkItemResponse[] = [];
  const chunkSize = 200;

  for (let i = 0; i < candidateIds.length; i += chunkSize) {
    const chunk = candidateIds.slice(i, i + chunkSize);
    const path = `wit/workitems?ids=${chunk.join(',')}&fields=${DISCOVERY_FIELDS}&api-version=7.0`;
    const data = await adoFetchWithRetry<{ value: WorkItemResponse[] }>(
      config,
      path,
    );
    for (const item of data.value ?? []) {
      const tags = String(item.fields['System.Tags'] ?? '');
      if (tags.split(';').some((t) => t.trim().toLowerCase() === tagLower)) {
        tagged.push(item);
      }
    }
  }

  return tagged;
}
```

- [ ] **Step 4: Update the watcher and the diagnose script**

In `src/services/watcher.ts`, replace `defaultFetchItems` with:

```ts
async function defaultFetchItems(config: AppConfig): Promise<WorkItemResponse[]> {
  return sdk.queryTaggedWorkItems(config);
}
```

In `scripts/diagnose-discovery.ts`, change the import from `queryWorkItemsByTag` to `queryTaggedWorkItems` and the Stage 2 call to:

```ts
const discoveredIds = (await queryTaggedWorkItems(config)).map((i) => i.id);
```

- [ ] **Step 5: Run the full suite**

Run: `bun test && bun run typecheck && bun scripts/diagnose-discovery.ts --help 2>&1 | head -1 || true`
Expected: tests + typecheck PASS (the diagnose script needs a real `.env`, so only typecheck guards it — that's fine).

- [ ] **Step 6: Commit**

```bash
git add src/sdk/azure-devops-client.ts src/services/watcher.ts scripts/diagnose-discovery.ts tests/sdk/azure-devops-client.test.ts
git commit -m "refactor: single-fetch work-item discovery

Discovery fetched each item up to three times (WIQL, tag re-check batch,
\$expand=all re-fetch). One batch call now returns the exact fields the
processor reads.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Rev-guarded tag removal (finding 5)

`removeTagFromWorkItem` rewrites the whole `System.Tags` string from a `$expand=all` snapshot with no concurrency guard — any tag a human added between the GET and the PATCH (an hours-long agent run sits before this) is silently dropped. Add a JSON-Patch `test` op on `rev` and retry once on conflict; fetch only the fields needed.

**Files:**
- Modify: `src/sdk/azure-devops-client.ts`
- Test: `tests/sdk/azure-devops-client.test.ts`

**Interfaces:**
- Consumes: `adoFetchWithRetry` (idempotent default is correct — the PATCH is a same-value replace, safe to retry).
- Produces: same signature `removeTagFromWorkItem(config, workItemId, tagToRemove): Promise<void>`; PATCH body now starts with `{ op: 'test', path: '/rev', value: <fresh rev> }`.

- [ ] **Step 1: Write failing tests**

In `tests/sdk/azure-devops-client.test.ts`, extend the `removeTagFromWorkItem` describe block:

```ts
  test('guards the tags rewrite with a rev test op', async () => {
    setSequentialMockFetch(
      { body: { id: 1, rev: 7, url: 'u', fields: { 'System.Tags': 'create script; keep' } } },
      { body: { id: 1, rev: 8, url: 'u', fields: {} } },
    );
    await removeTagFromWorkItem(mockConfig(), 1, 'create script');
    const patchInit = mockFn.mock.calls[1]![1] as RequestInit;
    const ops = JSON.parse(String(patchInit.body)) as Array<Record<string, unknown>>;
    expect(ops[0]).toEqual({ op: 'test', path: '/rev', value: 7 });
    expect(ops[1]).toEqual({ op: 'replace', path: '/fields/System.Tags', value: 'keep' });
    const getUrl = String(mockFn.mock.calls[0]![0]);
    expect(getUrl).toContain('fields=System.Tags');
    expect(getUrl).not.toContain('$expand');
  });

  test('re-reads and retries once when the rev test fails', async () => {
    setSequentialMockFetch(
      { body: { id: 1, rev: 7, url: 'u', fields: { 'System.Tags': 'create script' } } },
      { body: 'rev mismatch', status: 409 },
      { body: { id: 1, rev: 9, url: 'u', fields: { 'System.Tags': 'create script; new-tag' } } },
      { body: { id: 1, rev: 10, url: 'u', fields: {} } },
    );
    await removeTagFromWorkItem(mockConfig(), 1, 'create script');
    expect(mockFn.mock.calls.length).toBe(4);
    const secondPatch = JSON.parse(
      String((mockFn.mock.calls[3]![1] as RequestInit).body),
    ) as Array<Record<string, unknown>>;
    expect(secondPatch[0]).toEqual({ op: 'test', path: '/rev', value: 9 });
    expect(secondPatch[1]!['value']).toBe('new-tag');
  });
```

Note: the 409 must not be swallowed by `adoFetchWithRetry` — 409 is <500 and not 429, so it throws through immediately. Pass explicit `retryDelays` of `[1]` in the implementation only if a test proves the default delays slow the test down; they shouldn't, since 4xx never sleeps.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/sdk/azure-devops-client.test.ts`
Expected: FAIL — no test op in the patch body; old code uses `$expand=all`.

- [ ] **Step 3: Implement**

Replace `removeTagFromWorkItem` in `src/sdk/azure-devops-client.ts` with:

```ts
/**
 * Remove a tag from a work item's `System.Tags` (case-insensitive). No-op if the
 * tag isn't present. Uses a `replace` patch — `add` on System.Tags merges rather
 * than overwriting, so it would never actually remove anything.
 *
 * The rewrite replaces the WHOLE tag string, and hours can pass between item
 * discovery and this call — so re-read the tags fresh and guard the PATCH with
 * a `test` op on `rev`. On a conflict (someone edited the item in the window
 * between our GET and PATCH), re-read and retry once.
 */
export async function removeTagFromWorkItem(
  config: AppConfig,
  workItemId: number,
  tagToRemove: string,
): Promise<void> {
  const tagLower = tagToRemove.toLowerCase();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const getPath = `wit/workitems/${workItemId}?fields=System.Tags&api-version=7.0`;
    const workItem = await adoFetchWithRetry<WorkItemResponse>(config, getPath);
    const remaining = String(workItem.fields['System.Tags'] ?? '')
      .split(';')
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.toLowerCase() !== tagLower);

    try {
      await adoFetchWithRetry<WorkItemResponse>(
        config,
        `wit/workitems/${workItemId}?api-version=7.0`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json-patch+json' },
          body: JSON.stringify([
            { op: 'test', path: '/rev', value: workItem.rev },
            { op: 'replace', path: '/fields/System.Tags', value: remaining.join('; ') },
          ]),
        },
      );
      return;
    } catch (err) {
      const conflict =
        err instanceof AzureDevOpsError &&
        (err.statusCode === 409 || err.statusCode === 412 || err.statusCode === 400);
      if (!conflict || attempt === 2) throw err;
      // rev moved between GET and PATCH — loop re-reads and retries once
    }
  }
}
```

(ADO reports a failed `test` op as 409 in most API versions; 412/400 are covered defensively — a genuine 400 from a malformed body will still fail on the second attempt and surface.)

- [ ] **Step 4: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: PASS — update any pre-existing `removeTagFromWorkItem` tests that asserted the old single-op body or the `$expand=all` GET.

- [ ] **Step 5: Commit**

```bash
git add src/sdk/azure-devops-client.ts tests/sdk/azure-devops-client.test.ts
git commit -m "fix: rev-guard the System.Tags rewrite in removeTagFromWorkItem

The whole-string tag replace could silently drop tags added by humans during
the hours-long agent run. Fresh fields-only read + JSON-Patch test op on rev,
with one re-read retry on conflict.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Agent cwd fix + honest --dry-run text (findings 5/6)

The agent runs with `cwd: config.workspaceOutputDir` while the skills it depends on live under the repo's `.claude/` — `settingSources: ['project']` resolves relative to `cwd`, so skill discovery from a subdirectory is at best unverified. Point `cwd` at the process working directory (the repo root, where `.claude/` lives) and grant the output dirs via `additionalDirectories`. Also fix the `--dry-run` help text, which advertises "Read-only mode" while the agent still provisions environments and publishes apps at full cost.

**Files:**
- Modify: `src/services/orchestrator-agent.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/services/orchestrator-agent.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: agent options with `cwd: process.cwd()` and `additionalDirectories: [continiaBankingPath, workspaceOutputDir, pteOutputDir]`. All paths the agent writes to are passed absolutely in the runtime block, so no relative-path behavior changes.

- [ ] **Step 1: Write failing test**

In `tests/services/orchestrator-agent.test.ts`, find the existing test that asserts `options.cwd`/`additionalDirectories` (around the `settingSources` assertions) and update/add:

```ts
  test('runs the agent from the project root so .claude skills resolve', async () => {
    const captured: Record<string, unknown>[] = [];
    const deps = {
      query: (params: { prompt: string; options: Record<string, unknown> }) => {
        captured.push(params.options);
        return (async function* () {
          yield { type: 'result', subtype: 'success', result: '```json\n{"status":"failed","errorMessage":"x"}\n```' };
        })();
      },
    };
    await runOrchestrator(mockConfig(), mockContext(), deps);
    expect(captured[0]!['cwd']).toBe(process.cwd());
    expect(captured[0]!['additionalDirectories']).toEqual([
      './continia-banking',
      './output',
      './output',
    ]);
  });
```

(Adapt helper names to the file's existing `mockConfig`/context factory; the config fixture uses `./continia-banking` and `./output` for both output dirs.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/orchestrator-agent.test.ts`
Expected: FAIL — `cwd` is `./output`, `additionalDirectories` has one entry.

- [ ] **Step 3: Implement**

In `src/services/orchestrator-agent.ts` `buildOptions`, replace

```ts
    cwd: config.workspaceOutputDir,
    additionalDirectories: [config.continiaBankingPath],
```

with:

```ts
    // Run from the app root: settingSources ['project'] resolves .claude/
    // (skills, commands) relative to cwd, and the skills are the whole
    // orchestration. Output dirs are granted explicitly; the runtime block
    // hands the agent absolute paths for everything it writes.
    cwd: process.cwd(),
    additionalDirectories: [
      config.continiaBankingPath,
      config.workspaceOutputDir,
      config.pteOutputDir,
    ],
```

- [ ] **Step 4: Fix the --dry-run wording**

In `src/cli/index.ts`:
1. HELP option line → `--dry-run        Skip Azure DevOps writes. The agent still runs at full cost: it provisions a BC environment and publishes apps.`
2. Both `[DRY RUN] No writes will be made to Azure DevOps\n` console lines → `[DRY RUN] Azure DevOps writes are skipped — the agent still runs at full cost (provisions an environment, publishes apps)\n`.
3. The `test-item` line `[DRY RUN] Testing processing for work item #...` gets the same clarification appended: `(no ADO writes; agent runs at full cost)`.

- [ ] **Step 5: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/orchestrator-agent.ts src/cli/index.ts tests/services/orchestrator-agent.test.ts
git commit -m "fix: run agent from project root for reliable skill discovery; honest --dry-run text

settingSources ['project'] resolves .claude/ relative to cwd, which pointed
at the output dir. --dry-run claimed read-only while provisioning
environments at full cost.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Optional watcher concurrency (finding 5)

Items are processed strictly sequentially while the dominant costs (env provisioning, AL compile) are independent per item. Add a `WATCH_CONCURRENCY` knob, default 1 (current behavior preserved).

**Files:**
- Modify: `src/config/index.ts`, `src/types/index.ts`
- Modify: `src/services/watcher.ts`
- Modify: `src/cli/index.ts` (HELP env list), `.env.example` / `.env.create-scripts.example`
- Test: `tests/services/watcher.test.ts`, `tests/config/config.test.ts`, plus every `mockConfig`-style fixture (`tests/services/processor.test.ts`, `tests/sdk/azure-devops-client.test.ts`, `tests/services/orchestrator-agent.test.ts`, `tests/services/pruner.test.ts`, `tests/services/pruner.integration.test.ts`, `tests/services/watcher.test.ts`)

**Interfaces:**
- Consumes: `AppConfig`.
- Produces: `AppConfig.watchConcurrency: number` (env `WATCH_CONCURRENCY`, int, min 1, default 1). `runPollCycle` semantics unchanged at concurrency 1.

- [ ] **Step 1: Write failing tests**

Add to `tests/config/config.test.ts`:

```ts
  test('defaults WATCH_CONCURRENCY to 1 and coerces values', () => {
    expect(loadConfig(baseEnv()).watchConcurrency).toBe(1);
    expect(loadConfig({ ...baseEnv(), WATCH_CONCURRENCY: '3' }).watchConcurrency).toBe(3);
  });
```

(`baseEnv()` = whatever minimal-valid env helper that file already uses; inline the three required vars if there is none.)

Add to `tests/services/watcher.test.ts`:

```ts
  test('processes items concurrently up to watchConcurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2, 3, 4].map((id) => ({ id, fields: {}, rev: 1, url: '' }));
    const deps: WatcherDeps = {
      fetchItems: async () => items,
      processItem: async (_c, item) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return { itemId: item.id, processed: true, costUsd: 1 };
      },
      pruneOutputs: () => 0,
    };
    const result = await runPollCycle(mockConfig({ watchConcurrency: 2 }), deps);
    expect(result.processed).toBe(4);
    expect(result.costUsd).toBe(4);
    expect(maxActive).toBe(2);
  });

  test('stays sequential at the default concurrency of 1', async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2].map((id) => ({ id, fields: {}, rev: 1, url: '' }));
    const deps: WatcherDeps = {
      fetchItems: async () => items,
      processItem: async (_c, item) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { itemId: item.id, processed: true };
      },
      pruneOutputs: () => 0,
    };
    await runPollCycle(mockConfig({ watchConcurrency: 1 }), deps);
    expect(maxActive).toBe(1);
  });
```

(Adapt `mockConfig` to that file's fixture; it takes overrides or edit the literal.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/watcher.test.ts tests/config/config.test.ts`
Expected: FAIL — `watchConcurrency` doesn't exist (typecheck/compile error is the failure mode here; that counts).

- [ ] **Step 3: Implement config + type**

`src/config/index.ts`: add to the schema `WATCH_CONCURRENCY: z.coerce.number().int().min(1).default(1),` and to the returned object `watchConcurrency: parsed.WATCH_CONCURRENCY,`.

`src/types/index.ts`: add to `AppConfig`:

```ts
  /** Max work items processed in parallel per poll cycle. 1 = sequential (default). */
  watchConcurrency: number;
```

Add `watchConcurrency: 1,` to every `mockConfig`/inline `AppConfig` fixture in the test files listed above (typecheck will point at each).

- [ ] **Step 4: Implement the worker pool**

In `src/services/watcher.ts`, replace the `for (const item of items)` loop in `runPollCycle` with:

```ts
  const queue = [...items];
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      try {
        const result = await deps.processItem(config, item);
        totalCostUsd += result.costUsd ?? 0;
        if (result.processed) totalProcessed++;
        else totalErrors++;
      } catch (err) {
        log(`  Item #${item.id}: Fatal error — ${err}`);
        totalErrors++;
      }
    }
  };
  const workerCount = Math.min(Math.max(1, config.watchConcurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
```

- [ ] **Step 5: Document the knob**

`src/cli/index.ts` HELP env list, after `POLL_INTERVAL_MINUTES`: `WATCH_CONCURRENCY         Max items processed in parallel per cycle (default: 1)`. Add `WATCH_CONCURRENCY=1` with a one-line comment to `.env.example` and `.env.create-scripts.example`.

- [ ] **Step 6: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ tests/ .env.example .env.create-scripts.example
git commit -m "feat: WATCH_CONCURRENCY knob for parallel item processing (default 1)

Env provisioning and AL compile dominate a cycle and are independent per
item; sequential-only processing was the throughput ceiling.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Hygiene — dead code and stale docs (finding 6)

**Files:**
- Modify: `src/config/index.ts`, `src/types/index.ts`
- Modify: `src/sdk/azure-devops-client.ts` (remove `updateWorkItemField`)
- Delete: `.claude/commands/do-process-item.md`
- Modify: `README.md`, `CLAUDE.md`, `.env.example` / `.env.create-scripts.example`
- Test: `tests/config/config.test.ts`, `tests/sdk/azure-devops-client.test.ts`, `tests/integration/end-to-end.test.ts`, and every fixture that sets `wiqlQuery`

**Interfaces:**
- Consumes: nothing.
- Produces: `AppConfig` without `wiqlQuery`; SDK without `updateWorkItemField`. `queryWorkItems(config, wiql)` (the generic WIQL runner) STAYS — `queryTaggedWorkItems` and the diagnose script use it.

- [ ] **Step 1: Remove wiqlQuery from config and type**

- `src/config/index.ts`: delete the `DEFAULT_WIQL` const, the `AZURE_DEVOPS_WIQL_QUERY` schema line, and the `wiqlQuery: parsed.AZURE_DEVOPS_WIQL_QUERY,` return line.
- `src/types/index.ts`: delete `wiqlQuery: string;` from `AppConfig`.
- `tests/config/config.test.ts`: delete the two assertions on `config.wiqlQuery` (lines ~48 and ~57) and any `AZURE_DEVOPS_WIQL_QUERY` env inputs feeding them.
- Every test fixture setting `wiqlQuery:` (processor, sdk, orchestrator-agent, pruner ×2, watcher tests): delete the property. Typecheck finds them all.
- `tests/integration/end-to-end.test.ts`: it queries with `config.wiqlQuery` three times — replace with a local constant at the top of the file:

```ts
const SMOKE_WIQL =
  "SELECT [System.Id] FROM workitems WHERE [System.State] = 'New' ORDER BY [System.CreatedDate] DESC";
```

and use `queryWorkItems(config, SMOKE_WIQL)` in those three places.
- Grep and remove `AZURE_DEVOPS_WIQL_QUERY` lines from `.env.example` / `.env.create-scripts.example` if present.

- [ ] **Step 2: Remove updateWorkItemField**

Delete the function from `src/sdk/azure-devops-client.ts:119-131`, its import in `tests/sdk/azure-devops-client.test.ts:11`, and the `describe('updateWorkItemField', ...)` block (~line 257).

- [ ] **Step 3: Remove the leftover template command**

```bash
git rm .claude/commands/do-process-item.md
```

Then open `README.md`, find the reference to `do-process-item` (~line 43), and delete or reword that line. While there, fix any remaining "DevOpsPullTemplate" generic-template framing in the README intro to describe this pipeline (one sentence: watches ADO for `create script`-tagged items and produces a recording script, demo-data PTE, and running BC environment per item).

- [ ] **Step 4: Update CLAUDE.md**

In `CLAUDE.md`:
1. Replace the `## Project Overview` paragraph with:

```markdown
## Project Overview

CreateScriptsForVideos watches Azure DevOps for work items tagged `create script` and turns each one into a complete demo package for a Continia Banking feature: a Markdown recording script, a demo-data PTE (AL extension), and a running Business Central environment with everything published. Orchestration lives in `.claude/commands/create-script.md` (the agent's system prompt) and the `.claude/skills/` set; the TypeScript in `src/` is the watcher/processor shell around the agent.
```

2. In `## File Layout`, delete the `- src/state/ — JSON persistence` line and add:

```markdown
- `src/cli/` — entrypoint (`watch`, `run-once`, `test-item`)
- `.claude/commands/create-script.md` — orchestration prompt (system prompt for the agent)
- `.claude/skills/` — demo-data-orchestrator, demo-data-validator, demo-spec-generator, continia-* deploy/test skills
```

3. In `## Key Patterns`, delete the WIQL bullet if it says WIQL queries drive discovery generically; replace with `- **Tag-driven discovery** — WIQL narrows to candidates by tag substring + area path; exact tag match in code`.

- [ ] **Step 5: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: PASS.

```bash
grep -rn "wiqlQuery\|AZURE_DEVOPS_WIQL_QUERY\|updateWorkItemField\|do-process-item" --include="*.ts" --include="*.md" src/ tests/ scripts/ README.md CLAUDE.md .claude/ .env.example .env.create-scripts.example
```
Expected: no hits (docs/plans/ historical mentions are fine and excluded here).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove dead wiqlQuery config, updateWorkItemField, and template leftovers; refresh docs

CLAUDE.md documented a src/state/ that no longer exists and described the
generic template rather than this pipeline.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Out of Scope

- Finding 3 (persistent research cache / feeding validator findings back into the skill references) — explicitly deferred by the user.
- Any change inside the read-only `continia-banking` repo.
- Runtime execution of the generated PTE from TypeScript (verification stays inside the BC install trigger + deploy loop).

## Execution Order & Dependencies

Tasks 1 → 2 must run in that order (same files). Task 3 must precede Tasks 4–5 (shared `processor.ts`/`orchestrator-agent.ts` regions: `botFooter`, comment builders). Task 6 must precede Tasks 7–8 (retry signature). Tasks 9–11 are independent of each other but run last so fixture churn (10, 11) doesn't conflict with earlier edits. Sequential execution in the listed order is safe and recommended.
