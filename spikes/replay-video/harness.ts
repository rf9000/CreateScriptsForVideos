/**
 * Spike harness: replay a BC Page Scripting recording through BC's own engine
 * (window.DN.playRecording — what @microsoft/bc-replay calls) while recording
 * video, and measure whether it is reliable enough to build demo videos on.
 *
 *   --mode whole      one playRecording call for the whole recording (= bc-replay)
 *   --mode per-step   one call per top-level step, with a cosmetic cursor glide
 *                     before each step and a hold after it (= how a demo recorder
 *                     would pace steps to narration)
 *
 * Usage: node --env-file=.env harness.ts --recording recordings/x.yml --mode per-step [--headed]
 *        [--hold-ms 1500] [--keep-start] [--no-cursor] [--continue] [--out dir]
 * Env:   BC_URL (web client start address), BC_USER, BC_PASS (UserPassword auth)
 */
import { chromium } from 'playwright';
import type { Frame, Locator, Page } from 'playwright';
import { parse, stringify } from 'yaml';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { animateClick, injectCursor } from './cursor.ts';

type Target = { page?: string; field?: string; action?: string; part?: string; [k: string]: unknown };
type Step = {
  type: string;
  target?: Target[];
  caption?: string;
  row?: number | string;
  value?: unknown;
  description?: string;
  steps?: Step[];
  [k: string]: unknown;
};
type Recording = { name?: string; description: string; start?: Record<string, unknown>; steps: Step[] };
type PlayResult = {
  stepsReplayed?: number;
  error?: unknown;
  hasWarnings?: boolean;
  fileErrors?: unknown;
  recording?: unknown;
};

const NAV_TIMEOUT_MS = 60_000;
const VIEWPORT = { width: 1920, height: 1080 };

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const recordingPath = opt('recording');
const mode = opt('mode', 'per-step');
if (!recordingPath || (mode !== 'whole' && mode !== 'per-step')) {
  console.error('Usage: harness.ts --recording <file.yml> --mode whole|per-step [--headed] [--hold-ms N] [--keep-start] [--no-cursor] [--continue] [--out dir]');
  process.exit(2);
}
const holdMs = Number(opt('hold-ms', '1500'));
const headed = flag('headed');
const keepStart = flag('keep-start');
const useCursor = !flag('no-cursor');
const continueOnError = flag('continue');
const bcUrl = process.env['BC_URL'];
const bcUser = process.env['BC_USER'];
const bcPass = process.env['BC_PASS'] ?? '';
if (!bcUrl || !bcUser) {
  console.error('Set BC_URL and BC_USER (and BC_PASS) in spikes/replay-video/.env');
  process.exit(2);
}

