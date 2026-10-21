# Recording Exploration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the recording agent walk the real Business Central flow off camera before it writes `recording.yml`, so the recording is one linear path with real captions instead of a guess with "if the wizard shows X" branches.

**Architecture:** The recording stage gets the `business-central-mcp` server (pinned `business-central-mcp@1.7.2`), which drives BC's web client protocol directly: open pages by ID, read fields and actions, write fields, run actions, answer dialogs, walk wizards, switch companies. No browser. Before the stage, pipeline code copies the demo company to a scratch company `EXPLORE` with BC's own replay engine, so nothing the agent does changes the data the video starts from. A PreToolUse hook denies every write tool until the agent has switched to `EXPLORE`. The agent writes `exploration.md` with the path it saw, then `recording.yml`, which the existing symbol check still gates. The video itself is unchanged.

**Tech Stack:** Bun + TypeScript, `@anthropic-ai/claude-agent-sdk` 0.3.x (`Options.mcpServers`, `Options.hooks`), `business-central-mcp` 1.7.2 (bin `business-central-mcp` -> `dist/stdio-server.js`, Node >= 20, deps `ws`, `zod`, `cheerio`), BC Page Scripting via `window.DN.playRecording` for the company copy.

**Spec:** this plan; agreed in conversation on 2026-10-21 ("Exploring the flow before writing the recording", then "could this mcp help us").

**Prior art on this machine:** `~/.bc-mcp/start-bc-mcp.mjs` already runs this package against DemoPortal BC 29.0 (platform 29.0.54011.55616, env `bc1da948…`) with `BC_AUTH=NavUserPassword`, the SUPER user from `continia env users`, and a per-environment `STATE_DIR`. The rules for using it live in `~/.claude/CLAUDE.md` ("Business Central MCP") and in the Continia Banking repo's `.claude/rules/BC-MCP/BC-MCP.md`: read-only tools first, write tools only on DemoPortal environments made for the task, always with an `operationId`.

## Gate

Start only after a `create video` run of item 84919 produces a video that ends on the **Connect Bank Account** click. Until then the recorder itself is not proven, and exploration would hide its failures.

## Global Constraints

