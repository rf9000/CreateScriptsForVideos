# `create video` Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second work-item tag, `create video`, runs the existing script pipeline and additionally records a narrated, subtitled demo video in the provisioned BC environment and attaches the mp4 to the work item.

**Architecture:** The video is a tail on the existing staged pipeline (`src/services/pipeline.ts`), not a second pipeline. In video mode the generate stage also writes a BC Page Scripting recording (`recording.yml`), staging hints (`recording.staging.yml`) and per-step narration (`narration.yml`). After verify, a new code step generates TTS clips, records the demo per step with BC's own replay engine (`window.DN.playRecording`) while a cosmetic staging layer reveals targets, moves a cursor and types visibly, then composes video + narration + subtitles with FFmpeg. Proven by the spike on branch `spike/replay-video` (IBAN auto-fill demo, 10/10 steps, approved by the user).

**Tech Stack:** Bun + TypeScript, Playwright 1.55 (Chromium), OpenAI TTS (`tts-1-hd`), ffmpeg-static, zod, bun:test.

**Spec:** `spikes/replay-video/README.md` (findings 1–10, results, "Video quality" sections). Code to port: `spikes/replay-video/{staging.ts,cursor.ts,harness.ts}` and V1 `C:\GeneralDev\continia-demo-generator\src\{narrator.ts,step-audio.ts,locale-voices.ts,subtitle-gen.ts,composer.ts}`.

## Global Constraints

- Work on a new branch `feature/create-video` cut from `spike/replay-video` (it contains the split pipeline and the spike).
- BC's engine executes every step. Staging/cursor/typing code never decides whether a step succeeds; a staging miss is logged, never thrown.
- Recordings use BC's real format only: step types `navigate`, `page-shown`, `filter`, `input`, `focus`, `invoke`, `validate`, `wait`; `target: [{page, runtimeRef}, {field|action|repeater|scope}]`; `page-shown` carries `runtimeId`; page names are AL object names (e.g. `Bank Account Card`, `CTS-CB Bank Acc. Com. Setup`); actions are AL control names (`action: Control_New`, `invokeType: New`).
- Every recording must contain at least one `validate` step that proves the demo's outcome (the engine's own success flag is not proof — spike finding 4).
- Per-step slices send `start` only with the first slice (spike finding 7).
- Viewport and video size: 1920x1080.
- The `create script` tag behaves exactly as today when `create video` is absent.
- A failed video never fails the item: script, PTE and environment are still delivered; the comment states why the video is missing.
- Secrets: the continia token travels in `CONTINIA_API_TOKEN` (env), never argv; `OPENAI_API_KEY` is required only when a video item runs.

## Design notes (decided, not tasks)

- **No rehearsal run before recording.** A headless rehearsal would change the demo data (the IBAN flow creates a bank account; edit flows change records), so the recording would start from a different state. Version 1 records once; the `validate` steps are the gate. A failed recording is reported. A repair loop (fix the recording, re-record on a fresh environment) is a follow-up, out of scope here.
- **Narration is keyed by recording step index** (`narration.yml`), and each narrated step is held for its clip length (+500 ms, min 1500 ms), like V1's `step-audio.ts`.
- **Vision QA is out of scope.** `validate` steps prove state; staging logs visibility per step; the video is attached as a draft for human review.

## Review Focus

1. **Item tagged with both tags** → treated as video (superset); both tags removed after the attempt. Tested in Task 1 and Task 9.
2. **`OPENAI_API_KEY` missing on a video item** → script/env delivered, comment says the video was skipped and why; no crash. Tested in Task 8.
3. **`narration.yml` missing or keyed to steps that don't exist** → those entries are ignored; recording still runs with the default hold. Tested in Task 4.
4. **Recording step fails mid-way (e.g. dialog not in the script)** → recording stops, the partial webm is not composed or attached, and the comment names the failing step and BC's error text. Tested in Task 8.
5. **mp4 larger than ADO's attachment limit (130 MB)** → not uploaded; comment says so with the on-disk path. Tested in Task 9.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/config/index.ts` (modify) | `CREATE_VIDEO_TAG`, `OPENAI_API_KEY`, `VIDEO_LOCALE`, `VIDEO_HEADED` |
| `src/types/index.ts` (modify) | `AppConfig` fields, `ItemMode`, `ScriptResult.video` |
| `src/sdk/azure-devops-client.ts` (modify) | discovery for both tags, `itemMode()`, binary `uploadAttachment` |
| `src/video/recording.ts` (create) | recording/narration/hints types, loading, linting (pure) |
| `src/video/cursor.ts` (move from spike) | cosmetic cursor overlay |
| `src/video/staging.ts` (move from spike) | cosmetic reveal layer |
| `src/video/bc-session.ts` (create) | login, BC idle wait, `DN.playRecording` + resume loop, startup-dialog dismissal |
| `src/video/recorder.ts` (create) | per-step recording with staging, cursor, typing, holds; timing output |
| `src/video/narration.ts` (port V1 narrator + step-audio + locale-voices) | TTS clips and step holds |
| `src/video/compose.ts` (port V1 subtitle-gen + composer) | ASS/SRT subtitles, FFmpeg composition, trim |
| `src/video/make-video.ts` (create) | orchestrates narration → record → compose for one item |
| `prompts/generate-video.md` (create) | generate-stage addendum: write recording/hints/narration |
| `src/services/pipeline.ts` (modify) | video mode: prompt addendum, recording lint after generate, video step after verify |
| `src/services/processor.ts` (modify) | mode-aware tag removal, mp4 attachment, comment text |
| `src/cli/index.ts` (modify) | `test-item <id> --video` |
| `Dockerfile`, `DEPLOY.md`, `.env.example`, `README.md` (modify) | Chromium deps, new settings |
| `tests/video/*.test.ts` (create) | unit tests per module |

---

### Task 1: Config and tag discovery for both tags

**Files:**
- Modify: `src/types/index.ts`, `src/config/index.ts`, `src/sdk/azure-devops-client.ts:148-191`
- Test: `tests/config/config.test.ts`, `tests/sdk/azure-devops-client.test.ts`, `tests/helpers/config.ts`

**Interfaces:**
- Produces: `AppConfig.createVideoTag: string`, `AppConfig.openaiApiKey: string`, `AppConfig.videoLocale: string`, `AppConfig.videoHeaded: boolean`; `type ItemMode = 'script' | 'video'`; `itemMode(config, item): ItemMode | undefined` exported from `src/sdk/azure-devops-client.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/config/config.test.ts` inside `describe("script-generator config", …)`:

```ts
    it("defaults the video settings", () => {
      const config = loadConfig(validEnv);
      expect(config.createVideoTag).toBe("create video");
      expect(config.openaiApiKey).toBe("");
      expect(config.videoLocale).toBe("en-US");
      expect(config.videoHeaded).toBe(false);
    });

    it("reads the video settings", () => {
      const config = loadConfig({
        ...validEnv,
        CREATE_VIDEO_TAG: "record video",
        OPENAI_API_KEY: "sk-test",
        VIDEO_LOCALE: "da-DK",
        VIDEO_HEADED: "true",
      });
      expect(config.createVideoTag).toBe("record video");
      expect(config.openaiApiKey).toBe("sk-test");
      expect(config.videoLocale).toBe("da-DK");
      expect(config.videoHeaded).toBe(true);
    });
```

Add to `tests/sdk/azure-devops-client.test.ts` (next to the other `queryTaggedWorkItems` tests; import `itemMode` alongside `queryTaggedWorkItems`):

```ts
  test('queries both tags and keeps items with either exact tag', async () => {
    setSequentialMockFetch(
      { body: { workItems: [{ id: 1, url: 'u1' }, { id: 2, url: 'u2' }, { id: 3, url: 'u3' }] } },
      {
        body: {
          value: [
            { id: 1, rev: 1, url: 'u1', fields: { 'System.Tags': 'create script' } },
            { id: 2, rev: 1, url: 'u2', fields: { 'System.Tags': 'foo; create video' } },
            { id: 3, rev: 1, url: 'u3', fields: { 'System.Tags': 'create videos' } },
          ],
        },
      },
    );
    const items = await queryTaggedWorkItems(mockConfig());
    expect(items.map((i) => i.id)).toEqual([1, 2]);
    const body = JSON.parse((mockFn.mock.calls[0]![1] as RequestInit).body as string) as { query: string };
    expect(body.query).toContain("([System.Tags] CONTAINS 'create script' OR [System.Tags] CONTAINS 'create video')");
  });

  test('itemMode: video wins when both tags are present', () => {
    const item = (tags: string) => ({ id: 1, rev: 1, url: 'u', fields: { 'System.Tags': tags } });
    expect(itemMode(mockConfig(), item('create script'))).toBe('script');
    expect(itemMode(mockConfig(), item('Create Video'))).toBe('video');
    expect(itemMode(mockConfig(), item('create script; create video'))).toBe('video');
    expect(itemMode(mockConfig(), item('other'))).toBeUndefined();
  });
```