const recording = parse(readFileSync(recordingPath, 'utf-8')) as Recording;
if (!recording?.description || !Array.isArray(recording.steps)) {
  console.error(`${recordingPath} is not a valid recording (needs description and steps)`);
  process.exit(2);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(opt('out', join('results', `${basename(recordingPath, '.yml')}-${mode}-${stamp}`))!);
mkdirSync(join(outDir, 'shots'), { recursive: true });

const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// ---------- BC helpers (same logic as bc-replay's Commands.js) ----------
function startAddress(): string {
  const url = new URL(bcUrl!);
  const profile = recording.start?.['profile'];
  if (typeof profile === 'string') url.searchParams.set('profile', profile);
  return url.toString().replaceAll('+', '%20');
}

/** Wait until BC is idle in the main page and its iframe; return the BC frame. */
async function awaitFrame(page: Page, timeout = NAV_TIMEOUT_MS): Promise<Frame> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
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

const isDetached = (err: unknown) =>
  /detached|Execution context was destroyed|Target closed|navigation/i.test(String(err));

/** DN.playRecording with bc-replay's suspend/resume loop for steps that navigate. */
async function play(page: Page, rec: Recording): Promise<PlayResult> {
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

const errorText = (e: unknown): string | undefined => {
  if (e === undefined || e === null || e === false) return undefined;
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e && 'message' in e) return String((e as { message: unknown }).message);
  return JSON.stringify(e);
};

// ---------- cosmetic cursor targeting (best effort; failure only loses the glide) ----------
async function firstVisible(candidates: Locator[]): Promise<Locator | undefined> {
  for (const c of candidates) {
    const n = await c.count().catch(() => 0);
    for (let i = n - 1; i >= 0; i--) {
      // Last visible match wins: BC edit mode renders duplicates after the originals.
      const el = c.nth(i);
      if (await el.isVisible().catch(() => false)) return el;
    }
  }
  return undefined;
}

async function cursorTarget(frame: Frame, step: Step): Promise<Locator | undefined> {
  const dialog = frame.locator('[role=dialog]:visible').last();
  const scopes = (await dialog.count()) > 0 ? [dialog, frame.locator('body')] : [frame.locator('body')];
  const field = step.target?.find((t) => t.field)?.field;
  const action = step.caption ?? step.target?.find((t) => t.action)?.action;

  for (const scope of scopes) {
    if (step.type === 'input' && field) {
      const hit = await firstVisible([
        scope.getByRole('textbox', { name: field, exact: true }),
        scope.getByRole('combobox', { name: field, exact: true }),
        scope.getByRole('checkbox', { name: field, exact: true }),
        scope.locator(`[controlname="${field}"] input`),
      ]);
      if (hit) return hit;
    } else if (action) {
      const hit = await firstVisible([
        scope.getByRole('menuitem', { name: action, exact: true }),
        scope.getByRole('button', { name: action, exact: true }),
        scope.getByRole('link', { name: action, exact: true }),
        scope.getByRole('menuitemradio', { name: action, exact: true }),
        scope.getByText(action, { exact: true }),
      ]);
      if (hit) return hit;
    } else if (step.row !== undefined) {
      const rows = scope.locator('table.ms-nav-grid-data-table tbody tr, [role=grid] [role=row]');
      if (typeof step.row === 'number') {
        const n = await rows.count();
        // Grid rows may include a header row; try the nth data row from the last grid.
        const hit = await firstVisible([rows.nth(Math.min(step.row, Math.max(n - 1, 0)))]);
        if (hit) return hit;
      } else {
        const hit = await firstVisible([rows.filter({ hasText: String(step.row) })]);
        if (hit) return hit;
      }
    }
  }
  return undefined;
}

function describe(step: Step): string {
  const field = step.target?.find((t) => t.field)?.field;
  if (step.type === 'input') return `input ${field ?? '?'} = ${String(step.value)}`;
  if (step.caption) return `action "${step.caption}"`;
  if (step.row !== undefined) return `row ${String(step.row)}`;
  if (step.type === 'scope') return `scope (${step.steps?.length ?? 0} steps)`;
  return step.type;
}

// ---------- run ----------
type StepLog = {
  index: number;
  step: string;
  replayed?: number;
  error?: string;
  warnings?: boolean;
  cursor: 'found' | 'missing' | 'off';
  ms: number;
};

const browser = await chromium.launch({ headless: !headed });
const summary: Record<string, unknown> = { recording: recordingPath, mode, startedAt: new Date().toISOString() };
const stepLogs: StepLog[] = [];
let videoPath: string | undefined;

try {
  // Phase A: log in off camera, then carry the session into the recorded context.
  log(`Logging in at ${startAddress()}`);
  const auth = await browser.newContext({ viewport: VIEWPORT });
  const authPage = await auth.newPage();
  await authPage.goto(startAddress());
  const userInput = authPage.locator('input[name=UserName]');
  if (await userInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await userInput.fill(bcUser!);
    await authPage.fill('input[name=Password]', bcPass);
    await Promise.all([
      authPage.waitForNavigation({ timeout: NAV_TIMEOUT_MS }),
      authPage.click('button[type=submit]'),
    ]);
  }
  await awaitFrame(authPage);
  const cookies = await auth.cookies();
  const landed = authPage.url();
  await auth.close();

  // Phase B: recorded context.
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: outDir, size: VIEWPORT },
  });
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.goto(landed);
  await awaitFrame(page);
  if (useCursor && mode === 'per-step') await injectCursor(page);
  await page.waitForTimeout(500);
  const started = Date.now();

  if (mode === 'whole') {
    const result = await play(page, recording);
    await awaitFrame(page).catch(() => {});
    await page.screenshot({ path: join(outDir, 'shots', 'final.png') });
    summary['result'] = {
      stepsReplayed: result.stepsReplayed,
      error: errorText(result.error),
      hasWarnings: result.hasWarnings,
      fileErrors: result.fileErrors,
    };
    writeFileSync(join(outDir, 'replay-log.yml'), stringify(result.recording ?? null));
    log(`Replayed ${result.stepsReplayed ?? 0}/${recording.steps.length} top-level steps` +
      (errorText(result.error) ? ` — ERROR: ${errorText(result.error)}` : ''));
  } else {
    for (const [index, step] of recording.steps.entries()) {
      const t0 = Date.now();
      const entry: StepLog = { index, step: describe(step), cursor: useCursor ? 'missing' : 'off', ms: 0 };
      const frame = await awaitFrame(page);

      if (useCursor) {
        const target = await cursorTarget(frame, step).catch(() => undefined);
        const box = target ? await target.boundingBox().catch(() => null) : null;
        if (box) {
          // boundingBox() is relative to the main viewport, so no iframe offset is needed.
          await animateClick(page, box.x + box.width / 2, box.y + box.height / 2);
          entry.cursor = 'found';
        }
      }

      const slice: Recording = {
        name: recording.name,
        description: `${recording.description} — step ${index}`,
        // Without this, every slice would navigate back to the start page.
        ...(index === 0 || keepStart ? { start: recording.start } : {}),
        steps: [step],
      };
      try {
        const result = await play(page, slice);
        entry.replayed = result.stepsReplayed;
        entry.error = errorText(result.error) ?? errorText(result.fileErrors);
        entry.warnings = result.hasWarnings;
      } catch (err) {
        entry.error = `harness: ${String(err)}`;
      }
      await awaitFrame(page).catch(() => {});
      await page.screenshot({ path: join(outDir, 'shots', `step-${String(index).padStart(2, '0')}.png`) });
      await page.waitForTimeout(holdMs);
      entry.ms = Date.now() - t0;
      stepLogs.push(entry);
      log(`#${index} ${entry.step}: ${entry.error ? `FAIL — ${entry.error}` : `ok (${entry.replayed ?? '?'} replayed)`}` +
        ` | cursor ${entry.cursor} | ${entry.ms} ms`);
      if (entry.error && !continueOnError) break;
    }
    summary['steps'] = stepLogs;
    summary['passed'] = stepLogs.filter((s) => !s.error).length;
    summary['cursorFound'] = stepLogs.filter((s) => s.cursor === 'found').length;
    summary['total'] = recording.steps.length;
  }

  summary['durationMs'] = Date.now() - started;
  await page.close();
  videoPath = await page.video()?.path();
  await context.close();
} catch (err) {
  summary['fatal'] = String(err);
  log(`FATAL: ${String(err)}`);
} finally {
  await browser.close();
  summary['video'] = videoPath;
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  log(`Results in ${outDir}`);
}
