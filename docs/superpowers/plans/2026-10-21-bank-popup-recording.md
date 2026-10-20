# Bank Pop-up Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the bank's own onboarding pop-up (e.g. BANKSapi - PSD2) inside the demo video, using a bank sandbox login, so a direct-communication demo runs to "Status Ready" instead of stopping at "Connect Bank Account".

**Architecture:** BC's replay engine only drives BC pages, so the pop-up gets its own small script, `popup.yml`: the BC step whose click opens it, then role/name-based Playwright actions with `{{user}}`-style placeholders. The recording agent writes it after exploring the pop-up with the sandbox login (the browser from the exploration plan). The recorder waits for the pop-up when that BC step runs, plays `popup.yml` on it with the same visible cursor and typing, and keeps the pop-up's own video and timing. Composition overlays the pop-up video on the main video for its time span. Sandbox logins live in one config secret keyed by bank system name.

**Tech Stack:** Bun + TypeScript, Playwright 1.55.1 (`context.waitForEvent('page')`, per-page `recordVideo`), FFmpeg (`overlay` with `enable`), Zod.

**Spec:** this plan; the design was agreed in conversation on 2026-10-21 ("The bank's sandbox onboarding").

## Gate

Start only when all three hold:
1. A `create video` run of item 84919 produced a video ending on the **Connect Bank Account** click.
2. `docs/superpowers/plans/2026-10-21-recording-exploration.md` is implemented (the agent needs the browser to explore the pop-up).
3. A sandbox login exists for the bank system (e.g. a BANKSapi test bank user) and is stored in the VM's `.env.create-scripts`.

## Global Constraints

- Sandbox logins are test credentials, but they still never go into git, `popup.yml`, logs or ADO comments. `popup.yml` holds placeholders only (`{{user}}`, `{{password}}`, or another key of that bank system's entry).
- No sandbox login for the item's bank system: the recording ends at the click that opens the pop-up (the exploration plan's rule), and the pop-up is not attempted.
- A pop-up failure fails the video, not the item: the script and environment are still delivered, and the comment says why there is no video (existing `video.ok = false` path).
- Pop-up selectors are role + accessible name or visible text, never CSS classes: the bank's markup changes, its labels rarely do.
- Comments and prompts follow the repo's style: plain English, short sentences.

## Review Focus

- The pop-up never opens (popup blocker, click on the wrong element): the recorder must fail that step with "pop-up did not open within 30 s", not hang. Test: Task 3 `waitForPopup times out with a clear error`.
- The pop-up stays open after the last scripted action (the bank shows a final "close this window" page): with `closes: true` the recorder waits up to 60 s, then fails clearly. Test: Task 3 `waitForClose times out with a clear error`.
- A placeholder with no value in the bank system's entry (typo `{{pasword}}`): caught by the recording check before recording, naming the key. Test: Task 2 `unknown placeholder is a problem`.
- `popup.yml` triggers a step that is not a BC `invoke` (e.g. a `page-shown`): rejected by the check. Test: Task 2 `trigger must be an invoke step`.
- The pop-up video starts before the main video was trimmed (`trimStartMs`): overlay offset must subtract the trim. Test: Task 4 `overlay offset accounts for the trim`.

---

## File Structure

- Modify `src/config/index.ts`, `src/types/index.ts`: `BANK_SANDBOX_CREDENTIALS` -> `config.bankSandboxCredentials`.
- Create `src/video/popup.ts`: `popup.yml` types, loading, lint, placeholder resolution, locator choice.
- Modify `src/video/recording-check.ts`: lint `popup.yml` when present.
- Modify `src/video/recorder.ts`: wait for, play and time the pop-up.
- Modify `src/video/compose.ts`: overlay the pop-up video.
- Modify `src/video/make-video.ts`: load `popup.yml`, resolve placeholders, pass them on.
- Modify `src/services/pipeline.ts`, `prompts/recording.md`: tell the agent which sandbox logins exist and how to write `popup.yml`.
- Tests: `tests/config/config.test.ts`, `tests/video/popup.test.ts` (new), `tests/video/recorder.test.ts`, `tests/video/compose.test.ts`, `tests/services/pipeline.test.ts`.