- The continia-banking repo stays read-only; exploration writes only under `output/<id>/`.
- Every write tool call happens in company `EXPLORE`, never in the demo company the video uses. Enforced in code by a hook, not only by the prompt.
- The agent never sees the environment password. It goes only into the MCP server process's environment, never into the prompt or `agentEnv`.
- Every mutating `bc_*` call carries an `operationId` (the package's replay ledger lives in `STATE_DIR`).
- A failed exploration setup never fails the item: the recording stage runs as today, and the comment's gaps say exploration was skipped.
- Pin `business-central-mcp` to `1.7.2` in `package.json`; no `npx`/`bunx` download at runtime.
- Comments and prompts follow the repo's style: plain English, short sentences.

## Review Focus

- The agent calls a write tool before switching to `EXPLORE`: the hook must deny it with a message that tells the agent to switch first. Test: Task 3 `write tools are denied until the switch to EXPLORE`.
- A read tool (`bc_open_page`, `bc_read_data`, `bc_list_companies`) before the switch must be allowed; exploration starts by looking. Test: Task 3 `read tools are allowed before the switch`.
- Copy Company is slow (minutes) or `EXPLORE` already exists from an earlier run on a reused environment: the copy is skipped when it exists. Test: Task 2 `skips the copy when EXPLORE already exists`.
- The MCP server cannot start under Bun in the image (Node >= 20 engine): Task 1 decides Bun vs Node once, and the server config uses the chosen runtime. Test: Task 3 `server config uses the configured runtime`.
- Resume after exploration already ran: the copy is skipped and `STATE_DIR` is reused. Test: Task 4 `resume skips the copy`.

---

## File Structure

- Create `src/video/explore.ts`: the Copy Company recording and its runner, the MCP server config, and the write guard hook.
- Modify `src/video/bc-session.ts`: split the off-camera sign-in out of `openSession` (`signIn`) for the copy.
- Modify `src/services/agent-stage.ts`: `runAgentStage` and `buildStageOptions` accept optional extra `mcpServers` and `hooks`.
- Modify `src/services/pipeline.ts`: copy the company before the recording stage; pass the server, the hook and an "## Exploration" prompt block.
- Modify `prompts/recording.md`: new section 0 "Walk the flow first".
- Modify `package.json` (and `Dockerfile` only if Task 1 says Node is needed).
- Tests: `tests/video/explore.test.ts` (new), `tests/services/agent-stage.test.ts`, `tests/services/pipeline.test.ts`.

---

### Task 1: Prove the server in the container

**Files:**
- Modify: `package.json` (dependency)
- Modify: `Dockerfile` (only if Step 4 fails under Bun)
- Create: `docs/bc-mcp-spike.md` (the findings, kept for the implementer of Tasks 2-5)

**Interfaces:**
- Produces: `MCP_RUNTIME` decision (`bun` or `node`) and the answer to "how does the server pick a company", both written in `docs/bc-mcp-spike.md`.

- [ ] **Step 1: Add the dependency**

```bash
bun add business-central-mcp@1.7.2
```

Check `package.json` shows `"business-central-mcp": "1.7.2"` with no caret; fix it by hand if bun added one.

- [ ] **Step 2: Read how the package selects the company and names its tools**

```bash
grep -rn "BC_COMPANY\|company=\|BC_TENANT\|BC_BASE_URL" node_modules/business-central-mcp/dist | head -20
grep -rn "name: 'bc_" node_modules/business-central-mcp/dist | head -30
```

Write down in `docs/bc-mcp-spike.md`: the env var or URL parameter that sets the starting company (if any), and the exact tool names. The hook in Task 3 matches these names.

- [ ] **Step 3: Rebuild the image and deploy to the VM**

Commit Step 1, push, then on the VM:

```bash
cd ~/teams/continia-banking/CreateScriptsForVideos && git checkout -- .claude/skills && git pull --ff-only
cd ~/teams/continia-banking && docker compose up -d --build create-scripts-for-videos
```

- [ ] **Step 4: Start the server under Bun against a live environment**

Pick a running item environment (e.g. 84919's). Inside the container, send the MCP `initialize` and `tools/list` requests on stdin:

```bash
docker compose exec -u claude -e BC_BASE_URL=<env url> -e BC_AUTH=NavUserPassword -e BC_USERNAME=<super user> -e BC_PASSWORD=<password> -e STATE_DIR=/app/output/84919/bc-mcp create-scripts-for-videos sh -c 'printf "%s\n%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"spike\",\"version\":\"0\"}}}" "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}" | timeout 60 bun node_modules/.bin/business-central-mcp'
```

Expected: two JSON-RPC responses; the second lists the `bc_*` tools. If Bun fails (crash, missing Node API), repeat with `node` in place of `bun`; if the image has no Node 20, add to the `Dockerfile` apt line `nodejs` from NodeSource 20 and rebuild. Record the runtime that works.

- [ ] **Step 5: One real call on BC 29**

Same command, with a third request:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"bc_list_companies","arguments":{}}}
```

and a fourth opening Bank Account Setup:

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"bc_open_page","arguments":{"pageId":71553588}}}
```