The `mockConfig()` in `tests/sdk/azure-devops-client.test.ts` is a local literal; add `createVideoTag: 'create video', openaiApiKey: '', videoLocale: 'en-US', videoHeaded: false,` after its `createScriptTag` line. Add the same four fields to `tests/helpers/config.ts` and to the local `mockConfig()`/`config()` literals in `tests/services/{processor,pruner,pruner.integration,watcher}.test.ts` (each has a `createScriptTag:` line to anchor on).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/config tests/sdk`
Expected: FAIL — `createVideoTag` undefined; `itemMode` is not exported; the WIQL lacks the OR clause.

- [ ] **Step 3: Implement**

`src/types/index.ts`, in `AppConfig` after `createScriptTag: string;`:

```ts
  /** Work-item tag that opts an item into script generation plus a recorded video. */
  createVideoTag: string;
  /** OpenAI key for narration (TTS). Required only when a video item runs. */
  openaiApiKey: string;
  /** Narration locale, e.g. en-US or da-DK (voice and speed per locale). */
  videoLocale: string;
  /** Show the browser while recording (debugging). */
  videoHeaded: boolean;
```

and at the end of the file:

```ts
/** What a tagged item asks for. `video` is a superset of `script`. */
export type ItemMode = 'script' | 'video';
```

`src/config/index.ts`, in `envSchema` after `CREATE_SCRIPT_TAG`:

```ts
  CREATE_VIDEO_TAG: z.string().default("create video"),
  OPENAI_API_KEY: z.string().default(""),
  VIDEO_LOCALE: z.string().default("en-US"),
  VIDEO_HEADED: z.enum(["true", "false"]).default("false"),
```

and in the returned object after `createScriptTag`:

```ts
    createVideoTag: parsed.CREATE_VIDEO_TAG,
    openaiApiKey: parsed.OPENAI_API_KEY,
    videoLocale: parsed.VIDEO_LOCALE,
    videoHeaded: parsed.VIDEO_HEADED === "true",
```

`src/sdk/azure-devops-client.ts`: replace `queryTaggedWorkItems` (lines 152–191) with:

```ts
/** Which tag an item carries. Video wins when both are present (it includes the script). */
export function itemMode(config: AppConfig, item: WorkItemResponse): ItemMode | undefined {
  const tags = String(item.fields['System.Tags'] ?? '')
    .split(';')
    .map((t) => t.trim().toLowerCase());
  if (tags.includes(config.createVideoTag.toLowerCase())) return 'video';
  if (tags.includes(config.createScriptTag.toLowerCase())) return 'script';
  return undefined;
}