---

### Task 1: Sandbox login config

**Files:**
- Modify: `src/config/index.ts`, `src/types/index.ts`
- Test: `tests/config/config.test.ts`, plus `bankSandboxCredentials: {}` in every test `AppConfig` literal (`tests/helpers/config.ts`, `tests/sdk/azure-devops-client.test.ts`, `tests/services/processor.test.ts`, `tests/services/pruner.integration.test.ts`, `tests/services/pruner.test.ts`, `tests/services/watcher.test.ts`).

**Interfaces:**
- Produces: `AppConfig.bankSandboxCredentials: Record<string, Record<string, string>>` — bank system name (as BC shows it, e.g. `"BANKSapi - PSD2"`) to placeholder key to value.

- [ ] **Step 1: Write the failing tests**

```ts
    it("reads BANK_SANDBOX_CREDENTIALS as bank system -> placeholder -> value", () => {
      const json = '{"BANKSapi - PSD2":{"user":"demo1","password":"s3cret"}}';
      expect(loadConfig({ ...validEnv, BANK_SANDBOX_CREDENTIALS: json }).bankSandboxCredentials)
        .toEqual({ "BANKSapi - PSD2": { user: "demo1", password: "s3cret" } });
      expect(loadConfig(validEnv).bankSandboxCredentials).toEqual({});
    });

    it("rejects BANK_SANDBOX_CREDENTIALS that is not that shape", () => {
      expect(() => loadConfig({ ...validEnv, BANK_SANDBOX_CREDENTIALS: '{"x":"y"}' })).toThrow("BANK_SANDBOX_CREDENTIALS");
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/config`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/config/index.ts`, in `envSchema`:

```ts
  // Bank sandbox logins for recording a bank's own onboarding pop-up, as JSON:
  // {"<bank system name>": {"user": "...", "password": "..."}}. Keys become {{placeholders}}.
  BANK_SANDBOX_CREDENTIALS: z.string().default("{}"),
```

and in `loadConfig`, before the return:

```ts
  const creds = z.record(z.string(), z.record(z.string(), z.string())).safeParse(
    (() => { try { return JSON.parse(parsed.BANK_SANDBOX_CREDENTIALS); } catch { return null; } })(),
  );
  if (!creds.success) throw new Error("Invalid configuration:\n  - BANK_SANDBOX_CREDENTIALS: expected {\"<bank system>\": {\"<key>\": \"<value>\"}}");
```

returning `bankSandboxCredentials: creds.data`. Add the field with a doc comment to `AppConfig`, and `bankSandboxCredentials: {}` to each test config literal listed above.

- [ ] **Step 4: Run tests**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/index.ts src/types/index.ts tests
git commit -m "feat(config): bank sandbox logins for recording onboarding pop-ups"
```

---

### Task 2: `popup.yml` format and check

**Files:**
- Create: `src/video/popup.ts`
- Modify: `src/video/recording-check.ts`
- Test: `tests/video/popup.test.ts`

**Interfaces:**
- Produces:

```ts
export type PopupStep = {
  action: 'click' | 'fill' | 'press' | 'wait-for';
  role?: string;          // ARIA role for getByRole, e.g. 'button', 'textbox', 'link'
  name?: string;          // accessible name for getByRole
  text?: string;          // visible text for getByText, when role/name don't fit
  value?: string;         // fill: text or {{placeholder}}; press: key name, e.g. 'Enter'
};
export type Popup = { trigger: number; bankSystem: string; closes: boolean; steps: PopupStep[] };
export function loadPopup(itemDir: string): Popup | undefined;
export function lintPopup(popup: Popup, recording: Recording, placeholders: string[]): string[];
export function resolveValue(value: string, values: Record<string, string>): string;
```

