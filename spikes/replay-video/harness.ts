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
 * Usage: node harness.ts --env <envId> --recording recordings/x.yml --mode per-step [--headed]
 *        [--hold-ms 1500] [--keep-start] [--no-cursor] [--no-stage] [--type-ms 70] [--continue] [--page <pageId>] [--out dir]
 * Env:   CONTINIA_API_TOKEN (from the repo .env) for --env; or BC_URL, BC_USER, BC_PASS instead
 */
import { chromium } from 'playwright';
import type { Frame, Locator, Page } from 'playwright';
import { parse, stringify } from 'yaml';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
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
const stage = !flag('no-stage');
const typeMs = Number(opt('type-ms', '70'));
// Connection: either --env <envId> (URL and login looked up with the continia CLI)
// or BC_URL / BC_USER / BC_PASS set explicitly.
const envId = opt('env') ?? process.env['BC_ENV_ID'];
let bcUrl = process.env['BC_URL'];
let bcUser = process.env['BC_USER'];
let bcPass = process.env['BC_PASS'] ?? '';
if (envId) {
  try {
    ({ bcUrl, bcUser, bcPass } = resolveEnvironment(envId));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(2);
  }
}
if (!bcUrl || !bcUser) {
  console.error('Pass --env <envId> (or set BC_ENV_ID), or set BC_URL and BC_USER (and BC_PASS)');
  process.exit(2);
}

/** Look up the web client URL and a login for a DemoPortal environment. */
function resolveEnvironment(id: string): { bcUrl: string; bcUser: string; bcPass: string } {
  const cli = process.env['CONTINIA_CLI_PATH'] ?? resolve('../../.tools/continia.exe');
  const run = (args: string[]): any => {
    const r = spawnSync(cli, ['--auth-method', 'api-token', ...args, '--json'], { encoding: 'utf-8' });
    if (r.status !== 0) {
      throw new Error(`continia ${args.join(' ')} failed (${r.status}): ${(r.stderr || r.error?.message || '').slice(0, 300)}`);
    }
    return JSON.parse(r.stdout);
  };
  if (!process.env['CONTINIA_API_TOKEN']) throw new Error('CONTINIA_API_TOKEN is not set (it is read from the repo .env)');
  const env = run(['env', 'get', id]);
  if (String(env.status).toLowerCase() !== 'running') {
    throw new Error(`environment ${id} is ${env.status}; start it first (continia env start ${id})`);
  }
  const users = run(['env', 'users', id]);
  const rows: any[] = Array.isArray(users) ? users : (users.users ?? []);
  const user = rows.find((u) => u.password) ?? rows[0];
  const name = user?.username ?? user?.userName ?? user?.name;
  if (!env.url || !name) throw new Error(`could not read url/user for ${id} (env keys: ${Object.keys(env).join(', ')})`);
  console.log(`Environment ${id}: ${env.description ?? ''} ${env.url} (BC ${env.bcVersion ?? '?'}) as ${name}`);
  return { bcUrl: String(env.url).replace(/\/?$/, '/'), bcUser: String(name), bcPass: String(user.password ?? '') };
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
  // Deep link to the start page (V1 did the same): BC's engine doesn't navigate to
  // start.page itself; it expects to begin where the recording was made.
  const pageId = opt('page') ?? recording.start?.['pageId'];
  if (pageId !== undefined) url.searchParams.set('page', String(pageId));
  return url.toString().replaceAll('+', '%20');
}

/** First-run dialogs that cover the page on a fresh environment, closed before the demo starts. */
const STARTUP_DIALOGS = ['Welcome to your Continia Demo Environment'];