export async function queryTaggedWorkItems(
  config: AppConfig,
): Promise<WorkItemResponse[]> {
  let wiql =
    `SELECT [System.Id] FROM workitems ` +
    `WHERE ([System.Tags] CONTAINS ${wiqlString(config.createScriptTag)}` +
    ` OR [System.Tags] CONTAINS ${wiqlString(config.createVideoTag)})`;
  // Area path is how work items are classified under a product (e.g.
  // "Continia Software\Continia Banking") — UNDER matches the node and all
  // descendants. This is the real scope signal; Git artifact links are absent.
  if (config.areaPath) {
    wiql += ` AND [System.AreaPath] UNDER ${wiqlString(config.areaPath)}`;
  }
  const candidateIds = await queryWorkItems(config, wiql);
  if (candidateIds.length === 0) return [];

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
      if (itemMode(config, item)) tagged.push(item);
    }
  }

  return tagged;
}
```

Add `ItemMode` to the type import at the top of the file: `import type { AppConfig, ItemMode, WorkItemResponse, … } from '../types/index.ts';` (keep the existing names).

The existing test `narrows via WIQL (no TeamProject clause) using a CONTAINS clause` asserts `toContain("[System.Tags] CONTAINS 'create script'")`; it still passes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run typecheck && bun run test:unit`
Expected: typecheck clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/config/index.ts src/sdk/azure-devops-client.ts tests
git commit -m "feat: discover items tagged create script or create video"
```

---

### Task 2: Binary attachment upload

**Files:**
- Modify: `src/sdk/azure-devops-client.ts` (`uploadAttachment`), `src/services/processor.ts` (`ProcessorDeps.uploadAttachment` type)
- Test: `tests/sdk/azure-devops-client.test.ts`

**Interfaces:**
- Produces: `uploadAttachment(config, fileName, content: string | Uint8Array): Promise<AttachmentRef>`.

- [ ] **Step 1: Write the failing test**

```ts
  test('uploadAttachment sends binary content unchanged', async () => {
    setMockFetch({ id: 'att-9', url: 'https://att/att-9' });
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const ref = await uploadAttachment(mockConfig(), 'demo.mp4', bytes);
    expect(ref.url).toBe('https://att/att-9');
    const init = mockFn.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe(bytes);
    expect(String(mockFn.mock.calls[0]![0])).toContain('fileName=demo.mp4');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/sdk -t "binary"`
Expected: FAIL at typecheck time in the editor; at runtime the test passes already only if `body` is forwarded. Run `bun run typecheck` — Expected: error `Argument of type 'Uint8Array' is not assignable to parameter of type 'string'`.

- [ ] **Step 3: Implement**

In `src/sdk/azure-devops-client.ts` change the signature line of `uploadAttachment` to `content: string | Uint8Array,`. In `src/services/processor.ts` change `ProcessorDeps.uploadAttachment`'s `content: string,` to `content: string | Uint8Array,`.

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bun test tests/sdk`
Expected: clean, PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sdk/azure-devops-client.ts src/services/processor.ts tests/sdk
git commit -m "feat: upload binary attachments"
```

---

### Task 3: Recording model, loading and lint

**Files:**
- Create: `src/video/recording.ts`
- Test: `tests/video/recording.test.ts`

**Interfaces:**
- Produces:
  - `type RecordingStep = { type: string; target?: Array<Record<string, unknown>>; source?: { page?: string }; runtimeId?: string; value?: unknown; description?: string; [k: string]: unknown }`
  - `type Recording = { name?: string; description: string; start?: Record<string, unknown>; steps: RecordingStep[] }`
  - `type StagingHints = { fieldGroups?: Record<string, string> }`
  - `type Narration = Record<number, string>` (recording step index → text)
  - `loadVideoInputs(dir: string): { recording: Recording; hints: StagingHints; narration: Narration }` — reads `recording.yml`, `recording.staging.yml` (optional), `narration.yml` (optional)
  - `lintRecording(rec: Recording): string[]` — empty array = OK

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { lintRecording, loadVideoInputs } from '../../src/video/recording.ts';
import type { Recording } from '../../src/video/recording.ts';

const good: Recording = {
  description: 'IBAN autofill',
  start: { profile: 'BUSINESS MANAGER' },
  steps: [
    { type: 'navigate', target: [{ page: 'Business Manager Role Center' }, { action: 'Bank Accounts' }] },
    { type: 'page-shown', source: { page: 'Bank Account List' }, runtimeId: 'bca' },
    { type: 'invoke', target: [{ page: 'Bank Account List', runtimeRef: 'bca' }, { action: 'Control_New' }], invokeType: 'New' },
    { type: 'page-shown', source: { page: 'Bank Account Card' }, runtimeId: 'bhi' },
    { type: 'input', target: [{ page: 'Bank Account Card', runtimeRef: 'bhi' }, { field: 'IBAN' }], value: 'NL85RABO0347427693' },
    { type: 'validate', target: [{ page: 'Bank Account Card', runtimeRef: 'bhi' }, { field: 'City' }], operation: '=', value: 'UTRECHT' },
  ],
};

describe('lintRecording', () => {
  test('accepts a recording in BC format', () => {
    expect(lintRecording(good)).toEqual([]);
  });

  test('rejects unknown step types and caption-only actions (V1 format)', () => {
    const v1: Recording = {
      description: 'x',
      steps: [{ type: 'action', caption: 'All Direct', target: [{ page: 'X' }] }, good.steps[5]!],
    };
    expect(lintRecording(v1)).toContain('step 0: unknown step type "action"');
  });

  test('requires a validate step', () => {
    expect(lintRecording({ ...good, steps: good.steps.slice(0, 5) })).toContain(
      'no validate step: the recording must prove the demo outcome',
    );
  });

  test('requires runtimeRef to match an earlier page-shown runtimeId', () => {
    const bad: Recording = {
      ...good,
      steps: [
        { type: 'input', target: [{ page: 'Bank Account Card', runtimeRef: 'zzz' }, { field: 'IBAN' }], value: 'x' },
        good.steps[5]!,
      ],
    };
    expect(lintRecording(bad)).toContain('step 0: runtimeRef "zzz" has no earlier page-shown runtimeId');
  });

  test('requires a value on input and validate steps', () => {
    const bad: Recording = {
      ...good,
      steps: [...good.steps.slice(0, 4), { type: 'input', target: [{ page: 'Bank Account Card', runtimeRef: 'bhi' }, { field: 'IBAN' }] }, good.steps[5]!],
    };
    expect(lintRecording(bad)).toContain('step 4: input step has no value');
  });
});

describe('loadVideoInputs', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'video-in-'));
    writeFileSync(join(dir, 'recording.yml'), 'description: d\nsteps:\n  - type: wait\n    time: 10\n');
    writeFileSync(join(dir, 'narration.yml'), 'steps:\n  0: Hello there.\n  "x": ignored\n');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('loads recording and narration, hints default to empty', () => {
    const inputs = loadVideoInputs(dir);
    expect(inputs.recording.steps).toHaveLength(1);
    expect(inputs.narration).toEqual({ 0: 'Hello there.' });
    expect(inputs.hints).toEqual({});
  });

  test('throws when recording.yml is missing', () => {
    expect(() => loadVideoInputs(join(dir, 'nope'))).toThrow('recording.yml');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/video/recording.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/video/recording.ts`**

```ts
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

/** One step of a BC Page Scripting recording (only the fields we read are typed). */
export type RecordingStep = {
  type: string;
  target?: Array<Record<string, unknown>>;
  source?: { page?: string };
  runtimeId?: string;
  value?: unknown;
  description?: string;
  [k: string]: unknown;
};

export type Recording = {
  name?: string;
  description: string;
  start?: Record<string, unknown>;
  steps: RecordingStep[];
};

/** Which FastTab holds each field, by control name (from the AL page source). */
export type StagingHints = { fieldGroups?: Record<string, string> };

/** Narration text per top-level recording step index. */
export type Narration = Record<number, string>;

const KNOWN_TYPES = new Set(['navigate', 'page-shown', 'filter', 'input', 'focus', 'invoke', 'validate', 'wait', 'scope', 'include']);

/** Problems that would make BC's engine skip or misreport steps. Empty = fine. */
export function lintRecording(rec: Recording): string[] {
  const problems: string[] = [];
  const runtimeIds = new Set<string>();
  rec.steps.forEach((step, i) => {
    if (!KNOWN_TYPES.has(step.type)) problems.push(`step ${i}: unknown step type "${step.type}"`);
    if (step.type === 'page-shown' && typeof step.runtimeId === 'string') runtimeIds.add(step.runtimeId);
    for (const t of step.target ?? []) {
      const ref = t['runtimeRef'];
      if (typeof ref === 'string' && !runtimeIds.has(ref)) {
        problems.push(`step ${i}: runtimeRef "${ref}" has no earlier page-shown runtimeId`);
      }
    }
    if ((step.type === 'input' || step.type === 'validate') && step.value === undefined) {
      problems.push(`step ${i}: ${step.type} step has no value`);
    }
  });
  if (!rec.steps.some((s) => s.type === 'validate')) {
    problems.push('no validate step: the recording must prove the demo outcome');
  }
  return problems;
}

/** Read recording.yml (required), recording.staging.yml and narration.yml (optional) from an item folder. */
export function loadVideoInputs(dir: string): { recording: Recording; hints: StagingHints; narration: Narration } {
  const recordingPath = join(dir, 'recording.yml');
  if (!existsSync(recordingPath)) throw new Error(`recording.yml not found in ${dir}`);
  const recording = parse(readFileSync(recordingPath, 'utf-8')) as Recording;

  const hintsPath = join(dir, 'recording.staging.yml');
  const hints = existsSync(hintsPath) ? ((parse(readFileSync(hintsPath, 'utf-8')) as StagingHints) ?? {}) : {};

  const narration: Narration = {};
  const narrationPath = join(dir, 'narration.yml');
  if (existsSync(narrationPath)) {
    const raw = (parse(readFileSync(narrationPath, 'utf-8')) as { steps?: Record<string, unknown> })?.steps ?? {};
    for (const [key, text] of Object.entries(raw)) {
      const index = Number(key);
      if (Number.isInteger(index) && typeof text === 'string' && text.trim()) narration[index] = text.trim();
    }
  }
  return { recording, hints, narration };
}
```

Add the `yaml` dependency: `bun add yaml@2.8.1`.

- [ ] **Step 4: Verify**

Run: `bun test tests/video/recording.test.ts && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/video/recording.ts tests/video/recording.test.ts package.json bun.lock
git commit -m "feat(video): recording model, loader and lint"
```

---

### Task 4: BC session, staging and per-step recorder (from the spike)

**Files:**
- Create: `src/video/bc-session.ts`, `src/video/recorder.ts`
- Move: `spikes/replay-video/staging.ts` → `src/video/staging.ts`, `spikes/replay-video/cursor.ts` → `src/video/cursor.ts`
- Test: `tests/video/recorder.test.ts`, `tests/video/playwright-smoke.test.ts`

**Interfaces:**
- Consumes: `Recording`, `StagingHints`, `Narration` (Task 3).
- Produces:
  - `src/video/bc-session.ts`: `awaitFrame(page: Page, timeoutMs?: number): Promise<Frame>`, `play(page: Page, rec: Recording): Promise<PlayResult>`, `type PlayResult = { stepsReplayed?: number; error?: unknown; hasWarnings?: boolean; fileErrors?: unknown }`, `errorText(e: unknown): string | undefined`, `openSession(browser: Browser, opts: { url: string; profile?: string; user: string; password: string; videoDir: string }): Promise<{ context: BrowserContext; page: Page }>`, `dismissStartupDialogs(page: Page): Promise<string[]>`.
  - `src/video/recorder.ts`: `sliceFor(rec: Recording, index: number): Recording`, `holdFor(index: number, clipMs: Map<number, number>, defaultMs: number): number`, `recordDemo(opts: RecordOptions): Promise<RecordResult>` with
    `type RecordOptions = { recording: Recording; hints: StagingHints; holds: Map<number, number>; url: string; user: string; password: string; outDir: string; headed: boolean }` and
    `type RecordResult = { ok: boolean; videoPath?: string; failedStep?: number; error?: string; timing: { trimStartMs: number; steps: Array<{ stepIndex: number; startMs: number; endMs: number }> }; steps: StepLog[] }`,
    `type StepLog = { index: number; type: string; error?: string; cursor: 'found' | 'missing' | 'n/a'; visibleBefore?: string; visibleAfter?: string; staging: string[]; typed: boolean; ms: number }`.

- [ ] **Step 1: Playwright-under-Bun gate (smoke test)**

Create `tests/video/playwright-smoke.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { chromium } from 'playwright';

// Gate for running the recorder inside the Bun runtime (the spike ran under Node).
test('Chromium launches and records video under Bun', async () => {
  const browser = await chromium.launch();
  const dir = `${process.env['TEMP'] ?? '/tmp'}/pw-smoke-${Date.now()}`;
  const context = await browser.newContext({ recordVideo: { dir, size: { width: 640, height: 360 } } });
  const page = await context.newPage();
  await page.setContent('<h1>ok</h1>');
  expect(await page.textContent('h1')).toBe('ok');
  await page.close();
  expect(await page.video()?.path()).toContain('.webm');
  await context.close();
  await browser.close();
}, 60_000);
```

Run: `bun add playwright@1.55.1 && bunx playwright install chromium && bun test tests/video/playwright-smoke.test.ts`
Expected: PASS. **If it fails, stop and report the error** — the recorder must then run under Node (`node --experimental-strip-types`) as a child process, which changes Tasks 4 and 8.

- [ ] **Step 2: Move staging and cursor into `src/video/`**

```bash
git mv spikes/replay-video/staging.ts src/video/staging.ts
git mv spikes/replay-video/cursor.ts src/video/cursor.ts
```

In `src/video/staging.ts` replace the local `Step` and `StagingHints` type declarations with:

```ts
import type { RecordingStep as Step, StagingHints } from './recording.ts';
export type { StagingHints };
```

and change every `step.target?.find((t) => t.field)?.field` style access to cast: `(t['field'] as string | undefined)`, `(t['action'] as string | undefined)`, `t['repeater']` — the typed `Record<string, unknown>` target needs these casts. Keep all logic unchanged.

In `spikes/replay-video/harness.ts` update imports to `../../src/video/staging.ts` and `../../src/video/cursor.ts` so the spike keeps working.

- [ ] **Step 3: Write the failing recorder unit tests**

`tests/video/recorder.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import { holdFor, sliceFor } from '../../src/video/recorder.ts';
import { errorText } from '../../src/video/bc-session.ts';
import type { Recording } from '../../src/video/recording.ts';

const rec: Recording = {
  name: 'n',
  description: 'd',
  start: { profile: 'BUSINESS MANAGER' },
  steps: [{ type: 'navigate' }, { type: 'page-shown', runtimeId: 'a' }],
};

describe('sliceFor', () => {
  test('only the first slice carries start (later slices must not navigate back)', () => {
    expect(sliceFor(rec, 0).start).toEqual({ profile: 'BUSINESS MANAGER' });
    expect(sliceFor(rec, 1).start).toBeUndefined();
    expect(sliceFor(rec, 1).steps).toEqual([{ type: 'page-shown', runtimeId: 'a' }]);
  });
});

describe('holdFor', () => {
  test('narrated steps hold for clip + 500 ms, at least 1500 ms; others use the default', () => {
    const clips = new Map([[0, 4000], [1, 200]]);
    expect(holdFor(0, clips, 1200)).toBe(4500);
    expect(holdFor(1, clips, 1200)).toBe(1500);
    expect(holdFor(2, clips, 1200)).toBe(1200);
  });
});

describe('errorText', () => {
  test('normalizes BC error shapes', () => {
    expect(errorText(undefined)).toBeUndefined();
    expect(errorText('boom')).toBe('boom');
    expect(errorText({ message: "Field 'X' was not found." })).toBe("Field 'X' was not found.");
  });
});
```

Run: `bun test tests/video/recorder.test.ts` — Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `src/video/bc-session.ts`**

Port from `spikes/replay-video/harness.ts` (functions `awaitFrame`, `isDetached`, `play`, `errorText`, `dismissStartupDialogs`, and the two-context login block). Full file:

```ts
import type { Browser, BrowserContext, Frame, Page } from 'playwright';
import type { Recording } from './recording.ts';

export type PlayResult = { stepsReplayed?: number; error?: unknown; hasWarnings?: boolean; fileErrors?: unknown };

const NAV_TIMEOUT_MS = 60_000;
export const VIEWPORT = { width: 1920, height: 1080 };

/** Wait until BC is idle in the page and its iframe; return the BC frame (same logic as bc-replay). */
export async function awaitFrame(page: Page, timeoutMs = NAV_TIMEOUT_MS): Promise<Frame> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const idle = await page
      .evaluate(() => {
        const w = window as unknown as Record<string, any>;
        return (w['BC'] ?? w['DN'])?.ExecutionContext?.Instance?.IsIdle?.() ?? false;
      })
      .catch(() => false);
    if (idle) {
      const frames = page.frames();
      if (frames.length > 1) {
        const frameIdle = await frames[1]!
          .evaluate(() => (window as any).DN?.ExecutionContext?.Instance?.IsIdle?.() ?? false)
          .catch(() => false);
        if (frameIdle) return frames[1]!;
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error('timed out waiting for BC to become idle');
}

const isDetached = (err: unknown) => /detached|Execution context was destroyed|Target closed|navigation/i.test(String(err));

/** DN.playRecording with bc-replay's suspend/resume loop for steps that navigate. */
export async function play(page: Page, rec: Recording): Promise<PlayResult> {
  let result: PlayResult | 'suspended';
  try {
    const frame = await awaitFrame(page);
    result = await frame.evaluate((data) => (window as any).DN.playRecording(data), rec as unknown);
  } catch (err) {
    if (!isDetached(err)) throw err;
    result = 'suspended';
  }
  let resumes = 0;
  while (result === 'suspended') {
    if (++resumes > 20) throw new Error('playback stayed suspended after 20 resumes');
    await page.waitForNavigation({ timeout: NAV_TIMEOUT_MS }).catch(() => {});
    try {
      const frame = await awaitFrame(page);
      result = await frame.evaluate(async () => (window as any).DN.resumePlayback());
    } catch (err) {
      if (!isDetached(err)) throw err;
      result = 'suspended';
    }
  }
  return result;
}

export function errorText(e: unknown): string | undefined {
  if (e === undefined || e === null || e === false) return undefined;
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return JSON.stringify(e);
}

/** First-run dialogs on a fresh Continia demo environment, closed before the demo starts. */
const STARTUP_DIALOGS = ['Welcome to your Continia Demo Environment'];

export async function dismissStartupDialogs(page: Page): Promise<string[]> {
  const closed: string[] = [];
  for (let i = 0; i < 5; i++) {
    const frame = await awaitFrame(page);
    let hit = false;
    for (const title of STARTUP_DIALOGS) {
      const dialog = frame.locator('[role=dialog]:visible', { hasText: title }).last();
      if ((await dialog.count()) === 0) continue;
      await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
      closed.push(title);
      hit = true;
    }
    if (!hit) break;
    await page.waitForTimeout(500);
  }
  return closed;
}

/** Log in off camera, then open a video-recorded context on the authenticated page. */
export async function openSession(
  browser: Browser,
  opts: { url: string; profile?: string; user: string; password: string; videoDir: string },
): Promise<{ context: BrowserContext; page: Page }> {
  const url = new URL(opts.url);
  if (opts.profile) url.searchParams.set('profile', opts.profile);
  const start = url.toString().replaceAll('+', '%20');

  const auth = await browser.newContext({ viewport: VIEWPORT });
  const authPage = await auth.newPage();
  await authPage.goto(start);
  const userInput = authPage.locator('input[name=UserName]');
  if (await userInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await userInput.fill(opts.user);
    await authPage.fill('input[name=Password]', opts.password);
    await Promise.all([authPage.waitForNavigation({ timeout: NAV_TIMEOUT_MS }), authPage.click('button[type=submit]')]);
  }
  await awaitFrame(authPage);
  await dismissStartupDialogs(authPage);
  const cookies = await auth.cookies();
  const landed = authPage.url();
  await auth.close();

  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: opts.videoDir, size: VIEWPORT } });
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.goto(landed);
  await awaitFrame(page);
  await dismissStartupDialogs(page);
  return { context, page };
}
```

- [ ] **Step 5: Implement `src/video/recorder.ts`**

Port the per-step loop from `spikes/replay-video/harness.ts` (the `else` branch of `if (mode === 'whole')`), using the moved modules:

```ts
import { chromium } from 'playwright';
import type { Locator } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { animateClick, injectCursor } from './cursor.ts';
import { dismissTeachingTips, findTarget, stage, typeVisibly, visibility } from './staging.ts';
import { awaitFrame, errorText, openSession, play } from './bc-session.ts';
import type { Recording, StagingHints } from './recording.ts';

export type StepLog = {
  index: number;
  type: string;
  error?: string;
  cursor: 'found' | 'missing' | 'n/a';
  visibleBefore?: string;
  visibleAfter?: string;
  staging: string[];
  typed: boolean;
  ms: number;
};

export type RecordOptions = {
  recording: Recording;
  hints: StagingHints;
  /** Hold after each step, by step index (narration length); missing = default. */
  holds: Map<number, number>;
  url: string;
  user: string;
  password: string;
  outDir: string;
  headed: boolean;
};

export type RecordResult = {
  ok: boolean;
  videoPath?: string;
  failedStep?: number;
  error?: string;
  timing: { trimStartMs: number; steps: Array<{ stepIndex: number; startMs: number; endMs: number }> };
  steps: StepLog[];
};

const DEFAULT_HOLD_MS = 1200;
const AUDIO_BUFFER_MS = 500;
const MIN_NARRATED_HOLD_MS = 1500;
const TYPE_DELAY_MS = 70;
const PASSIVE = new Set(['page-shown', 'validate', 'wait']);

/** One step as its own recording; only the first slice carries start, or BC navigates back. */
export function sliceFor(rec: Recording, index: number): Recording {
  return {
    name: rec.name,
    description: `${rec.description} — step ${index}`,
    ...(index === 0 && rec.start ? { start: rec.start } : {}),
    steps: [rec.steps[index]!],
  };
}

/** How long to hold after a step: narration clip + buffer (min 1.5 s), else the default. */
export function holdFor(index: number, clipMs: Map<number, number>, defaultMs: number): number {
  const clip = clipMs.get(index);
  return clip === undefined ? defaultMs : Math.max(clip + AUDIO_BUFFER_MS, MIN_NARRATED_HOLD_MS);
}

export async function recordDemo(opts: RecordOptions): Promise<RecordResult> {
  mkdirSync(join(opts.outDir, 'shots'), { recursive: true });
  const browser = await chromium.launch({ headless: !opts.headed });
  const steps: StepLog[] = [];
  const timing: RecordResult['timing'] = { trimStartMs: 0, steps: [] };
  let failedStep: number | undefined;
  let error: string | undefined;
  let videoPath: string | undefined;
  try {
    const profile = typeof opts.recording.start?.['profile'] === 'string' ? (opts.recording.start['profile'] as string) : undefined;
    const { context, page } = await openSession(browser, {
      url: opts.url, profile, user: opts.user, password: opts.password, videoDir: opts.outDir,
    });
    const videoStart = Date.now();
    await injectCursor(page);
    await page.waitForTimeout(500);
    // Everything before the first step (loading, login landing) is trimmed from the final video.
    timing.trimStartMs = Date.now() - videoStart;

    for (const [index, step] of opts.recording.steps.entries()) {
      const t0 = Date.now();
      const passive = PASSIVE.has(step.type);
      const entry: StepLog = { index, type: step.type, cursor: passive ? 'n/a' : 'missing', staging: [], typed: false, ms: 0 };
      const frame = await awaitFrame(page);
      let target: Locator | undefined;
      if (!passive) {
        const tips = await dismissTeachingTips(frame);
        if (tips) entry.staging.push(`closed ${tips} tip(s)`);
        const staged = await stage(page, frame, step, opts.hints, () => awaitFrame(page).catch(() => {}));
        target = staged.target;
        const r = staged.report;
        entry.staging.push(
          ...r.expanded.map((c) => `expand ${c}`),
          ...r.collapsedBack.map((c) => `collapse ${c}`),
          ...r.showMore.map((c) => `show more ${c}`),
          ...r.scrolled.map((c) => `scroll ${c}`),
          ...(r.revealed ? ['reveal'] : []),
        );
        entry.visibleBefore = await visibility(target);
        const box = target ? await target.boundingBox().catch(() => null) : null;
        if (box) {
          const onField = step.target?.some((t) => t['field']) && box.width > 60;
          await animateClick(page, onField ? box.x + box.width - 28 : box.x + box.width / 2, box.y + box.height / 2);
          entry.cursor = 'found';
        }
        if (target) entry.typed = await typeVisibly(target, step, TYPE_DELAY_MS).catch(() => false);
      }

      const stepStart = Date.now() - videoStart;
      try {
        const result = await play(page, sliceFor(opts.recording, index));
        entry.error = errorText(result.error) ?? errorText(result.fileErrors);
      } catch (err) {
        entry.error = `recorder: ${String(err)}`;
      }
      await awaitFrame(page).catch(() => {});
      if (!passive && step.type !== 'navigate' && step.type !== 'invoke') {
        entry.visibleAfter = await visibility(await findTarget(await awaitFrame(page), step).catch(() => undefined));
      }
      await page.screenshot({ path: join(opts.outDir, 'shots', `step-${String(index).padStart(2, '0')}.png`) });
      await page.waitForTimeout(holdFor(index, opts.holds, DEFAULT_HOLD_MS));
      timing.steps.push({ stepIndex: index, startMs: stepStart, endMs: Date.now() - videoStart });
      entry.ms = Date.now() - t0;
      steps.push(entry);
      if (entry.error) {
        failedStep = index;
        error = entry.error;
        break;
      }
    }
    await page.close();
    videoPath = await page.video()?.path();
    await context.close();
  } catch (err) {
    error = error ?? `recorder: ${String(err)}`;
  } finally {
    await browser.close();
  }
  return { ok: error === undefined, videoPath, failedStep, error, timing, steps };
}
```

Note `holds` is the clip-length map (step index → clip ms) and `holdFor` turns it into the hold. Task 7 passes the clip map.

- [ ] **Step 6: Verify**

Run: `bun test tests/video && bun run typecheck`
Expected: PASS (smoke, recording, recorder unit tests), clean.

- [ ] **Step 7: Commit**

```bash
git add src/video tests/video spikes/replay-video/harness.ts package.json bun.lock
git commit -m "feat(video): per-step recorder on BC's replay engine with cosmetic staging"
```

---

### Task 5: Narration (port V1)

**Files:**
- Create: `src/video/narration.ts`
- Test: `tests/video/narration.test.ts`

**Interfaces:**
- Consumes: `Narration` (Task 3).
- Produces: `type Clip = { stepIndex: number; audioPath: string; durationMs: number; text: string }`; `voiceForLocale(locale: string): { voice: 'nova' | 'alloy' | 'echo' | 'fable' | 'onyx' | 'shimmer'; speed: number }`; `expandAbbreviations(text: string): string`; `parseDuration(ffmpegOutput: string): number`; `generateClips(narration: Narration, outDir: string, opts: { apiKey: string; locale: string; tts?: TtsFn; probe?: (path: string) => Promise<number> }): Promise<Clip[]>`; `type TtsFn = (text: string, voice: string, speed: number) => Promise<Uint8Array>`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect, mock } from 'bun:test';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expandAbbreviations, generateClips, parseDuration, voiceForLocale } from '../../src/video/narration.ts';