- [ ] **Step 1: Write the failing tests**

`tests/video/popup.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import { lintPopup, resolveValue } from '../../src/video/popup.ts';
import type { Popup } from '../../src/video/popup.ts';
import type { Recording } from '../../src/video/recording.ts';

const recording: Recording = {
  description: 'd',
  steps: [
    { type: 'page-shown', source: { page: 'X' }, runtimeId: 'p1' },
    { type: 'invoke', target: [{ page: 'X' }, { action: 'ConnectBankAccount' }] },
  ],
};
const popup = (o: Partial<Popup> = {}): Popup => ({
  trigger: 1, bankSystem: 'BANKSapi - PSD2', closes: true,
  steps: [
    { action: 'fill', role: 'textbox', name: 'User', value: '{{user}}' },
    { action: 'fill', role: 'textbox', name: 'Password', value: '{{password}}' },
    { action: 'click', role: 'button', name: 'Log in' },
  ],
  ...o,
});

describe('lintPopup', () => {
  test('a well-formed pop-up has no problems', () => {
    expect(lintPopup(popup(), recording, ['user', 'password'])).toEqual([]);
  });
  test('trigger must be an invoke step', () => {
    expect(lintPopup(popup({ trigger: 0 }), recording, ['user', 'password'])).toEqual(['popup.yml: trigger 0 is a page-shown step; it must be the invoke that opens the pop-up']);
  });
  test('unknown placeholder is a problem', () => {
    const p = popup({ steps: [{ action: 'fill', role: 'textbox', name: 'Password', value: '{{pasword}}' }] });
    expect(lintPopup(p, recording, ['user', 'password'])).toEqual(['popup.yml step 0: no value for {{pasword}} in the BANKSapi - PSD2 sandbox login (keys: user, password)']);
  });
  test('a step needs role+name or text', () => {
    const p = popup({ steps: [{ action: 'click', role: 'button' }] });
    expect(lintPopup(p, recording, [])).toEqual(['popup.yml step 0: give role and name, or text']);
  });
  test('a literal secret-looking fill is rejected; only placeholders', () => {
    const p = popup({ steps: [{ action: 'fill', role: 'textbox', name: 'Password', value: 's3cret' }] });
    expect(lintPopup(p, recording, ['password'])).toEqual(['popup.yml step 0: fill a password field with a {{placeholder}}, not a literal']);
  });
});

test('resolveValue swaps placeholders and leaves plain text', () => {
  expect(resolveValue('{{user}}', { user: 'demo1' })).toBe('demo1');
  expect(resolveValue('Commerzbank', { user: 'demo1' })).toBe('Commerzbank');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/video/popup.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/video/popup.ts`**

```ts
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';
import type { Recording } from './recording.ts';

/**
 * popup.yml: the bank's own onboarding window, which BC's replay engine can't
 * drive. Playwright plays these steps on the pop-up that the trigger step opens.
 */

export type PopupStep = { action: 'click' | 'fill' | 'press' | 'wait-for'; role?: string; name?: string; text?: string; value?: string };
export type Popup = { trigger: number; bankSystem: string; closes: boolean; steps: PopupStep[] };

const PLACEHOLDER = /^\{\{(\w+)\}\}$/;

export function loadPopup(itemDir: string): Popup | undefined {
  const path = join(itemDir, 'popup.yml');
  return existsSync(path) ? (parse(readFileSync(path, 'utf-8')) as Popup) : undefined;
}

export function lintPopup(popup: Popup, recording: Recording, placeholders: string[]): string[] {
  const problems: string[] = [];
  const trigger = recording.steps[popup.trigger];
  if (!trigger) problems.push(`popup.yml: trigger ${popup.trigger} is not a step of recording.yml`);
  else if (trigger.type !== 'invoke') problems.push(`popup.yml: trigger ${popup.trigger} is a ${trigger.type} step; it must be the invoke that opens the pop-up`);
  popup.steps.forEach((s, i) => {
    if (!((s.role && s.name) || s.text)) problems.push(`popup.yml step ${i}: give role and name, or text`);
    const key = s.value ? PLACEHOLDER.exec(s.value)?.[1] : undefined;
    if (key && !placeholders.includes(key)) {
      problems.push(`popup.yml step ${i}: no value for {{${key}}} in the ${popup.bankSystem} sandbox login (keys: ${placeholders.join(', ')})`);
    }
    if (s.action === 'fill' && !key && /pass|pin|tan/i.test(s.name ?? s.text ?? '')) {
      problems.push(`popup.yml step ${i}: fill a password field with a {{placeholder}}, not a literal`);
    }
  });
  return problems;
}

export function resolveValue(value: string, values: Record<string, string>): string {
  const key = PLACEHOLDER.exec(value)?.[1];
  return key && values[key] !== undefined ? values[key] : value;
}
```