async function dismissStartupDialogs(page: Page): Promise<string[]> {
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
  // Real recordings name controls internally (action: Control_New); the visible caption
  // is in the description (<caption>New</caption>), so prefer that for finding the element.
  const shown = typeof step.description === 'string'
    ? /<caption>([^<]+)<\/caption>/.exec(step.description)?.[1]
    : undefined;
  const field = step.target?.find((t) => t.field) ? (shown ?? step.target?.find((t) => t.field)?.field) : undefined;
  const action = step.caption ?? (step.target?.find((t) => t.action) ? (shown ?? step.target?.find((t) => t.action)?.action) : undefined);

  for (const scope of scopes) {
    if ((step.type === 'input' || step.type === 'focus') && field) {
      const hit = await firstVisible([
        scope.getByRole('textbox', { name: field, exact: true }),
        scope.getByRole('combobox', { name: field, exact: true }),
        scope.getByRole('checkbox', { name: field, exact: true }),
        // Masked fields (IBAN, account numbers) are password inputs with no textbox role.
        scope.getByLabel(field, { exact: true }),
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

// ---------- staging: make the step's target visible before BC's engine runs it ----------
type Visibility = 'in-view' | 'edge' | 'off-screen' | 'not-found';
const EDGE_MARGIN = 80;

async function visibility(target: Locator | undefined): Promise<Visibility> {
  if (!target) return 'not-found';
  const box = await target.boundingBox().catch(() => null);
  if (!box) return 'not-found';
  const inside = box.y >= 0 && box.y + box.height <= VIEWPORT.height && box.x >= 0 && box.x + box.width <= VIEWPORT.width;
  if (!inside) return 'off-screen';
  const comfortable = box.y >= EDGE_MARGIN && box.y + box.height <= VIEWPORT.height - EDGE_MARGIN;
  return comfortable ? 'in-view' : 'edge';
}

/** Find the target; if it's a field that isn't rendered, expand collapsed FastTabs until it is; center it. */
async function stageTarget(page: Page, frame: Frame, step: Step, entry: StepLog): Promise<Locator | undefined> {
  let target = await cursorTarget(frame, step).catch(() => undefined);
  const hasField = step.target?.some((t) => t.field);
  if (!target && hasField) {
    // Collapsed FastTabs don't render their fields at all, so the field only appears after expanding.
    const headers = frame.locator('span[role=button].ms-nav-columns-caption[aria-expanded="false"]');
    const captions = (await headers.allTextContents()).map((t) => t.trim()).filter(Boolean);
    entry.expanded = [];
    for (const caption of captions) {
      await frame.locator('span[role=button].ms-nav-columns-caption[aria-expanded="false"]', { hasText: caption }).first().click();
      entry.expanded.push(caption);
      await awaitFrame(page).catch(() => {});
      target = await cursorTarget(frame, step).catch(() => undefined);
      if (target) break;
    }
  }
  if (target) {
    await target.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' })).catch(() => {});
    await page.waitForTimeout(700);
  }
  return target;
}

/** Type the value visibly; BC's engine commits the same value right after, which fires the triggers. */
async function typeVisibly(target: Locator, step: Step): Promise<boolean> {
  if (step.type !== 'input' || typeof step.value !== 'string' || step.value.startsWith('=')) return false;
  const kind = await target.evaluate((el) => {
    const input = el as HTMLInputElement;
    return el.tagName === 'INPUT' && (input.type === 'text' || input.type === 'password') && el.getAttribute('role') !== 'combobox'
      ? 'text'
      : 'other';
  }).catch(() => 'other');
  if (kind !== 'text') return false;
  await target.click();
  await target.fill('');
  await target.pressSequentially(step.value, { delay: typeMs });
  return true;
}

// ---------- run ----------
type StepLog = {
  index: number;
  step: string;
  replayed?: number;
  error?: string;
  warnings?: boolean;
  cursor: 'found' | 'missing' | 'off' | 'n/a';
  /** Where the step's target was just before it ran, and just after (video quality check). */
  visibleBefore?: Visibility;
  visibleAfter?: Visibility;
  expanded?: string[];
  typed?: boolean;
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
  const closedAtLogin = await dismissStartupDialogs(authPage);
  if (closedAtLogin.length) log(`Closed at login: ${closedAtLogin.join(', ')}`);
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
  const closed = await dismissStartupDialogs(page);
  if (closed.length) log(`Closed before recording: ${closed.join(', ')}`);
  summary['startupDialogsClosed'] = [...closedAtLogin, ...closed];
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
      // Steps the viewer doesn't click: no cursor expected.
      const passive = ['page-shown', 'validate', 'wait'].includes(step.type);
      const entry: StepLog = {
        index,
        step: describe(step),
        cursor: !useCursor ? 'off' : passive ? 'n/a' : 'missing',
        ms: 0,
      };
      const frame = await awaitFrame(page);

      let target: Locator | undefined;
      if (!passive) {
        target = stage ? await stageTarget(page, frame, step, entry) : await cursorTarget(frame, step).catch(() => undefined);
        entry.visibleBefore = await visibility(target);
      }
      if (useCursor && !passive) {
        const box = target ? await target.boundingBox().catch(() => null) : null;
        if (box) {
          // boundingBox() is relative to the main viewport, so no iframe offset is needed.
          await animateClick(page, box.x + box.width / 2, box.y + box.height / 2);
          entry.cursor = 'found';
        }
      }
      if (stage && target) entry.typed = await typeVisibly(target, step).catch(() => false);

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
      if (!passive && step.type !== 'navigate' && step.type !== 'invoke') {
        // Re-locate: the step may have re-rendered the page.
        entry.visibleAfter = await visibility(await cursorTarget(await awaitFrame(page), step).catch(() => undefined));
      }
      await page.screenshot({ path: join(outDir, 'shots', `step-${String(index).padStart(2, '0')}.png`) });
      await page.waitForTimeout(holdMs);
      entry.ms = Date.now() - t0;
      stepLogs.push(entry);
      log(`#${index} ${entry.step}: ${entry.error ? `FAIL — ${entry.error}` : `ok (${entry.replayed ?? '?'} replayed)`}` +
        ` | cursor ${entry.cursor}` +
        (entry.visibleBefore ? ` | before ${entry.visibleBefore}` : '') +
        (entry.visibleAfter ? ` | after ${entry.visibleAfter}` : '') +
        (entry.expanded?.length ? ` | expanded ${entry.expanded.join(', ')}` : '') +
        (entry.typed ? ' | typed' : '') +
        ` | ${entry.ms} ms`);
      if (entry.error && !continueOnError) break;
    }
    summary['steps'] = stepLogs;
    summary['passed'] = stepLogs.filter((s) => !s.error).length;
    summary['cursorFound'] = stepLogs.filter((s) => s.cursor === 'found').length;
    summary['cursorExpected'] = stepLogs.filter((s) => s.cursor === 'found' || s.cursor === 'missing').length;
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