describe('voiceForLocale', () => {
  test('known locales and default', () => {
    expect(voiceForLocale('da-DK')).toEqual({ voice: 'nova', speed: 0.95 });
    expect(voiceForLocale('xx-XX')).toEqual({ voice: 'nova', speed: 1.0 });
  });
});

describe('parseDuration', () => {
  test('reads the Duration line from ffmpeg -i output', () => {
    expect(parseDuration('  Duration: 00:00:04.52, start: 0.000000')).toBe(4520);
  });
  test('0 when absent', () => {
    expect(parseDuration('nothing')).toBe(0);
  });
});

describe('expandAbbreviations', () => {
  test('expands BC abbreviations for speech', () => {
    expect(expandAbbreviations('Bank Acc. No.')).toBe(expandAbbreviations('Bank Acc. No.'));
    expect(expandAbbreviations('Open the Bank Acc. card')).toContain('Account');
  });
});

describe('generateClips', () => {
  test('one clip per narrated step, in step order, with probed durations', async () => {
    const out = mkdtempSync(join(tmpdir(), 'narr-'));
    const tts = mock(async () => new Uint8Array([1, 2, 3]));
    const probe = mock(async () => 2500);
    const clips = await generateClips({ 3: 'Third.', 0: 'First.' }, out, { apiKey: 'k', locale: 'en-US', tts, probe });
    expect(clips.map((c) => c.stepIndex)).toEqual([0, 3]);
    expect(clips[0]!.durationMs).toBe(2500);
    expect(existsSync(clips[1]!.audioPath)).toBe(true);
    expect(tts).toHaveBeenCalledTimes(2);
  });

  test('throws without an API key', async () => {
    await expect(generateClips({ 0: 'x' }, tmpdir(), { apiKey: '', locale: 'en-US' })).rejects.toThrow('OPENAI_API_KEY');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/video/narration.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/video/narration.ts`**

Copy V1's `expandAbbreviations` and its abbreviation table and `parseDuration` verbatim from `C:\GeneralDev\continia-demo-generator\src\narrator.ts` (lines 95–129), and the voice table from V1 `locale-voices.ts`. Then:

```ts
import OpenAI from 'openai';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import type { Narration } from './recording.ts';

export type Clip = { stepIndex: number; audioPath: string; durationMs: number; text: string };
export type TtsFn = (text: string, voice: string, speed: number) => Promise<Uint8Array>;
type Voice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

const VOICES: Record<string, { voice: Voice; speed: number }> = {
  'da-DK': { voice: 'nova', speed: 0.95 },
  'en-US': { voice: 'nova', speed: 1.0 },
  'en-GB': { voice: 'nova', speed: 1.0 },
  'de-DE': { voice: 'nova', speed: 0.95 },
  'nl-NL': { voice: 'nova', speed: 0.95 },
  'no-NO': { voice: 'nova', speed: 0.95 },
  'sv-SE': { voice: 'nova', speed: 0.95 },
};

export function voiceForLocale(locale: string): { voice: Voice; speed: number } {
  return VOICES[locale] ?? { voice: 'nova', speed: 1.0 };
}

export function ffmpegPath(): string {
  const require = createRequire(import.meta.url);
  return (require('ffmpeg-static') as string | null) ?? 'ffmpeg';
}

async function probeDuration(path: string): Promise<number> {
  try {
    execFileSync(ffmpegPath(), ['-i', path], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    // ffmpeg -i with no output exits non-zero but prints the header (with Duration) on stderr.
    return parseDuration(String((e as { stderr?: Buffer }).stderr ?? ''));
  }
}

function openAiTts(apiKey: string): TtsFn {
  const client = new OpenAI({ apiKey });
  return async (text, voice, speed) => {
    const res = await client.audio.speech.create({ model: 'tts-1-hd', voice: voice as Voice, input: text, speed, response_format: 'mp3' });
    return new Uint8Array(await res.arrayBuffer());
  };
}

/** TTS one mp3 per narrated recording step, three at a time (V1 step-audio). */
export async function generateClips(
  narration: Narration,
  outDir: string,
  opts: { apiKey: string; locale: string; tts?: TtsFn; probe?: (path: string) => Promise<number> },
): Promise<Clip[]> {
  if (!opts.apiKey && !opts.tts) throw new Error('OPENAI_API_KEY is not set; narration needs it');
  const tts = opts.tts ?? openAiTts(opts.apiKey);
  const probe = opts.probe ?? probeDuration;
  const { voice, speed } = voiceForLocale(opts.locale);
  const dir = join(outDir, 'narration');
  mkdirSync(dir, { recursive: true });
  const entries = Object.entries(narration)
    .map(([k, text]) => ({ stepIndex: Number(k), text }))
    .sort((a, b) => a.stepIndex - b.stepIndex);
  const clips: Clip[] = [];
  for (let i = 0; i < entries.length; i += 3) {
    const batch = await Promise.all(
      entries.slice(i, i + 3).map(async ({ stepIndex, text }) => {
        const audioPath = join(dir, `step-${stepIndex}.mp3`);
        writeFileSync(audioPath, await tts(expandAbbreviations(text), voice, speed));
        return { stepIndex, audioPath, durationMs: await probe(audioPath), text };
      }),
    );
    clips.push(...batch);
  }
  return clips;
}
```

Add deps: `bun add openai@6.29.0 ffmpeg-static@5.3.0`.

- [ ] **Step 4: Verify**

Run: `bun test tests/video/narration.test.ts && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/video/narration.ts tests/video/narration.test.ts package.json bun.lock
git commit -m "feat(video): narration clips via OpenAI TTS (ported from V1)"
```

---

### Task 6: Subtitles and composition (port V1)

**Files:**
- Create: `src/video/compose.ts`
- Test: `tests/video/compose.test.ts`

**Interfaces:**
- Consumes: `Clip` (Task 5), `RecordResult['timing']` (Task 4).
- Produces: `writeSubtitles(clips: Clip[], timing: Timing, assPath: string): string` (returns ASS path; writes `.srt` beside it); `composeVideo(opts: { videoPath: string; clips: Clip[]; timing: Timing; subtitlePath?: string; outputPath: string }): { ok: boolean; videoPath?: string; error?: string }`; `type Timing = { trimStartMs: number; steps: Array<{ stepIndex: number; startMs: number; endMs: number }> }`; `formatAssTime(ms: number): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { formatAssTime, writeSubtitles } from '../../src/video/compose.ts';

describe('formatAssTime', () => {
  test('H:MM:SS.cc', () => {
    expect(formatAssTime(3_723_450)).toBe('1:02:03.45');
  });
});

describe('writeSubtitles', () => {
  test('places each clip at its step start minus the trim, at 1920x1080', () => {
    const dir = mkdtempSync(join(tmpdir(), 'subs-'));
    const ass = writeSubtitles(
      [{ stepIndex: 1, audioPath: 'x.mp3', durationMs: 2000, text: 'Enter the IBAN.' }],
      { trimStartMs: 1000, steps: [{ stepIndex: 1, startMs: 5000, endMs: 9000 }] },
      join(dir, 'demo.ass'),
    );
    const text = readFileSync(ass, 'utf-8');
    expect(text).toContain('PlayResX: 1920');
    expect(text).toContain('Dialogue: 0,0:00:04.00,0:00:06.00');
    expect(existsSync(join(dir, 'demo.srt'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/video/compose.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/video/compose.ts`**

Copy from V1 `subtitle-gen.ts` the functions `generateSubtitles` (rename to `writeSubtitles`, same body), `formatAssTime`, `formatSrtTime`, `splitIntoChunks`, `wrapText`; and from V1 `composer.ts` the functions `composeWithStepAudio` (rename to `composeVideo`, drop the `trimLogin` option and always trim by `timing.trimStartMs`) and `buildCombinedAudio`. Apply these edits:
- Replace `PlayResX: 1440` / `PlayResY: 900` with `PlayResX: 1920` / `PlayResY: 1080`, and the style font size `28` with `36`.
- Replace imports of `StepAudioClip`/`StepTimingMetadata` with `import type { Clip } from './narration.ts';` and `export type Timing = { trimStartMs: number; steps: Array<{ stepIndex: number; startMs: number; endMs: number }> };`.
- Replace `getFFmpegPath()` with `ffmpegPath()` imported from `./narration.ts`.
- Replace `info`/`debug` log calls with nothing (drop them) — the caller logs.
- Return type `{ ok: boolean; videoPath?: string; error?: string }` (V1 used `success`).

- [ ] **Step 4: Verify (including a real FFmpeg run)**

Run: `bun test tests/video/compose.test.ts && bun run typecheck`
Expected: PASS, clean.

Then compose the approved spike video as a manual check:

```bash
bun -e "
import { composeVideo } from './src/video/compose.ts';
const r = composeVideo({ videoPath: 'spikes/replay-video/results/real-iban-new-checked-per-step-2026-10-07T20-24-53/43e442a0b1d27b9c339f3b03f7c2c3bb.webm', clips: [], timing: { trimStartMs: 2000, steps: [] }, outputPath: 'output/compose-check.mp4' });
console.log(r);
"
```

Expected: `{ ok: true, videoPath: '.../output/compose-check.mp4' }`, and the mp4 plays without the first 2 s.

- [ ] **Step 5: Commit**

```bash
git add src/video/compose.ts tests/video/compose.test.ts
git commit -m "feat(video): subtitles and FFmpeg composition (ported from V1)"
```

---

### Task 7: `makeVideo` — narration → record → compose for one item

**Files:**
- Create: `src/video/make-video.ts`
- Test: `tests/video/make-video.test.ts`

**Interfaces:**
- Consumes: `loadVideoInputs`, `lintRecording` (Task 3); `recordDemo`, `RecordResult` (Task 4); `generateClips`, `Clip` (Task 5); `writeSubtitles`, `composeVideo` (Task 6).
- Produces: `type VideoResult = { ok: boolean; videoPath?: string; error?: string; failedStep?: number; steps?: RecordResult['steps'] }`; `makeVideo(input: { itemDir: string; url: string; user: string; password: string; config: AppConfig }, deps?: MakeVideoDeps): Promise<VideoResult>`; `type MakeVideoDeps = { generateClips; recordDemo; writeSubtitles; composeVideo }` (the real functions by default).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect, mock } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeVideo } from '../../src/video/make-video.ts';
import type { MakeVideoDeps } from '../../src/video/make-video.ts';
import { testConfig } from '../helpers/config.ts';

function itemDir(recording: string, narration?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'item-'));
  writeFileSync(join(dir, 'recording.yml'), recording);
  if (narration) writeFileSync(join(dir, 'narration.yml'), narration);
  return dir;
}

const goodRecording = `description: d
steps:
  - type: page-shown
    source: { page: P }
    runtimeId: a
  - type: validate
    target: [{ page: P, runtimeRef: a }, { field: F }]
    operation: "="
    value: "1"
`;

function deps(overrides: Partial<MakeVideoDeps> = {}): MakeVideoDeps {
  return {
    generateClips: mock(async () => [{ stepIndex: 0, audioPath: 'a.mp3', durationMs: 3000, text: 'Hi' }]),
    recordDemo: mock(async () => ({ ok: true, videoPath: '/v/x.webm', timing: { trimStartMs: 0, steps: [] }, steps: [] })),
    writeSubtitles: mock(() => '/v/demo.ass'),
    composeVideo: mock(() => ({ ok: true, videoPath: '/v/demo.mp4' })),
    ...overrides,
  };
}

const input = (dir: string, apiKey = 'sk') => ({
  itemDir: dir, url: 'https://bc/', user: 'u', password: 'p', config: testConfig({ openaiApiKey: apiKey }),
});

describe('makeVideo', () => {
  test('narrates, records with clip-length holds, composes', async () => {
    const d = deps();
    const r = await makeVideo(input(itemDir(goodRecording, 'steps:\n  0: Hi\n')), d);
    expect(r).toMatchObject({ ok: true, videoPath: '/v/demo.mp4' });
    const recArgs = (d.recordDemo as ReturnType<typeof mock>).mock.calls[0]![0] as { holds: Map<number, number> };
    expect(recArgs.holds.get(0)).toBe(3000);
  });

  test('a lint failure stops before any browser or TTS work', async () => {
    const d = deps();
    const r = await makeVideo(input(itemDir('description: d\nsteps:\n  - type: action\n    caption: X\n')), d);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('unknown step type "action"');
    expect(d.recordDemo).not.toHaveBeenCalled();
    expect(d.generateClips).not.toHaveBeenCalled();
  });

  test('missing OpenAI key: skipped with a reason', async () => {
    const d = deps({ generateClips: mock(async () => { throw new Error('OPENAI_API_KEY is not set; narration needs it'); }) });
    const r = await makeVideo(input(itemDir(goodRecording, 'steps:\n  0: Hi\n'), ''), d);
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toContain('OPENAI_API_KEY');
    expect(d.recordDemo).not.toHaveBeenCalled();
  });

  test('a failed recording step is reported and nothing is composed', async () => {
    const d = deps({
      recordDemo: mock(async () => ({ ok: false, failedStep: 4, error: "Field 'IBAN' was not found.", videoPath: '/v/x.webm', timing: { trimStartMs: 0, steps: [] }, steps: [] })),
    });
    const r = await makeVideo(input(itemDir(goodRecording)), d);
    expect(r).toMatchObject({ ok: false, failedStep: 4 });
    expect(r.error).toContain("step 4: Field 'IBAN' was not found.");
    expect(d.composeVideo).not.toHaveBeenCalled();
  });

  test('no narration file: records with default holds, no subtitles', async () => {
    const d = deps({ generateClips: mock(async () => []) });
    const r = await makeVideo(input(itemDir(goodRecording)), d);
    expect(r.ok).toBe(true);
    expect(d.writeSubtitles).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/video/make-video.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/video/make-video.ts`**

```ts
import { join } from 'path';
import type { AppConfig } from '../types/index.ts';
import { lintRecording, loadVideoInputs } from './recording.ts';
import { recordDemo } from './recorder.ts';
import type { RecordResult } from './recorder.ts';
import { generateClips } from './narration.ts';
import { composeVideo, writeSubtitles } from './compose.ts';

export type VideoResult = { ok: boolean; videoPath?: string; error?: string; failedStep?: number; steps?: RecordResult['steps'] };

export type MakeVideoDeps = {
  generateClips: typeof generateClips;
  recordDemo: typeof recordDemo;
  writeSubtitles: typeof writeSubtitles;
  composeVideo: typeof composeVideo;
};

const defaultDeps: MakeVideoDeps = { generateClips, recordDemo, writeSubtitles, composeVideo };

/** Narrate, record and compose the demo for one item folder. Never throws. */
export async function makeVideo(
  input: { itemDir: string; url: string; user: string; password: string; config: AppConfig },
  deps: MakeVideoDeps = defaultDeps,
): Promise<VideoResult> {
  try {
    const { recording, hints, narration } = loadVideoInputs(input.itemDir);
    const problems = lintRecording(recording);
    if (problems.length) return { ok: false, error: `recording.yml is not replayable: ${problems.join('; ')}` };

    // Keep only narration for steps that exist.
    const valid = Object.fromEntries(Object.entries(narration).filter(([k]) => Number(k) < recording.steps.length));
    const clips = await deps.generateClips(valid, input.itemDir, {
      apiKey: input.config.openaiApiKey,
      locale: input.config.videoLocale,
    });
    const holds = new Map(clips.map((c) => [c.stepIndex, c.durationMs]));

    const rec = await deps.recordDemo({
      recording, hints, holds,
      url: input.url, user: input.user, password: input.password,
      outDir: join(input.itemDir, 'video'),
      headed: input.config.videoHeaded,
    });
    if (!rec.ok || !rec.videoPath) {
      const where = rec.failedStep !== undefined ? `step ${rec.failedStep}: ` : '';
      return { ok: false, failedStep: rec.failedStep, error: `recording failed at ${where}${rec.error ?? 'no video'}`, steps: rec.steps };
    }

    const subtitlePath = clips.length ? deps.writeSubtitles(clips, rec.timing, join(input.itemDir, 'video', 'demo.ass')) : undefined;
    const composed = deps.composeVideo({
      videoPath: rec.videoPath, clips, timing: rec.timing, subtitlePath,
      outputPath: join(input.itemDir, 'demo.mp4'),
    });
    if (!composed.ok) return { ok: false, error: composed.error, steps: rec.steps };
    return { ok: true, videoPath: composed.videoPath, steps: rec.steps };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Verify**

Run: `bun test tests/video && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/video/make-video.ts tests/video/make-video.test.ts
git commit -m "feat(video): makeVideo orchestrates narration, recording and composition"
```

---

### Task 8: Pipeline video mode (generate addendum, lint gate, video step)

**Files:**
- Create: `prompts/generate-video.md`
- Modify: `src/services/pipeline.ts`, `src/types/index.ts` (`ScriptResult.video`)
- Test: `tests/services/pipeline.test.ts`

**Interfaces:**
- Consumes: `makeVideo`, `VideoResult` (Task 7), `lintRecording`, `loadVideoInputs` (Task 3).
- Produces: `PipelineOptions.mode?: ItemMode` (default `'script'`); `ScriptResult.video?: { ok: boolean; path?: string; error?: string }`; `PipelineDeps.makeVideo: (input) => Promise<VideoResult>`; `PipelineDeps.readEnvCredentials` reuse via existing `collectEnv`.

- [ ] **Step 1: Write the failing tests** (add to `tests/services/pipeline.test.ts`; extend `makeDeps` with `makeVideo: mock(async () => ({ ok: true, videoPath: '/out/42/demo.mp4' }))` and add `makeVideo` to the `satisfies PipelineDeps` object)

```ts
  test('video mode appends the video prompt and makes the video after verify', async () => {
    const { deps, query } = makeDeps();
    const result = await runPipeline(testConfig(), context, { mode: 'video' }, deps);
    const generateAppend = (query.mock.calls[0]![0].options.systemPrompt as { append: string }).append;
    expect(generateAppend).toContain('<generate-video>');
    expect(deps.makeVideo).toHaveBeenCalledTimes(1);
    const videoInput = (deps.makeVideo as ReturnType<typeof mock>).mock.calls[0]![0] as { url: string; user: string };
    expect(videoInput.url).toBe('https://bc/env-1');
    expect(videoInput.user).toBe('ADMIN');
    expect(result.status).toBe('success');
    expect(result.video).toEqual({ ok: true, path: '/out/42/demo.mp4' });
  });

  test('script mode never makes a video', async () => {
    const { deps, query } = makeDeps();
    const result = await runPipeline(testConfig(), context, {}, deps);
    expect((query.mock.calls[0]![0].options.systemPrompt as { append: string }).append).not.toContain('<generate-video>');
    expect(deps.makeVideo).not.toHaveBeenCalled();
    expect(result.video).toBeUndefined();
  });

  test('a failed video keeps the item a success and carries the reason', async () => {
    const { deps } = makeDeps();
    deps.makeVideo.mockImplementation(async () => ({ ok: false, error: 'recording failed at step 4: dialog' }));
    const result = await runPipeline(testConfig(), context, { mode: 'video' }, deps);
    expect(result.status).toBe('success');
    expect(result.video).toEqual({ ok: false, error: 'recording failed at step 4: dialog' });
  });
```

Also update `stageQuery` in that test file so the stage name is found when `<generate-video>` is appended: change `append.includes(\`<${s}>\`)` to `new RegExp(\`<${s}>\`).test(append)` (no behavior change; keeps `<generate>` matching first).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/services/pipeline.test.ts`
Expected: FAIL — `mode` not accepted, `makeVideo` not in deps, no `video` on the result.

- [ ] **Step 3: Write `prompts/generate-video.md`**

```markdown
## Stage: generate — video addendum

This item also gets a recorded video. In addition to the script and the PTE, write three files in
the same folder as the recording script file:

1. `recording.yml` — a Business Central Page Scripting recording of the demo, replayed by BC's own
   engine on a fresh environment where the PTE is installed. Use only these step shapes:

   ```yaml
   name: <short name>
   description: <one line>
   start:
     profile: BUSINESS MANAGER
   steps:
     - type: navigate                      # Role Center action
       target:
         - page: Business Manager Role Center
         - action: Bank Accounts
       description: Navigate to <caption>Bank Accounts</caption>
     - type: page-shown                    # after every page that opens
       source:
         page: Bank Account List           # AL object name of the page
       modal: false
       runtimeId: p1                       # unique id, referenced by later steps
       description: Page <caption>Bank Accounts</caption> was shown.
     - type: invoke                        # action button, by AL control name
       target:
         - page: Bank Account List
           runtimeRef: p1
         - action: Control_New
       invokeType: New
       description: Invoke <operation>Create new</operation> on <caption>New</caption>
     - type: invoke                        # open the current row of a list
       target:
         - page: Customer List
           runtimeRef: p1
         - repeater: Control1
       invokeType: Edit
       description: Invoke row on <caption>Control1</caption>
     - type: input
       target:
         - page: Bank Account Card
           runtimeRef: p2
         - field: IBAN                     # AL control name of the field
       value: NL85RABO0347427693
       description: Input <value>NL85RABO0347427693</value> into <caption>IBAN</caption>
     - type: validate                      # prove every outcome the video shows
       target:
         - page: Bank Account Card
           runtimeRef: p2
         - field: City
       operation: =
       value: UTRECHT
       description: Validate <caption>City</caption> <operation>is</operation> <value>UTRECHT</value>
   ```

   Rules: page names and action/field/repeater names are the AL object and control names from the
   continia-banking source, never captions; put the visible caption in `<caption>` in the
   description; add a `page-shown` step for every page that opens (including dialogs); end with
   `validate` steps for the values the viewer is meant to see change. If a confirmation dialog will
   appear, include its `page-shown` and the button step.

2. `recording.staging.yml` — for each field the recording touches, the caption of the FastTab
   (page group) that contains it, from the AL page source:

   ```yaml
   fieldGroups:
     IBAN: Transfer
   ```

3. `narration.yml` — one short spoken sentence or two per step the viewer should hear about,
   keyed by the step's index in `recording.yml` (0-based), matching the script's "Say:" lines:

   ```yaml
   steps:
     0: Open the list of bank accounts.
     4: Enter the IBAN. Continia Banking looks up the bank and fills in the details.
   ```
```

- [ ] **Step 4: Implement in `src/services/pipeline.ts` and `src/types/index.ts`**

`src/types/index.ts`, in `ScriptResult` after `stages?: StageUsage[];`:

```ts
  /** Video outcome, set only for video items. */
  video?: { ok: boolean; path?: string; error?: string };
```

`src/services/pipeline.ts`:
- Import: `import { makeVideo } from '../video/make-video.ts'; import type { VideoResult } from '../video/make-video.ts'; import type { ItemMode } from '../types/index.ts';`
- `PipelineOptions`: add `/** 'video' also records a demo video. Default 'script'. */ mode?: ItemMode;`
- `PipelineDeps`: add `makeVideo: (input: Parameters<typeof makeVideo>[0]) => Promise<VideoResult>;` and in `defaultPipelineDeps` add `makeVideo: (input) => makeVideo(input),`.
- In the generate stage call, replace `['invariants', 'generate']` with `options.mode === 'video' ? ['invariants', 'generate', 'generate-video'] : ['invariants', 'generate']`.
- After `state.generate = run.output;` and before `save();` in the generate block, add the lint gate:

```ts
    if (options.mode === 'video') {
      const itemDir = join(paths.scriptPath, '..');
      try {
        const problems = lintRecording(loadVideoInputs(itemDir).recording);
        if (problems.length) state.generate.gaps.push(`video: recording.yml is not replayable: ${problems.join('; ')}`);
      } catch (err) {
        state.generate.gaps.push(`video: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
```

  (Lint problems become gaps, not failures: the script and env are still worth delivering; `makeVideo` lints again and reports.) Import `lintRecording, loadVideoInputs` from `../video/recording.ts`.
- In step F, replace `const env = await collectEnv(cli, state.envId); return { ...base(), status: 'success', env };` with:

```ts
    const env = await collectEnv(cli, state.envId);
    if (options.mode !== 'video') return { ...base(), status: 'success', env };
    log('  Recording demo video...');
    const video = await deps.makeVideo({
      itemDir: join(paths.scriptPath, '..'),
      url: env.url,
      user: env.username,
      password: env.password,
      config,
    });
    if (!video.ok) log(`  Video failed: ${video.error}`);
    return {
      ...base(),
      status: 'success',
      env,
      video: video.ok ? { ok: true, path: video.videoPath } : { ok: false, error: video.error },
    };
```

- In the generate prompt's paths block, nothing changes: the video files live next to `recording-script.md` (`output/<id>/`).

Fake `itemDir` in tests resolves to `/work/output/42` — `loadVideoInputs` will throw "recording.yml not found", which lands in gaps; the video test asserts only `makeVideo` behavior, so it passes. Add `expect(result.gaps.some((g) => g.startsWith('video:'))).toBe(true);` to the first new test to pin that path.

- [ ] **Step 5: Verify**

Run: `bun run typecheck && bun run test:unit`
Expected: clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add prompts/generate-video.md src/services/pipeline.ts src/types/index.ts tests/services/pipeline.test.ts
git commit -m "feat: video mode in the pipeline (generate addendum, lint, video after verify)"
```

---

### Task 9: Processor — mode, tags, mp4 attachment, comment

**Files:**
- Modify: `src/services/processor.ts`, `src/cli/index.ts`
- Test: `tests/services/processor.test.ts`

**Interfaces:**
- Consumes: `itemMode` (Task 1), `ScriptResult.video` (Task 8), binary `uploadAttachment` (Task 2).
- Produces: `ProcessorDeps.readVideo: (path: string) => Uint8Array`, `ProcessorDeps.fileSize: (path: string) => number`; `processItem` passes `{ ...options, mode }` to `runPipeline`; removes every opt-in tag present on the item.

- [ ] **Step 1: Write the failing tests** (in `tests/services/processor.test.ts`; add `readVideo: mock(() => new Uint8Array([1, 2])), fileSize: mock(() => 1000),` to `makeDeps`, and import nothing new)

```ts
describe('processItem — video items', () => {
  const videoItem = () =>
    mockWorkItem({ fields: { ...mockWorkItem().fields, 'System.Tags': 'create video' } });

  test('runs the pipeline in video mode and attaches the mp4', async () => {
    const deps = makeDeps({
      runPipeline: mock(async () => ({ ...successResult, video: { ok: true, path: '/out/42/demo.mp4' } })),
    });
    await processItem(mockConfig(), videoItem(), deps);
    expect((deps.runPipeline as ReturnType<typeof mock>).mock.calls[0]![2]).toEqual({ mode: 'video' });
    const uploads = (deps.uploadAttachment as ReturnType<typeof mock>).mock.calls.map((c) => c[1]);
    expect(uploads).toEqual(['recording-script-42.md', 'demo-video-42.mp4']);
    const html = String((deps.addComment as ReturnType<typeof mock>).mock.calls[0]![2]);
    expect(html).toContain('demo-video-42.mp4');
    expect(deps.removeTag).toHaveBeenCalledWith(expect.anything(), 42, 'create video');
  });

  test('a failed video is explained in the comment; script still attached', async () => {
    const deps = makeDeps({
      runPipeline: mock(async () => ({ ...successResult, video: { ok: false, error: 'recording failed at step 4: dialog' } })),
    });
    const result = await processItem(mockConfig(), videoItem(), deps);
    expect(result.processed).toBe(true);
    const html = String((deps.addComment as ReturnType<typeof mock>).mock.calls[0]![2]);
    expect(html).toContain('No video was attached');
    expect(html).toContain('recording failed at step 4: dialog');
  });

  test('an mp4 over 130 MB is not uploaded', async () => {
    const deps = makeDeps({
      runPipeline: mock(async () => ({ ...successResult, video: { ok: true, path: '/out/42/demo.mp4' } })),
      fileSize: mock(() => 140 * 1024 * 1024),
    });
    await processItem(mockConfig(), videoItem(), deps);
    expect((deps.uploadAttachment as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    const html = String((deps.addComment as ReturnType<typeof mock>).mock.calls[0]![2]);
    expect(html).toContain('too large to attach');
    expect(html).toContain('/out/42/demo.mp4');
  });

  test('an item with both tags has both removed', async () => {
    const deps = makeDeps();
    const item = mockWorkItem({ fields: { ...mockWorkItem().fields, 'System.Tags': 'create script; create video' } });
    await processItem(mockConfig(), item, deps);
    const removed = (deps.removeTag as ReturnType<typeof mock>).mock.calls.map((c) => c[2]);
    expect(removed.sort()).toEqual(['create script', 'create video']);
  });
});
```

Existing test fixtures have no `System.Tags`; `itemMode` returns `undefined` for them — the processor must treat `undefined` as `'script'` and still remove `createScriptTag` (existing test `removes the create-script tag once handled` pins this).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/services/processor.test.ts`
Expected: FAIL — `readVideo`/`fileSize` not in deps; options lack `mode`; one upload only.

- [ ] **Step 3: Implement in `src/services/processor.ts`**

- Imports: `import { statSync } from 'fs';` and `itemMode` via `import * as sdk` (already imported).
- `ProcessorDeps`: add

```ts
  readVideo: (path: string) => Uint8Array;
  fileSize: (path: string) => number;
```

  and in `defaultDeps`: `readVideo: (path) => new Uint8Array(readFileSync(path)), fileSize: (path) => statSync(path).size,`.
- Constant: `const MAX_ATTACHMENT_BYTES = 130 * 1024 * 1024; // ADO's default attachment limit`.
- In `processItem`, before `try {`: `const mode = sdk.itemMode(config, item) ?? 'script';`
- Replace `result = await deps.runPipeline(config, context, options);` with `result = await deps.runPipeline(config, context, { ...options, ...(mode === 'video' ? { mode } : {}) });`
- After the script attachment is linked (after `await deps.linkAttachment(...)`), add:

```ts
    let videoNote = '';
    if (result.video?.ok && result.video.path) {
      const size = deps.fileSize(result.video.path);
      if (size > MAX_ATTACHMENT_BYTES) {
        videoNote = `<p>The demo video is too large to attach (${Math.round(size / 1048576)} MB). It is on the server at <code>${escapeHtml(result.video.path)}</code>.</p>`;
      } else {
        const videoName = `demo-video-${item.id}.mp4`;
        const video = await deps.uploadAttachment(config, videoName, deps.readVideo(result.video.path));
        await deps.linkAttachment(config, item.id, video.url, `Demo video for ${result.feature ?? title}`);
        videoNote = `<p>The demo video is attached as <code>${escapeHtml(videoName)}</code>. It is a draft: watch it before sharing.</p>`;
      }
    } else if (result.video && !result.video.ok) {
      videoNote = `<p><strong>No video was attached:</strong> ${escapeHtml(result.video.error ?? 'unknown error')}</p>`;
    }
```

  and change `buildEnvComment(result, fileName)` to accept `videoNote: string` as a third parameter, inserting it right before the bot footer line: `lines.push(...)` → add `if (videoNote) lines.push(videoNote);` before `botFooter`. Call it with `buildEnvComment(result, fileName, videoNote)`.
- Tag removal in `finally`: replace the single `deps.removeTag(config, item.id, config.createScriptTag)` call with

```ts
        const tags = String(item.fields['System.Tags'] ?? '').split(';').map((t) => t.trim().toLowerCase());
        const optIns = [config.createScriptTag, config.createVideoTag].filter((t) => tags.includes(t.toLowerCase()));
        for (const tag of optIns.length ? optIns : [config.createScriptTag]) {
          await deps.removeTag(config, item.id, tag);
        }
```

  (keep the surrounding `try/catch` that logs a failed removal).

`src/cli/index.ts`: in `test-item`, add `--video`: pass `{ resume: process.argv.includes('--resume'), ...(process.argv.includes('--video') ? { mode: 'video' as const } : {}) }` — and since the processor derives `mode` from tags, make it honor an explicit option: in `processItem`, change `const mode = …` to `const mode = options.mode ?? sdk.itemMode(config, item) ?? 'script';`. Update the help text line for `test-item` to `test-item <id> [--resume] [--video]`, and add `CREATE_VIDEO_TAG`, `OPENAI_API_KEY`, `VIDEO_LOCALE`, `VIDEO_HEADED` to the environment list.

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bun run test:unit`
Expected: clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/processor.ts src/cli/index.ts tests/services/processor.test.ts
git commit -m "feat: attach demo video for create video items"
```

---

### Task 10: Docker, docs, and end-to-end run

**Files:**
- Modify: `Dockerfile`, `.env.example`, `DEPLOY.md`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Dockerfile — Chromium and its libraries**

After `RUN bun install --frozen-lockfile` add:

```dockerfile
# Chromium for the video recorder (Playwright), with its system libraries.
RUN bunx playwright install --with-deps chromium
```

and set `ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` before that line so the browser lands outside `/root` and is readable by the `claude` user; add `chmod -R a+rx /ms-playwright` to the same `RUN`.

- [ ] **Step 2: Docs**

- `.env.example`: add, after `CREATE_SCRIPT_TAG`:

```
# Tag that also records a narrated demo video and attaches it (default: "create video")
# CREATE_VIDEO_TAG=create video
# OpenAI key for narration (text-to-speech). Required only for video items.
OPENAI_API_KEY=
# Narration locale: en-US, en-GB, da-DK, de-DE, nl-NL, no-NO, sv-SE (default: en-US)
# VIDEO_LOCALE=en-US
# Show the browser while recording (debugging only)
# VIDEO_HEADED=false
```

- `README.md`: in "How it works", add a sentence after the step table: "Items tagged `create video` run the same steps, then record the demo in the environment with BC's own replay engine, narrate it and attach `demo-video-<id>.mp4` (a draft for review)."
- `DEPLOY.md`: add `OPENAI_API_KEY` to the secrets list and a note that the image now contains Chromium.
- `CLAUDE.md`: add `src/video/` to File Layout: "`src/video/` — demo video: recording lint, BC replay session, cosmetic staging, narration, composition".

- [ ] **Step 3: Full verification**

Run: `bun run typecheck && bun run test:unit`
Expected: clean; all pass.

- [ ] **Step 4: End-to-end on a real item**

Precondition: a work item describing the IBAN auto-fill demo, `OPENAI_API_KEY` set, `CONTINIA_CLI_PATH=.tools/continia.exe`, a continia-banking clone at `CONTINIA_BANKING_PATH`.

Run: `bun src/cli/index.ts test-item <id> --video`
Expected:
- Log shows generate → validate → provision → activate → deploy → verify → "Recording demo video...".
- `output/<id>/recording.yml`, `recording.staging.yml`, `narration.yml`, `demo.mp4` exist.
- The dry-run report shows status success; `demo.mp4` plays: narration in sync, subtitles, no "Getting ready" screen, IBAN typed visibly, auto-filled fields on screen.
- `output/<id>/video/shots/` has one screenshot per step.

Watch the mp4 and compare with the approved spike baseline `spikes/replay-video/results/real-iban-new-checked-per-step-2026-10-07T20-24-53/`.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .env.example DEPLOY.md README.md CLAUDE.md
git commit -m "docs: create video tag setup; Chromium in the image"
```

---

## Out of scope (follow-ups)

- Repair loop for failed recordings (fix `recording.yml`, re-record on a fresh environment).
- Horizontal grid scrolling verification (needs a wide list scenario with demo data).
- Vision-based quality check of the final frames (run the small eval first).
- Closing teaching tips the moment a page opens (today: before the next step).