- [ ] **Step 4: Hook it into the recording check**

`checkRecording(itemDir, index)` in `src/video/recording-check.ts` gains a third parameter `placeholdersFor: (bankSystem: string) => string[] = () => []` and, after the existing checks:

```ts
  const popup = loadPopup(itemDir);
  if (popup) problems.push(...lintPopup(popup, recording, placeholdersFor(popup.bankSystem)));
```

The CLI `recording-check` command passes `(system) => Object.keys(loadConfig(process.env, { requireAdo: false }).bankSandboxCredentials[system] ?? {})`; the pipeline's `checkRecording` dep passes the same from `config`.

- [ ] **Step 5: Run tests**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/video/popup.ts src/video/recording-check.ts src/cli/index.ts src/services/pipeline.ts tests/video/popup.test.ts
git commit -m "feat(video): popup.yml for a bank's onboarding window, checked before recording"
```

---

### Task 3: Recorder plays the pop-up

**Files:**
- Modify: `src/video/popup.ts` (`playPopup`, `popupLocator`)
- Modify: `src/video/recorder.ts` (`RecordOptions`, the step loop, `RecordResult`)
- Test: `tests/video/popup.test.ts`

**Interfaces:**
- Consumes: `Popup`, `resolveValue` (Task 2); `injectCursor`, `animateClick` from `src/video/cursor.ts`.
- Produces:
  - `RecordOptions.popup?: { script: Popup; values: Record<string, string> }`
  - `RecordResult.timing.popup?: { videoPath: string; startMs: number; endMs: number }` (on `Timing` in `compose.ts`)
  - `export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T>`

- [ ] **Step 1: Write the failing tests**

```ts
import { withTimeout, popupLocator } from '../../src/video/popup.ts';

test('waitForPopup times out with a clear error', async () => {
  await expect(withTimeout(new Promise(() => {}), 20, 'pop-up did not open within 30 s')).rejects.toThrow('pop-up did not open within 30 s');
});

test('waitForClose times out with a clear error', async () => {
  await expect(withTimeout(new Promise(() => {}), 20, 'pop-up still open 60 s after its last step')).rejects.toThrow('pop-up still open 60 s after its last step');
});