Expected: the company list (includes `CRONUS International Ltd.`), and the wizard's first page with its Next/Finish actions. Record both results (trimmed) in `docs/bc-mcp-spike.md`. If the argument names differ, use the ones from Step 2.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock Dockerfile docs/bc-mcp-spike.md
git commit -m "chore: business-central-mcp 1.7.2, proven against BC 29 in the image"
```

---

### Task 2: Sign-in split and the scratch company

**Files:**
- Modify: `src/video/bc-session.ts` (`openSession` -> `signIn`)
- Create: `src/video/explore.ts`
- Test: `tests/video/explore.test.ts`

**Interfaces:**
- Consumes: `startUrl`, `play`, `awaitFrame`, `dismissStartupDialogs` from `src/video/bc-session.ts`.
- Produces:
  - `export async function signIn(browser: Browser, opts: { url: string; profile?: string; pageId?: number | string; user: string; password: string }): Promise<{ context: BrowserContext; page: Page; landed: string }>` (caller closes `context`)
  - `export const EXPLORE_COMPANY = 'EXPLORE'`
  - `export type CopyCompanyNames = { companiesPage: string; repeater: string; copyAction: string; copyPage: string; newNameField: string; okAction: string }`
  - `export function copyCompanyRecording(names: CopyCompanyNames): Recording`
  - `export async function ensureExploreCompanyWith(io: { companyExists: () => Promise<boolean>; copyCompany: () => Promise<void> }): Promise<'copied' | 'existed'>`
  - `export async function ensureExploreCompany(opts: { url: string; user: string; password: string }): Promise<'copied' | 'existed'>`

- [ ] **Step 1: Discover the real names**

On a deployed item (the PTE folder holds Microsoft's symbols after deploy):

```bash
bun src/cli/index.ts symbols output/84919/pte "Companies"
bun src/cli/index.ts symbols output/84919/pte "Copy Company"
```

Copy the exact page name, repeater name, the Copy action name, the copy page's new-name field and its OK action into `COPY_COMPANY_NAMES`. BC matches recordings by name; don't guess.

- [ ] **Step 2: Write the failing tests**

`tests/video/explore.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import { copyCompanyRecording, ensureExploreCompanyWith, EXPLORE_COMPANY } from '../../src/video/explore.ts';
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

