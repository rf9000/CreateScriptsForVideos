# Recording Exploration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the recording agent click through the real Business Central flow off camera (Playwright MCP) before it writes `recording.yml`, so the recording is one linear path with real captions instead of a guess with "if the wizard shows X" branches.

**Architecture:** Before the recording stage, plain pipeline code signs in to the item's environment, copies the demo company to a scratch company (`EXPLORE`) with BC's own replay engine, and saves the signed-in browser state. The recording stage then gets a Playwright MCP server (headless Chromium, the image's own build) that starts from that state in the scratch company. The agent explores there, writes `exploration.md` with the path it saw, and only then writes `recording.yml`, which the existing symbol check still gates. The video itself is unchanged: BC's replay engine plays `recording.yml` in the real demo company.

**Tech Stack:** Bun + TypeScript, `@anthropic-ai/claude-agent-sdk` 0.3.x (`Options.mcpServers`), `@playwright/mcp` (pinned), `playwright` 1.55.1 (already in the image), BC Page Scripting via `window.DN.playRecording`.

**Spec:** this plan; the design was agreed in conversation on 2026-10-21 ("Exploring the flow before writing the recording").

## Gate

Start only after a `create video` run of item 84919 produces a video that ends on the **Connect Bank Account** click. Until then the recorder itself is not proven, and exploration would hide its failures.

## Global Constraints

- The continia-banking repo stays read-only; exploration writes only under `output/<id>/`.
- Exploration never runs in the demo company the video uses. All agent browsing happens in company `EXPLORE`.
- The agent never sees the environment password: it gets a saved browser state, not credentials.
- A failed exploration setup never fails the item: the recording stage runs as today, and the run notes say exploration was skipped.
- Pin `@playwright/mcp` to an exact version in `package.json`; no `npx`/`bunx` download at runtime.
- The MCP browser is the image's Chromium (`chromium.executablePath()` from `playwright` 1.55.1), never a second download.
- Comments and prompts follow the repo's style: plain English, short sentences.

## Review Focus

- The signed-in state expires (BC session cookie lifetime) during a long recording stage: the agent should get a clear "sign-in page" snapshot and the run should still finish with the no-exploration path, not hang. Test: Task 4 Step 1 `exploration setup failure falls back` covers setup; the prompt in Task 5 tells the agent to stop exploring if it sees a sign-in page.
- Copy Company is slow (minutes) or the company name already exists from an earlier run on a reused environment: the copy must be skipped when `EXPLORE` exists. Test: Task 2 `skips the copy when EXPLORE already exists`.
- The agent navigates without `company=EXPLORE` and changes demo-company data: every URL the agent is given carries the company, and the prompt forbids removing it. Test: Task 3 `exploration URL always names the company`.
- Chromium version mismatch between `@playwright/mcp`'s bundled `playwright-core` and the installed browser: the server must be started with `--executable-path`. Test: Task 3 `MCP args point at the image's Chromium`.
- Resume (`test-item --resume`) after exploration already ran: setup is idempotent and reuses the saved state file. Test: Task 4 `resume reuses the exploration`.

---

## File Structure

- Create `src/video/explore.ts`: everything exploration needs from the browser side. Builds the Copy Company recording, runs it, saves the signed-in state, and builds the MCP server config.
- Modify `src/video/bc-session.ts`: split the off-camera sign-in out of `openSession` (`signIn`), and let `startUrl` take a company.
- Modify `src/services/agent-stage.ts`: `runAgentStage` and `buildStageOptions` accept optional extra `mcpServers`.
- Modify `src/services/pipeline.ts`: run exploration setup before the recording stage; pass the server and an "## Exploration" prompt block.
- Modify `prompts/recording.md`: new section 0 "Walk the flow first".
- Modify `package.json`: add `@playwright/mcp`.
- Tests: `tests/video/explore.test.ts` (new), `tests/video/recorder.test.ts`, `tests/services/agent-stage.test.ts`, `tests/services/pipeline.test.ts`.

---

### Task 1: Sign-in split and company-aware URLs

**Files:**
- Modify: `src/video/bc-session.ts` (`startUrl`, `openSession`)
- Test: `tests/video/recorder.test.ts` (`describe('startUrl')`)

**Interfaces:**
- Produces: `startUrl(base: string, profile?: string, pageId?: number | string, company?: string): string`
- Produces: `signIn(browser: Browser, opts: { url: string; profile?: string; pageId?: number | string; user: string; password: string }): Promise<{ context: BrowserContext; page: Page; landed: string }>` — returns the still-open, signed-in context (the caller closes it).

- [ ] **Step 1: Write the failing test**

Add to `describe('startUrl')` in `tests/video/recorder.test.ts`:

```ts
  test('names the company when given one', () => {
    expect(startUrl('https://bc/env-1/', 'BUSINESS MANAGER', 71553588, 'EXPLORE'))
      .toBe('https://bc/env-1/?profile=BUSINESS%20MANAGER&page=71553588&company=EXPLORE');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/video/recorder.test.ts`
Expected: FAIL, the URL has no `company` parameter.

- [ ] **Step 3: Implement**

In `src/video/bc-session.ts`, change `startUrl`:

```ts
/** Web client URL with profile, optionally the start page as a deep link, and the company. */
export function startUrl(base: string, profile?: string, pageId?: number | string, company?: string): string {
  const url = new URL(base);
  if (profile) url.searchParams.set('profile', profile);
  if (pageId !== undefined) url.searchParams.set('page', String(pageId));
  if (company) url.searchParams.set('company', company);
  return url.toString().replaceAll('+', '%20');
}
```

Move the sign-in half of `openSession` into `signIn` and call it from `openSession`:

```ts
/** Sign in off camera and answer first-run dialogs. The caller closes the returned context. */
export async function signIn(
  browser: Browser,
  opts: { url: string; profile?: string; pageId?: number | string; user: string; password: string },
): Promise<{ context: BrowserContext; page: Page; landed: string }> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(startUrl(opts.url, opts.profile, opts.pageId));
  const userInput = page.locator('input[name=UserName]');
  if (await userInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await userInput.fill(opts.user);
    await page.fill('input[name=Password]', opts.password);
    await Promise.all([page.waitForNavigation({ timeout: NAV_TIMEOUT_MS }), page.click('button[type=submit]')]);
  }
  await awaitFrame(page);
  await dismissStartupDialogs(page);
  return { context, page, landed: page.url() };
}
```

In `openSession`, replace the sign-in lines (from `const auth = await browser.newContext(...)` through `const landed = authPage.url();`) with:

```ts
  const { context: auth, page: authPage, landed } = await signIn(browser, opts);
```

Keep the rest of `openSession` (deep-link warm-up, cookies, recorded context) as it is.

- [ ] **Step 4: Run tests**

Run: `bun test tests/video && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/video/bc-session.ts tests/video/recorder.test.ts
git commit -m "refactor(video): split off-camera sign-in; startUrl takes a company"
```

---

### Task 2: Scratch company and saved browser state

**Files:**
- Create: `src/video/explore.ts`
- Test: `tests/video/explore.test.ts`

**Interfaces:**
- Consumes: `signIn`, `startUrl`, `play`, `awaitFrame` from `src/video/bc-session.ts`.
- Produces:
  - `export const EXPLORE_COMPANY = 'EXPLORE'`
  - `export function copyCompanyRecording(names: CopyCompanyNames): Recording`
  - `export type CopyCompanyNames = { companiesPage: string; repeater: string; copyAction: string; copyPage: string; newNameField: string; okAction: string }`
  - `export async function prepareExploration(opts: { url: string; user: string; password: string; itemDir: string }, names?: CopyCompanyNames): Promise<{ storageStatePath: string; startUrl: string }>`

- [ ] **Step 1: Discover the real page, action and field names**

On a deployed item (the PTE folder holds Microsoft's symbols after deploy), run:

```bash
bun src/cli/index.ts symbols output/84919/pte "Companies"
bun src/cli/index.ts symbols output/84919/pte "Copy Company"
```

Copy the exact page name, repeater name, the Copy action name, the copy page's new-name field and its OK action into `COPY_COMPANY_NAMES` below. Don't guess them: the recording check and BC's engine both match by name.

- [ ] **Step 2: Write the failing tests**

`tests/video/explore.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import { copyCompanyRecording, EXPLORE_COMPANY } from '../../src/video/explore.ts';
import { lintRecording } from '../../src/video/recording.ts';

const names = {
  companiesPage: 'Companies', repeater: 'Control1', copyAction: 'CopyCompany',
  copyPage: 'Copy Company', newNameField: 'New Company Name', okAction: 'OK',
};

describe('copyCompanyRecording', () => {
  test('opens Companies, copies the current company to EXPLORE and proves it', () => {
    const rec = copyCompanyRecording(names);
    expect(rec.start).toEqual({ profile: 'BUSINESS MANAGER', pageId: 357 });
    expect(rec.steps.map((s) => s.type)).toEqual(['invoke', 'page-shown', 'input', 'invoke', 'validate']);
    expect(rec.steps[2]!.value).toBe(EXPLORE_COMPANY);
    expect(lintRecording(rec)).toEqual([]);
  });
});
```

Add the idempotency test the Review Focus asks for (the copy is skipped when the company exists), using an injected `companyExists` check:

```ts
import { prepareExplorationWith } from '../../src/video/explore.ts';

test('skips the copy when EXPLORE already exists', async () => {
  const calls: string[] = [];
  const result = await prepareExplorationWith(
    { url: 'https://bc/env-1/', user: 'u', password: 'p', itemDir: '/out/42' },
    {
      companyExists: async () => true,
      copyCompany: async () => { calls.push('copy'); },
      saveState: async (path) => { calls.push(`save ${path}`); },
    },
  );
  expect(calls).toEqual([`save ${result.storageStatePath}`]);
  expect(result.startUrl).toContain('company=EXPLORE');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/video/explore.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `src/video/explore.ts`**

```ts
import { join } from 'path';
import { chromium } from 'playwright';
import type { Recording } from './recording.ts';
import { awaitFrame, play, signIn, startUrl } from './bc-session.ts';

/**
 * Off-camera exploration support. The recording agent browses a copy of the demo
 * company, so nothing it clicks changes the data the video starts from.
 */

export const EXPLORE_COMPANY = 'EXPLORE';
const COMPANIES_PAGE_ID = 357;

export type CopyCompanyNames = {
  companiesPage: string; repeater: string; copyAction: string;
  copyPage: string; newNameField: string; okAction: string;
};

/** Names from the symbols (Task 2 Step 1); BC matches recordings by name. */
export const COPY_COMPANY_NAMES: CopyCompanyNames = {
  companiesPage: 'Companies', repeater: 'Control1', copyAction: 'CopyCompany',
  copyPage: 'Copy Company', newNameField: 'New Company Name', okAction: 'OK',
};

/** Companies -> current row -> Copy -> name EXPLORE -> OK, then prove the row exists. */
export function copyCompanyRecording(n: CopyCompanyNames): Recording {
  return {
    name: 'Copy demo company for exploration',
    description: `Copy the demo company to ${EXPLORE_COMPANY}`,
    start: { profile: 'BUSINESS MANAGER', pageId: COMPANIES_PAGE_ID },
    steps: [
      { type: 'invoke', target: [{ page: n.companiesPage }, { action: n.copyAction }], description: 'Invoke <caption>Copy</caption>' },
      { type: 'page-shown', source: { page: n.copyPage }, modal: true, runtimeId: 'p2', description: `Page <caption>${n.copyPage}</caption> was shown.` },
      { type: 'input', target: [{ page: n.copyPage, runtimeRef: 'p2' }, { field: n.newNameField }], value: EXPLORE_COMPANY, description: `Input <value>${EXPLORE_COMPANY}</value>` },
      { type: 'invoke', target: [{ page: n.copyPage, runtimeRef: 'p2' }, { action: n.okAction }], description: 'Invoke <caption>OK</caption>' },
      { type: 'validate', target: [{ page: n.companiesPage }, { repeater: n.repeater }, { field: 'Name' }], operation: '=', value: EXPLORE_COMPANY, description: `Validate <caption>Name</caption> <operation>is</operation> <value>${EXPLORE_COMPANY}</value>` },
    ],
  };
}

export type ExploreIo = {
  companyExists: () => Promise<boolean>;
  copyCompany: () => Promise<void>;
  saveState: (path: string) => Promise<void>;
};

export async function prepareExplorationWith(
  opts: { url: string; user: string; password: string; itemDir: string },
  io: ExploreIo,
): Promise<{ storageStatePath: string; startUrl: string }> {
  if (!(await io.companyExists())) await io.copyCompany();
  const storageStatePath = join(opts.itemDir, 'explore', 'storage-state.json');
  await io.saveState(storageStatePath);
  return { storageStatePath, startUrl: startUrl(opts.url, 'BUSINESS MANAGER', undefined, EXPLORE_COMPANY) };
}

/** Sign in, copy the company if needed, save the signed-in state for the MCP browser. */
export async function prepareExploration(
  opts: { url: string; user: string; password: string; itemDir: string },
  names: CopyCompanyNames = COPY_COMPANY_NAMES,
): Promise<{ storageStatePath: string; startUrl: string }> {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page } = await signIn(browser, { url: opts.url, user: opts.user, password: opts.password, pageId: COMPANIES_PAGE_ID });
    return await prepareExplorationWith(opts, {
      companyExists: async () => {
        const frame = await awaitFrame(page);
        return (await frame.getByRole('gridcell', { name: EXPLORE_COMPANY, exact: true }).count()) > 0;
      },
      copyCompany: async () => {
        const result = await play(page, copyCompanyRecording(names));
        if (result.error) throw new Error(`copy company failed: ${JSON.stringify(result.error)}`);
      },
      saveState: async (path) => {
        await context.storageState({ path });
      },
    });
  } finally {
    await browser.close();
  }
}
```

If Step 1 showed different names, update `COPY_COMPANY_NAMES` and the test's `names` to match.

- [ ] **Step 5: Run tests**

Run: `bun test tests/video && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Verify on a real environment**

On the VM, inside the container, with item 84919's environment:

```bash
bun -e "import { prepareExploration } from './src/video/explore.ts'; console.log(await prepareExploration({ url: process.env.U, user: process.env.N, password: process.env.P, itemDir: '/app/output/84919' }))"
```

Expected: prints the state path and an URL with `company=EXPLORE`; `ls /app/output/84919/explore/` shows `storage-state.json`; opening Companies shows `EXPLORE`. Run it twice: the second run takes seconds (no copy).

- [ ] **Step 7: Commit**

```bash
git add src/video/explore.ts tests/video/explore.test.ts
git commit -m "feat(video): scratch company and saved sign-in for off-camera exploration"
```

---

### Task 3: Playwright MCP server for one stage

**Files:**
- Modify: `package.json` (dependency)
- Modify: `src/services/agent-stage.ts` (`buildStageOptions`, `runAgentStage`)
- Modify: `src/video/explore.ts` (`playwrightMcpServer`)
- Test: `tests/services/agent-stage.test.ts`, `tests/video/explore.test.ts`

**Interfaces:**
- Consumes: `prepareExploration` result from Task 2.
- Produces:
  - `export function playwrightMcpServer(o: { storageStatePath: string; outputDir: string; executablePath?: string }): McpStdioServerConfig`
  - `buildStageOptions(config, stage, systemAppend, outputSchema, abortController, extra?: { mcpServers?: Record<string, McpServerConfig> }): Options`
  - `runAgentStage(config, stage, promptNames, prompt, schema, deps?, extra?: { mcpServers?: Record<string, McpServerConfig> })`

- [ ] **Step 1: Add the dependency**

```bash
npm view @playwright/mcp version
bun add @playwright/mcp@<the version printed>   # exact version, no caret
```

Check `package.json` shows the exact version with no `^`. The server binary is `node_modules/.bin/mcp-server-playwright`.

- [ ] **Step 2: Write the failing tests**

`tests/video/explore.test.ts`:

```ts
import { playwrightMcpServer } from '../../src/video/explore.ts';

test('MCP args point at the image\'s Chromium and the saved state, headless and isolated', () => {
  const s = playwrightMcpServer({ storageStatePath: '/out/42/explore/storage-state.json', outputDir: '/out/42/explore', executablePath: '/ms-playwright/chromium/chrome' });
  expect(s.command).toMatch(/mcp-server-playwright$/);
  expect(s.args).toEqual([
    '--headless', '--isolated', '--browser', 'chromium',
    '--executable-path', '/ms-playwright/chromium/chrome',
    '--storage-state', '/out/42/explore/storage-state.json',
    '--output-dir', '/out/42/explore',
    '--viewport-size', '1920,1080',
  ]);
});

test('exploration URL always names the company', async () => {
  const r = await prepareExplorationWith(
    { url: 'https://bc/env-1/?company=CRONUS', user: 'u', password: 'p', itemDir: '/o' },
    { companyExists: async () => true, copyCompany: async () => {}, saveState: async () => {} },
  );
  expect(new URL(r.startUrl).searchParams.get('company')).toBe('EXPLORE');
});
```

`tests/services/agent-stage.test.ts`:

```ts
test('extra MCP servers reach the stage options', () => {
  const options = buildStageOptions(testConfig(), 'recording', '', {}, new AbortController(), {
    mcpServers: { playwright: { type: 'stdio', command: 'x', args: [] } },
  });
  expect(options.mcpServers).toEqual({ playwright: { type: 'stdio', command: 'x', args: [] } });
});

test('no extra servers: options carry none', () => {
  expect(buildStageOptions(testConfig(), 'generate', '', {}, new AbortController()).mcpServers).toBeUndefined();
});
```

(Use the file's existing imports for `buildStageOptions` and `testConfig`; add them if missing.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/video/explore.test.ts tests/services/agent-stage.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

`src/video/explore.ts`:

```ts
import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';

const MCP_BIN = join(import.meta.dir, '..', '..', 'node_modules', '.bin', 'mcp-server-playwright');

/** Headless Playwright MCP on the image's Chromium, signed in through the saved state. */
export function playwrightMcpServer(o: { storageStatePath: string; outputDir: string; executablePath?: string }): McpStdioServerConfig {
  return {
    type: 'stdio',
    command: MCP_BIN,
    args: [
      '--headless', '--isolated', '--browser', 'chromium',
      '--executable-path', o.executablePath ?? chromium.executablePath(),
      '--storage-state', o.storageStatePath,
      '--output-dir', o.outputDir,
      '--viewport-size', '1920,1080',
    ],
  };
}
```

`src/services/agent-stage.ts`: add `extra` as the last parameter of `buildStageOptions` and set it on the options:

```ts
export type StageExtras = { mcpServers?: Record<string, McpServerConfig> };
// in buildStageOptions(..., abortController: AbortController, extra: StageExtras = {}):
  if (extra.mcpServers) options.mcpServers = extra.mcpServers;
```

and thread it through `runAgentStage(config, stage, promptNames, prompt, schema, deps = defaultAgentStageDeps, extra: StageExtras = {})` into its `buildStageOptions` call. Import `McpServerConfig` from `@anthropic-ai/claude-agent-sdk`.

- [ ] **Step 5: Run tests**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/video/explore.ts src/services/agent-stage.ts tests/video/explore.test.ts tests/services/agent-stage.test.ts
git commit -m "feat(agent): Playwright MCP server for a stage, on the image's Chromium"
```

---

### Task 4: Pipeline wiring

**Files:**
- Modify: `src/services/pipeline.ts` (`PipelineDeps`, `defaultPipelineDeps`, section G)
- Test: `tests/services/pipeline.test.ts`

**Interfaces:**
- Consumes: `prepareExploration`, `playwrightMcpServer`, `runAgentStage(..., extra)`.
- Produces: `PipelineDeps.prepareExploration: (opts: { url: string; user: string; password: string; itemDir: string }) => Promise<{ storageStatePath: string; startUrl: string }>`

- [ ] **Step 1: Write the failing tests**

In `tests/services/pipeline.test.ts`, add `prepareExploration: mock(async () => ({ storageStatePath: '/out/42/explore/storage-state.json', startUrl: 'https://bc/env-1/?company=EXPLORE' }))` to `makeDeps`, then:

```ts
describe('runPipeline — exploration', () => {
  test('the recording stage gets the browser and an Exploration block', async () => {
    const { deps, query } = makeDeps();
    await runPipeline(testConfig(), context, { mode: 'video' }, deps);
    const call = query.mock.calls[3]![0];
    expect(Object.keys(call.options.mcpServers ?? {})).toEqual(['playwright']);
    expect(call.prompt).toContain('## Exploration');
    expect(call.prompt).toContain('company=EXPLORE');
    expect(call.prompt).not.toMatch(/\bpw\b/); // never the password (fakeCli's is 'pw')
  });

  test('exploration setup failure falls back to recording without the browser', async () => {
    const { deps, query } = makeDeps();
    deps.prepareExploration.mockImplementation(async () => { throw new Error('copy company failed'); });
    const result = await runPipeline(testConfig(), context, { mode: 'video' }, deps);
    expect(query.mock.calls[3]![0].options.mcpServers).toBeUndefined();
    expect(result.gaps).toContain('video: exploration skipped (copy company failed); the recording follows the script only');
  });

  test('resume reuses the exploration', async () => {
    const { deps } = makeDeps({ saved: { generate: outputs.generate, validate: outputs.validate, profileId: 'profile-1', envId: 'env-1', activated: true, deployGaps: [], mode: 'video' } as PipelineState });
    await runPipeline(testConfig(), context, { resume: true }, deps);
    expect(deps.prepareExploration).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/services/pipeline.ts`:
- Add `prepareExploration` to `PipelineDeps` and `defaultPipelineDeps: prepareExploration: (o) => prepareExploration(o)`.
- In section G, before building `recordingPrompt`:

```ts
      let extra: StageExtras = {};
      let explorationBlock = '';
      let explorationGap: string | undefined;
      try {
        const x = await deps.prepareExploration({ url: env.url, user: env.username, password: env.password, itemDir });
        extra = { mcpServers: { playwright: playwrightMcpServer({ storageStatePath: x.storageStatePath, outputDir: join(itemDir, 'explore') }) } };
        explorationBlock = [
          '## Exploration',
          `- A signed-in browser (the playwright tools) is open on company ${EXPLORE_COMPANY}, a copy of the demo company.`,
          `- Start here: ${x.startUrl}`,
          `- Write what you saw to: ${join(itemDir, 'exploration.md')}`,
        ].join('\n');
      } catch (err) {
        explorationGap = `video: exploration skipped (${err instanceof Error ? err.message : String(err)}); the recording follows the script only`;
        log(`  ${explorationGap}`);
      }
```

  Append `explorationBlock` to `recordingPrompt` when set, and pass `extra` as the last argument of `runAgentStage`. For the gap: declare `const videoGaps: string[] = [];` next to `const stages: StageUsage[] = [];` at the top of `runPipeline`, add `...videoGaps` as the last entry of the `gaps` array in `base()`, and after the catch do `if (explorationGap) videoGaps.push(explorationGap);`. Both the success path and `videoFailed` build on `base()`, so the gap reaches the ADO comment either way.
- The exploration only runs when the recording stage runs (`!state.recordingChecked`), so a resume after a checked recording does not explore again.

- [ ] **Step 4: Run tests**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/pipeline.ts tests/services/pipeline.test.ts
git commit -m "feat(pipeline): recording stage explores the flow in a scratch company first"
```

---

### Task 5: Recording prompt

**Files:**
- Modify: `prompts/recording.md`

- [ ] **Step 1: Add section 0 before "### 1. `recording.yml`"**

```markdown
### 0. Walk the flow first (when the prompt has an "Exploration" section)

A signed-in browser is open on a copy of the demo company. Use the playwright tools to click
through the flow in the recording script, start to end, before you write anything.

- Stay in that company. Every URL you open keeps its `company=` parameter.
- Take a snapshot after every click. Note each page's caption, the fields you used, and the
  buttons you pressed.
- Where the script says "if the wizard shows X", note which page actually came. The recording
  follows what you saw, as one path with no branches.
- Stop at the step that leaves Business Central (a pop-up on another site). The recording ends
  with the click that opens it.
- If you see a sign-in page, stop exploring and write the recording from the script alone; say
  so in `notes`.
- Write what you saw to the exploration file: one line per step, with page caption, action or
  field, and value.
```

- [ ] **Step 2: Adjust the existing rule**

Replace "Keep it to the flow the recording script shows; no extra navigation." with:

```markdown
- Keep it to the flow the recording script shows, as you saw it in the exploration (one path, no
  branches); no extra navigation.
```

- [ ] **Step 3: Verify on a real item**

Retag item 84919 with `create video`. Expected: `output/84919/exploration.md` exists and lists the real page sequence, `recording.yml` has no step for a page that never appeared, and the video passes step 0 through the Connect Bank Account click.

- [ ] **Step 4: Commit**

```bash
git add prompts/recording.md
git commit -m "feat(prompts): recording agent walks the flow before writing the recording"
```