test('popupLocator prefers role+name, falls back to text', () => {
  const calls: unknown[] = [];
  const page = {
    getByRole: (role: string, o: unknown) => (calls.push(['role', role, o]), 'R'),
    getByText: (t: string, o: unknown) => (calls.push(['text', t, o]), 'T'),
  };
  expect(popupLocator(page as never, { action: 'click', role: 'button', name: 'Log in' })).toBe('R');
  expect(popupLocator(page as never, { action: 'click', text: 'Commerzbank' })).toBe('T');
  expect(calls).toEqual([['role', 'button', { name: 'Log in', exact: true }], ['text', 'Commerzbank', { exact: true }]]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/video/popup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `src/video/popup.ts`**

```ts
import type { Locator, Page } from 'playwright';
import { animateClick, injectCursor } from './cursor.ts';

const TYPE_DELAY_MS = 70;
export const POPUP_OPEN_MS = 30_000;
export const POPUP_CLOSE_MS = 60_000;

export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function popupLocator(page: Pick<Page, 'getByRole' | 'getByText'>, s: PopupStep): Locator {
  return s.role && s.name
    ? page.getByRole(s.role as Parameters<Page['getByRole']>[0], { name: s.name, exact: true })
    : page.getByText(s.text!, { exact: true });
}

/** Play the steps on the pop-up with the same visible cursor and typing as the BC steps. */
export async function playPopup(page: Page, popup: Popup, values: Record<string, string>): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await injectCursor(page);
  for (const [i, s] of popup.steps.entries()) {
    const target = popupLocator(page, s);
    await target.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {
      throw new Error(`pop-up step ${i}: "${s.name ?? s.text}" not visible`);
    });
    if (s.action === 'wait-for') continue;
    const box = await target.boundingBox();
    if (box) await animateClick(page, box.x + box.width / 2, box.y + box.height / 2);
    if (s.action === 'click') await target.click();
    if (s.action === 'fill') await target.pressSequentially(resolveValue(s.value ?? '', values), { delay: TYPE_DELAY_MS });
    if (s.action === 'press') await target.press(s.value ?? 'Enter');
  }
  if (popup.closes) {
    await withTimeout(page.waitForEvent('close', { timeout: 0 }), POPUP_CLOSE_MS, 'pop-up still open 60 s after its last step');
  }
}
```

- [ ] **Step 4: Wire it into `recordDemo`**

In `src/video/recorder.ts`, add `popup?: { script: Popup; values: Record<string, string> }` to `RecordOptions`. In the step loop, around the existing `play(page, sliceFor(...))` call:

```ts
        const opensPopup = opts.popup?.script.trigger === index;
        const popupPage = opensPopup
          ? withTimeout(page.context().waitForEvent('page', { timeout: 0 }), POPUP_OPEN_MS, 'pop-up did not open within 30 s')
          : undefined;
        try {
          const result = await play(page, sliceFor(opts.recording, index));
          entry.error = errorText(result.error) ?? errorText(result.fileErrors);
        } catch (err) {
          entry.error = `recorder: ${String(err)}`;
        }
        if (popupPage && !entry.error) {
          try {
            const pop = await popupPage;
            const popupStart = Date.now() - videoStart;
            await playPopup(pop, opts.popup!.script, opts.popup!.values);
            const popupVideo = await pop.video()?.path();
            if (popupVideo) timing.popup = { videoPath: popupVideo, startMs: popupStart, endMs: Date.now() - videoStart };
          } catch (err) {
            entry.error = `pop-up: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
```

Add `popup?: { videoPath: string; startMs: number; endMs: number }` to `Timing` in `src/video/compose.ts`. Never log `values`.

- [ ] **Step 5: Run tests**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/video/popup.ts src/video/recorder.ts src/video/compose.ts tests/video/popup.test.ts
git commit -m "feat(video): recorder plays the bank pop-up and keeps its video and timing"
```

---

### Task 4: Composition overlays the pop-up

**Files:**
- Modify: `src/video/compose.ts` (`popupOverlay`, `composeVideo`)
- Test: `tests/video/compose.test.ts`

**Interfaces:**
- Consumes: `Timing.popup` (Task 3).
- Produces: `export function popupOverlay(popup: NonNullable<Timing['popup']>, trimMs: number, vFilters: string[]): { inputArgs: string[]; filterComplex: string }`

- [ ] **Step 1: Write the failing tests**

```ts
import { popupOverlay } from '../../src/video/compose.ts';

describe('popupOverlay', () => {
  test('overlay offset accounts for the trim', () => {
    const o = popupOverlay({ videoPath: '/v/pop.webm', startMs: 12_000, endMs: 30_500 }, 2_000, ['trim=start=2.000,setpts=PTS-STARTPTS']);
    expect(o.inputArgs).toEqual(['-itsoffset 10.000', '-i "/v/pop.webm"']);
    expect(o.filterComplex).toBe(
      "[0:v]trim=start=2.000,setpts=PTS-STARTPTS[base];[base][2:v]overlay=enable='between(t,10.000,28.500)'[v]",
    );
  });

  test('no main-video filters: the base is the raw input', () => {
    const o = popupOverlay({ videoPath: '/v/pop.webm', startMs: 1_000, endMs: 2_000 }, 0, []);
    expect(o.filterComplex).toBe("[0:v]null[base];[base][2:v]overlay=enable='between(t,1.000,2.000)'[v]");
  });
});
```

(Input 2 is the pop-up: input 0 is the main video, input 1 the narration audio.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/video/compose.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/** Lay the pop-up's own video over the main one for the time it was open (after the trim). */
export function popupOverlay(
  popup: NonNullable<Timing['popup']>,
  trimMs: number,
  vFilters: string[],
): { inputArgs: string[]; filterComplex: string } {
  const start = Math.max(0, popup.startMs - trimMs) / 1000;
  const end = Math.max(0, popup.endMs - trimMs) / 1000;
  const base = vFilters.length ? vFilters.join(',') : 'null';
  return {
    inputArgs: [`-itsoffset ${start.toFixed(3)}`, `-i "${resolve(popup.videoPath)}"`],
    filterComplex: `[0:v]${base}[base];[base][2:v]overlay=enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[v]`,
  };
}
```

In `composeVideo`, when `timing.popup` exists and its file exists: push `overlay.inputArgs` after the audio input, replace the `-vf` part with `-filter_complex "${overlay.filterComplex}"`, and map `-map "[v]"` instead of `-map 0:v:0`. Without a pop-up, the command stays exactly as today.

Subtitles are burned in `vFilters`, which run on the base before the overlay; while the pop-up covers the screen its narration subtitles are hidden. Accept that for the first version (note it in the run notes if the trigger step has narration).

- [ ] **Step 4: Run tests**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/video/compose.ts tests/video/compose.test.ts
git commit -m "feat(video): compose the bank pop-up's video over the main one"
```

---

### Task 5: Pipeline, make-video and the recording prompt

**Files:**
- Modify: `src/video/make-video.ts`, `src/services/pipeline.ts`, `prompts/recording.md`
- Test: `tests/video/make-video.test.ts`, `tests/services/pipeline.test.ts`

**Interfaces:**
- Consumes: `loadPopup`, `lintPopup`, `RecordOptions.popup`, `config.bankSandboxCredentials`.

- [ ] **Step 1: Write the failing tests**

`tests/video/make-video.test.ts` (use the file's existing fakes for `recordDemo` and an item folder fixture with a `popup.yml`):

```ts
test('passes popup.yml with the sandbox login values to the recorder', async () => {
  // itemDir fixture holds recording.yml (step 1 = invoke) and popup.yml (bankSystem 'BANKSapi - PSD2', trigger 1)
  const config = testConfig({ bankSandboxCredentials: { 'BANKSapi - PSD2': { user: 'demo1', password: 's3cret' } } });
  await makeVideo({ itemDir, url: 'u', user: 'u', password: 'p', config }, deps);
  const opts = deps.recordDemo.mock.calls[0]![0];
  expect(opts.popup.script.trigger).toBe(1);
  expect(opts.popup.values).toEqual({ user: 'demo1', password: 's3cret' });
});

test('popup.yml for a bank system with no sandbox login fails the video before recording', async () => {
  const result = await makeVideo({ itemDir, url: 'u', user: 'u', password: 'p', config: testConfig() }, deps);
  expect(result.ok).toBe(false);
  expect(result.error).toContain('no sandbox login for BANKSapi - PSD2');
  expect(deps.recordDemo).not.toHaveBeenCalled();
});
```

`tests/services/pipeline.test.ts`:

```ts
test('the recording prompt lists sandbox logins by bank system and key, never the values', async () => {
  const { deps, query } = makeDeps();
  const config = testConfig({ bankSandboxCredentials: { 'BANKSapi - PSD2': { user: 'demo1', password: 's3cret' } } });
  await runPipeline(config, context, { mode: 'video' }, deps);
  const prompt = query.mock.calls[3]![0].prompt as string;
  expect(prompt).toContain('BANKSapi - PSD2: {{user}}, {{password}}');
  expect(prompt).not.toContain('s3cret');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/video/make-video.test.ts tests/services/pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/video/make-video.ts`, after the `lintRecording` check:

```ts
    const script = loadPopup(input.itemDir);
    let popup: RecordOptions['popup'];
    if (script) {
      const values = input.config.bankSandboxCredentials[script.bankSystem];
      if (!values) return { ok: false, error: `popup.yml needs a sandbox login, but there is no sandbox login for ${script.bankSystem}` };
      const popupProblems = lintPopup(script, recording, Object.keys(values));
      if (popupProblems.length) return { ok: false, error: popupProblems.join('; ') };
      popup = { script, values };
    }
```

and pass `popup` to `deps.recordDemo({...})`.

`src/services/pipeline.ts`: the exploration plan builds the Exploration block with `[...].join('\n')`; turn that array into `const lines = [...]`, add the following before joining, then `explorationBlock = lines.join('\n')`:

```ts
        const logins = Object.entries(config.bankSandboxCredentials);
        if (logins.length) {
          lines.push(
            '- Bank sandbox logins (exploration only; write placeholders in popup.yml):',
            ...logins.map(([system, values]) => `  - ${system}: ${Object.keys(values).map((k) => `{{${k}}}`).join(', ')}`),
            `- The values are in the environment variable BANK_SANDBOX_CREDENTIALS (JSON). Read them only to type into the pop-up while exploring.`,
          );
        }
```

The agent reads the values from its own environment (`agentEnv` passes host env through, `AZURE_DEVOPS_*` excepted), so they never appear in the prompt or transcript header.

`prompts/recording.md`, replace the exploration rule "Stop at the step that leaves Business Central…" with:

```markdown
- When a click opens a pop-up on another site (a bank's own login):
  - If the Exploration section lists a sandbox login for that bank system, walk the pop-up too,
    typing that bank system's values from `BANK_SANDBOX_CREDENTIALS`. Then write
    `popup.yml` next to `recording.yml`: `trigger` (index of the invoke step that opens it),
    `bankSystem` (exactly as listed), `closes` (true if the pop-up closes itself at the end), and
    `steps` with `action` (click, fill, press, wait-for), `role` + `name` (or `text`) as the
    pop-up's accessibility snapshot shows them, and `value`. Fill logins with `{{key}}`
    placeholders only, never the values.
  - If no sandbox login is listed, stop there: the recording ends with the click that opens it.
```

- [ ] **Step 4: Run tests**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Verify on a real item**

Add to the VM's `.env.create-scripts`:

```bash
BANK_SANDBOX_CREDENTIALS={"BANKSapi - PSD2":{"user":"<sandbox user>","password":"<sandbox password>"}}
```

Rebuild, retag item 84919 with `create video`. Expected: `output/84919/popup.yml` exists with placeholders only; `grep -r "<sandbox password>" output/84919` finds nothing; `demo.mp4` shows the BANKSapi pop-up between the Connect Bank Account click and the wizard's final page; the status ends Ready (or Pending, as the script allows).

- [ ] **Step 6: Commit**

```bash
git add src/video/make-video.ts src/services/pipeline.ts prompts/recording.md tests
git commit -m "feat(video): record the bank's onboarding pop-up with a sandbox login"
```