describe('ensureExploreCompanyWith', () => {
  test('skips the copy when EXPLORE already exists', async () => {
    const calls: string[] = [];
    const result = await ensureExploreCompanyWith({ companyExists: async () => true, copyCompany: async () => { calls.push('copy'); } });
    expect(result).toBe('existed');
    expect(calls).toEqual([]);
  });

  test('copies when it does not exist', async () => {
    const calls: string[] = [];
    const result = await ensureExploreCompanyWith({ companyExists: async () => false, copyCompany: async () => { calls.push('copy'); } });
    expect(result).toBe('copied');
    expect(calls).toEqual(['copy']);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `bun test tests/video/explore.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

In `src/video/bc-session.ts`, add `signIn` and use it at the start of `openSession` (replace its lines from `const auth = await browser.newContext(...)` through `const landed = authPage.url();` with `const { context: auth, page: authPage, landed } = await signIn(browser, opts);`):

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

`src/video/explore.ts`:

```ts
import { chromium } from 'playwright';
import type { Recording } from './recording.ts';
import { awaitFrame, play, signIn, startUrl } from './bc-session.ts';

/**
 * Off-camera exploration. The recording agent works in a copy of the demo
 * company, so nothing it clicks changes the data the video starts from.
 */

export const EXPLORE_COMPANY = 'EXPLORE';
const COMPANIES_PAGE_ID = 357;

export type CopyCompanyNames = {
  companiesPage: string; repeater: string; copyAction: string;
  copyPage: string; newNameField: string; okAction: string;
};

/** From the symbols (Task 2 Step 1); BC matches recordings by name. */
export const COPY_COMPANY_NAMES: CopyCompanyNames = {
  companiesPage: 'Companies', repeater: 'Control1', copyAction: 'CopyCompany',
  copyPage: 'Copy Company', newNameField: 'New Company Name', okAction: 'OK',
};

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

export async function ensureExploreCompanyWith(io: {
  companyExists: () => Promise<boolean>;
  copyCompany: () => Promise<void>;
}): Promise<'copied' | 'existed'> {
  if (await io.companyExists()) return 'existed';
  await io.copyCompany();
  return 'copied';
}

/** Sign in, and copy the demo company to EXPLORE unless an earlier run already did. */
export async function ensureExploreCompany(
  opts: { url: string; user: string; password: string },
  names: CopyCompanyNames = COPY_COMPANY_NAMES,
): Promise<'copied' | 'existed'> {
  const browser = await chromium.launch({ headless: true });
  try {
    const { page } = await signIn(browser, { ...opts, profile: 'BUSINESS MANAGER', pageId: COMPANIES_PAGE_ID });
    return await ensureExploreCompanyWith({
      companyExists: async () => {
        const frame = await awaitFrame(page);
        return (await frame.getByRole('gridcell', { name: EXPLORE_COMPANY, exact: true }).filter({ visible: true }).count()) > 0;
      },
      copyCompany: async () => {
        const result = await play(page, copyCompanyRecording(names));
        if (result.error) throw new Error(`copy company failed: ${JSON.stringify(result.error)}`);
      },
    });
  } finally {
    await browser.close();
  }
}
```

If Step 1 showed different names, update `COPY_COMPANY_NAMES` and the test's `names`. `startUrl` is imported only if a later edit needs it; drop the import if unused.

- [ ] **Step 5: Run tests**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Verify on a real environment**

Inside the container, against 84919's environment:

```bash
bun -e "import { ensureExploreCompany } from './src/video/explore.ts'; console.log(await ensureExploreCompany({ url: process.env.U, user: process.env.N, password: process.env.P }))"
```

Expected: `copied` the first time (Companies then lists `EXPLORE`), `existed` the second time within seconds.

- [ ] **Step 7: Commit**

```bash
git add src/video/bc-session.ts src/video/explore.ts tests/video/explore.test.ts
git commit -m "feat(video): copy the demo company to EXPLORE for off-camera exploration"
```

---

### Task 3: MCP server config and the write guard

**Files:**
- Modify: `src/video/explore.ts` (`businessCentralMcpServer`, `exploreWriteGuard`)
- Modify: `src/services/agent-stage.ts` (`StageExtras`, `buildStageOptions`, `runAgentStage`)
- Test: `tests/video/explore.test.ts`, `tests/services/agent-stage.test.ts`

**Interfaces:**
- Consumes: `EXPLORE_COMPANY`; tool names from `docs/bc-mcp-spike.md`.
- Produces:
  - `export const BC_MCP_SERVER = 'business-central'`
  - `export function businessCentralMcpServer(o: { url: string; user: string; password: string; stateDir: string; runtime?: 'bun' | 'node' }): McpStdioServerConfig`
  - `export function exploreWriteGuard(): (toolName: string, input: Record<string, unknown>) => { allow: true } | { allow: false; reason: string }`
  - `export function exploreHooks(guard: ReturnType<typeof exploreWriteGuard>): Options['hooks']`
  - `export type StageExtras = { mcpServers?: Record<string, McpServerConfig>; hooks?: Options['hooks'] }`
  - `buildStageOptions(config, stage, systemAppend, outputSchema, abortController, extra?: StageExtras): Options`
  - `runAgentStage(config, stage, promptNames, prompt, schema, deps?, extra?: StageExtras)`

- [ ] **Step 1: Write the failing tests**

`tests/video/explore.test.ts`:

```ts
import { businessCentralMcpServer, exploreWriteGuard, BC_MCP_SERVER } from '../../src/video/explore.ts';

const tool = (name: string) => `mcp__${BC_MCP_SERVER}__${name}`;

describe('businessCentralMcpServer', () => {
  test('server config uses the configured runtime and passes credentials only in its env', () => {
    const s = businessCentralMcpServer({ url: 'https://bc/env-1', user: 'ADMIN', password: 'pw', stateDir: '/out/42/bc-mcp', runtime: 'bun' });
    expect(s.command).toBe('bun');
    expect(s.args![0]).toMatch(/business-central-mcp[\\/]dist[\\/]stdio-server\.js$/);
    expect(s.env).toEqual({ BC_BASE_URL: 'https://bc/env-1', BC_AUTH: 'NavUserPassword', BC_USERNAME: 'ADMIN', BC_PASSWORD: 'pw', STATE_DIR: '/out/42/bc-mcp' });
  });
});

describe('exploreWriteGuard', () => {
  test('read tools are allowed before the switch', () => {
    const guard = exploreWriteGuard();
    for (const t of ['bc_open_page', 'bc_read_data', 'bc_list_companies', 'bc_search_pages', 'bc_lookup']) {
      expect(guard(tool(t), {})).toEqual({ allow: true });
    }
  });

  test('write tools are denied until the switch to EXPLORE', () => {
    const guard = exploreWriteGuard();
    const denied = guard(tool('bc_write_data'), { operationId: 'a' });
    expect(denied).toEqual({ allow: false, reason: 'Switch to company EXPLORE with bc_switch_company before any write; the demo company must stay untouched.' });
    expect(guard(tool('bc_switch_company'), { company: 'CRONUS International Ltd.' })).toEqual({ allow: false, reason: 'Only company EXPLORE may be used for exploration.' });
    expect(guard(tool('bc_switch_company'), { company: 'EXPLORE' })).toEqual({ allow: true });
    expect(guard(tool('bc_write_data'), { operationId: 'a' })).toEqual({ allow: true });
  });

  test('write tools need an operationId', () => {
    const guard = exploreWriteGuard();
    guard(tool('bc_switch_company'), { company: 'EXPLORE' });
    expect(guard(tool('bc_execute_action'), {})).toEqual({ allow: false, reason: 'Pass an operationId on every write tool call.' });
  });

  test('other tools are not the guard\'s business', () => {
    expect(exploreWriteGuard()('Read', {})).toEqual({ allow: true });
  });
});
```

`tests/services/agent-stage.test.ts`:

```ts
test('extra MCP servers and hooks reach the stage options', () => {
  const hooks = { PreToolUse: [] };
  const options = buildStageOptions(testConfig(), 'recording', '', {}, new AbortController(), {
    mcpServers: { 'business-central': { type: 'stdio', command: 'bun', args: [] } },
    hooks,
  });
  expect(Object.keys(options.mcpServers ?? {})).toEqual(['business-central']);
  expect(options.hooks).toBe(hooks);
});

test('no extras: options carry no servers or hooks', () => {
  const options = buildStageOptions(testConfig(), 'generate', '', {}, new AbortController());
  expect(options.mcpServers).toBeUndefined();
  expect(options.hooks).toBeUndefined();
});
```

(If Task 1 Step 2 showed other tool or argument names, e.g. the company argument is `companyName`, use those in the guard and the tests.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/video/explore.test.ts tests/services/agent-stage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `src/video/explore.ts`**

```ts
import { join } from 'path';
import type { HookCallbackMatcher, McpStdioServerConfig, Options } from '@anthropic-ai/claude-agent-sdk';

export const BC_MCP_SERVER = 'business-central';
const BC_MCP_ENTRY = join(import.meta.dir, '..', '..', 'node_modules', 'business-central-mcp', 'dist', 'stdio-server.js');

/** The BC web-client MCP for one environment; credentials live only in the server's env. */
export function businessCentralMcpServer(o: { url: string; user: string; password: string; stateDir: string; runtime?: 'bun' | 'node' }): McpStdioServerConfig {
  return {
    type: 'stdio',
    command: o.runtime ?? 'bun',
    args: [BC_MCP_ENTRY],
    env: { BC_BASE_URL: o.url, BC_AUTH: 'NavUserPassword', BC_USERNAME: o.user, BC_PASSWORD: o.password, STATE_DIR: o.stateDir },
  };
}

const PREFIX = `mcp__${BC_MCP_SERVER}__`;
/** Tools that change data or state in BC. Everything else on the server only reads. */
const WRITE_TOOLS = new Set([
  'bc_write_data', 'bc_execute_action', 'bc_respond_dialog', 'bc_wizard_navigate',
  'bc_run_report', 'bc_upload_file', 'bc_run_tests',
]);

/** Writes only after a switch to EXPLORE, and only with an operationId. */
export function exploreWriteGuard() {
  let inExplore = false;
  return (toolName: string, input: Record<string, unknown>): { allow: true } | { allow: false; reason: string } => {
    if (!toolName.startsWith(PREFIX)) return { allow: true };
    const name = toolName.slice(PREFIX.length);
    if (name === 'bc_switch_company') {
      if (input['company'] !== EXPLORE_COMPANY) return { allow: false, reason: `Only company ${EXPLORE_COMPANY} may be used for exploration.` };
      inExplore = true;
      return { allow: true };
    }
    if (!WRITE_TOOLS.has(name)) return { allow: true };
    if (!inExplore) return { allow: false, reason: `Switch to company ${EXPLORE_COMPANY} with bc_switch_company before any write; the demo company must stay untouched.` };
    if (typeof input['operationId'] !== 'string' || !input['operationId']) return { allow: false, reason: 'Pass an operationId on every write tool call.' };
    return { allow: true };
  };
}

/** The guard as an Agent SDK PreToolUse hook. */
export function exploreHooks(guard: ReturnType<typeof exploreWriteGuard>): Options['hooks'] {
  const matcher: HookCallbackMatcher = {
    matcher: `${PREFIX}.*`,
    hooks: [async (input) => {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const verdict = guard(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>);
      return verdict.allow ? {} : {
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason },
      };
    }],
  };
  return { PreToolUse: [matcher] };
}
```

Check the hook types against `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (`HookCallbackMatcher`, `PreToolUseHookInput`, `hookSpecificOutput.permissionDecision`) and adjust names if the SDK version differs.

`src/services/agent-stage.ts`:

```ts
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

export type StageExtras = { mcpServers?: Record<string, McpServerConfig>; hooks?: Options['hooks'] };

// buildStageOptions(..., abortController: AbortController, extra: StageExtras = {}): after building `options`:
  if (extra.mcpServers) options.mcpServers = extra.mcpServers;
  if (extra.hooks) options.hooks = extra.hooks;
```

and `runAgentStage(config, stage, promptNames, prompt, schema, deps = defaultAgentStageDeps, extra: StageExtras = {})` passes `extra` to `buildStageOptions`.

- [ ] **Step 4: Run tests**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/video/explore.ts src/services/agent-stage.ts tests/video/explore.test.ts tests/services/agent-stage.test.ts
git commit -m "feat(agent): business-central-mcp for a stage, writes guarded to EXPLORE"
```

---

### Task 4: Pipeline wiring

**Files:**
- Modify: `src/services/pipeline.ts` (`PipelineDeps`, `defaultPipelineDeps`, `runPipeline` section G)
- Modify: `src/config/index.ts`, `src/types/index.ts` (`BC_MCP_RUNTIME` -> `config.bcMcpRuntime`, default from Task 1), test config literals
- Test: `tests/services/pipeline.test.ts`

**Interfaces:**
- Consumes: `ensureExploreCompany`, `businessCentralMcpServer`, `exploreWriteGuard`, `exploreHooks`, `BC_MCP_SERVER`, `EXPLORE_COMPANY`, `runAgentStage(..., extra)`.
- Produces: `PipelineDeps.ensureExploreCompany: (opts: { url: string; user: string; password: string }) => Promise<'copied' | 'existed'>`

- [ ] **Step 1: Write the failing tests**

Add `ensureExploreCompany: mock(async () => 'copied' as const)` to `makeDeps` in `tests/services/pipeline.test.ts`, and `bcMcpRuntime: 'bun'` to every test config literal. Then:

```ts
describe('runPipeline — exploration', () => {
  test('the recording stage gets the BC server, the guard and an Exploration block', async () => {
    const { deps, query } = makeDeps();
    await runPipeline(testConfig(), context, { mode: 'video' }, deps);
    const call = query.mock.calls[3]![0];
    expect(Object.keys(call.options.mcpServers ?? {})).toEqual(['business-central']);
    expect(call.options.hooks?.PreToolUse).toHaveLength(1);
    expect(call.prompt).toContain('## Exploration');
    expect(call.prompt).toContain('EXPLORE');
    expect(call.prompt).not.toMatch(/\bpw\b/); // the password stays in the server's env
  });

  test('exploration setup failure falls back to recording without the server', async () => {
    const { deps, query } = makeDeps();
    deps.ensureExploreCompany.mockImplementation(async () => { throw new Error('copy company failed'); });
    const result = await runPipeline(testConfig(), context, { mode: 'video' }, deps);
    expect(query.mock.calls[3]![0].options.mcpServers).toBeUndefined();
    expect(result.gaps).toContain('video: exploration skipped (copy company failed); the recording follows the script only');
  });

  test('resume skips the copy', async () => {
    const { deps } = makeDeps({ saved: { generate: outputs.generate, validate: outputs.validate, profileId: 'profile-1', envId: 'env-1', activated: true, countryAppInstalled: true, deployGaps: [], mode: 'video', recordingChecked: true } as PipelineState });
    await runPipeline(testConfig(), context, { resume: true }, deps);
    expect(deps.ensureExploreCompany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/services/pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Config: `BC_MCP_RUNTIME: z.enum(["bun", "node"]).default("<Task 1 result>")` in `envSchema`, `bcMcpRuntime` in `AppConfig` and `loadConfig`.

Pipeline: add `ensureExploreCompany` to `PipelineDeps` and `defaultPipelineDeps` (`(o) => ensureExploreCompany(o)`). At the top of `runPipeline` add `const videoGaps: string[] = [];` next to `stages`, and `...videoGaps` as the last entry of `base().gaps`. In section G, inside `if (!state.recordingChecked)`, before building `recordingPrompt`:

```ts
      let extra: StageExtras = {};
      let explorationBlock = '';
      try {
        await deps.ensureExploreCompany({ url: env.url, user: env.username, password: env.password });
        const server = businessCentralMcpServer({
          url: env.url, user: env.username, password: env.password,
          stateDir: join(itemDir, 'bc-mcp'), runtime: config.bcMcpRuntime,
        });
        extra = { mcpServers: { [BC_MCP_SERVER]: server }, hooks: exploreHooks(exploreWriteGuard()) };
        explorationBlock = [
          '## Exploration',
          `- The ${BC_MCP_SERVER} tools (bc_*) are connected to this environment.`,
          `- First call bc_switch_company with company ${EXPLORE_COMPANY}, a copy of the demo company. Writes elsewhere are refused.`,
          '- Give every write tool call an operationId.',
          `- Write what you saw to: ${join(itemDir, 'exploration.md')}`,
        ].join('\n');
      } catch (err) {
        const gap = `video: exploration skipped (${err instanceof Error ? err.message : String(err)}); the recording follows the script only`;
        videoGaps.push(gap);
        log(`  ${gap}`);
      }
```

Append `explorationBlock` to `recordingPrompt` when set, and pass `extra` as the last argument of the recording stage's `runAgentStage` call.

- [ ] **Step 4: Run tests**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/pipeline.ts src/config/index.ts src/types/index.ts tests
git commit -m "feat(pipeline): recording stage explores the flow in a scratch company first"
```

---

### Task 5: Recording prompt

**Files:**
- Modify: `prompts/recording.md`

- [ ] **Step 1: Add section 0 before "### 1. `recording.yml`"**

```markdown
### 0. Walk the flow first (when the prompt has an "Exploration" section)

The bc_* tools drive this environment's web client. Walk the flow in the recording script, start to
end, before you write anything.

- First switch to the exploration company named in the Exploration section. The demo company must
  stay as the PTE left it; writes there are refused.
- Look before you act: open the page, read its fields and actions, then write or act. Give every
  write an operationId.
- Note each page's caption, the fields you set, the actions and wizard buttons you used, and every
  dialog and how you answered it.
- Where the script says "if the wizard shows X", note which page actually came. The recording
  follows what you saw, as one path with no branches.
- Stop at the step that leaves Business Central (a pop-up on another site). The recording ends
  with the action that opens it.
- If a tool keeps failing (session lost, timeouts), stop exploring and write the recording from the
  script alone; say so in `notes`.
- Write what you saw to the exploration file: one line per step, with page caption, action or field,
  and value.
```

- [ ] **Step 2: Adjust the existing rule**

Replace "Keep it to the flow the recording script shows; no extra navigation." with:

```markdown
- Keep it to the flow the recording script shows, as you saw it in the exploration (one path, no
  branches); no extra navigation.
```

- [ ] **Step 3: Verify on a real item**

Retag item 84919 with `create video`. Expected: `output/84919/exploration.md` lists the real page sequence; `output/84919/bc-mcp/` holds the package's operation ledger; Companies shows `EXPLORE`; the demo company's COBA-PSD2 still shows Status Not Ready; `recording.yml` has no step for a page that never appeared; the video plays from step 0 through the Connect Bank Account click.

- [ ] **Step 4: Commit**

```bash
git add prompts/recording.md
git commit -m "feat(prompts): recording agent walks the flow with the bc_* tools first"
```
