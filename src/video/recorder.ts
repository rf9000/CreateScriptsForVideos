import { chromium } from 'playwright';
import type { Locator, Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { animateClick, injectCursor } from './cursor.ts';
import { dismissTeachingTips, expandPages, findTarget, stage, typeVisibly, visibility } from './staging.ts';
import { awaitFrame, errorText, openSession, play } from './bc-session.ts';
import type { Recording, StagingHints } from './recording.ts';

/**
 * Records a demo one step at a time. BC's replay engine executes each step;
 * before it runs, the staging layer makes the target visible, the cursor glides
 * to it and text values are typed visibly. After each step the recorder holds
 * for the step's narration. Ported from spikes/replay-video/harness.ts.
 */

export type StepLog = {
  index: number;
  type: string;
  error?: string;
  cursor: 'found' | 'missing' | 'n/a';
  visibleBefore?: string;
  visibleAfter?: string;
  /** What the field shows after an input step, to spot values that didn't stick. */
  valueAfter?: string;
  /** The field shows something other than the recording typed. */
  valueMismatch?: boolean;
  staging: string[];
  typed: boolean;
  /** Where the time went: framing the shot, BC's replay, and the read-back afterwards. */
  phaseMs?: { staging: number; play: number; after: number };
  /** For a target in a grid: its row, cell position and the grid's horizontal scroll. */
  gridTarget?: Record<string, unknown>;
  /** Time spent waiting for an input's field to become editable (e.g. after the field it depends on). */
  editableWaitMs?: number;
  /** Time spent waiting for the previous narration before this step. */
  waitMs?: number;
  ms: number;
};

/**
 * Cap for each Playwright action while framing a step. Staging only polishes the shot; a field
 * it can't find (scrolled out, hidden) must not freeze the video for Playwright's 30 s default.
 */
export const STAGING_ACTION_TIMEOUT_MS = 2500;
/** Longest wait for an input's field to become editable before the step runs anyway. */
export const EDITABLE_WAIT_MS = 3000;

export type RecordOptions = {
  recording: Recording;
  hints: StagingHints;
  /** Narration clip length per step index (ms); drives the pacing. */
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

/** Short pause after a visible step so the eye can follow. */
const AFTER_STEP_PAUSE_MS = 700;
/** Breath between two narration clips. */
const NARRATION_GAP_MS = 400;
/** Hold on the final state after the last narration. */
const END_TAIL_MS = 1500;
/** Quiet start on the first page, so the first narrated words don't land on the video's first frame. */
export const LEAD_IN_MS = 500;
const TYPE_DELAY_MS = 70;
const PASSIVE = new Set(['page-shown', 'page-closed', 'validate', 'wait']);

/** One step as its own recording; only the first slice carries start, or BC navigates back. */
export function sliceFor(rec: Recording, index: number): Recording {
  return {
    name: rec.name,
    description: `${rec.description} — step ${index}`,
    ...(index === 0 && rec.start ? { start: rec.start } : {}),
    steps: [rec.steps[index]!],
  };
}

/** Run cosmetic staging; a failure is noted on the step and swallowed. */
/** "50" vs "50.00", "Fixed Amount" vs "fixed amount": the same value as BC shows it. */
export function sameValue(shown: string, typed: unknown): boolean {
  const a = shown.trim().toLowerCase();
  const b = String(typed ?? '').trim().toLowerCase();
  if (a === b) return true;
  const num = (s: string) => Number(s.replace(/[\s,]/g, ''));
  return a !== '' && b !== '' && !Number.isNaN(num(a)) && num(a) === num(b);
}

/** Row and cell facts for a grid target, to see which row staging picked and whether it is in view. */
async function describeGridTarget(target: Locator): Promise<Record<string, unknown> | undefined> {
  return target.evaluate((el) => {
    const row = el.closest('tr, [role=row]');
    const cell = el.closest('td, [role=gridcell]') ?? el;
    const grid = el.closest('.ms-nav-grid-horizontal-container');
    const scroller = grid ? Array.from(grid.querySelectorAll('div')).find((d) => d.scrollWidth - d.clientWidth > 10) : undefined;
    const box = cell.getBoundingClientRect();
    const view = scroller?.getBoundingClientRect();
    const attrs = (e: Element | null) => (e ? Object.fromEntries(Array.from(e.attributes).filter((a) => /^(class|aria-|data-|tabindex)/.test(a.name)).map((a) => [a.name, a.value.slice(0, 120)])) : null);
    return {
      row: attrs(row),
      rowIndexInBody: row?.parentElement ? Array.from(row.parentElement.children).indexOf(row) : -1,
      rowsInBody: row?.parentElement?.children.length ?? 0,
      cell: { x: Math.round(box.x), w: Math.round(box.width), y: Math.round(box.y) },
      gridView: view ? { x: Math.round(view.x), w: Math.round(view.width) } : null,
      scrollLeft: scroller?.scrollLeft ?? null,
      scrollWidth: scroller?.scrollWidth ?? null,
      focusedInRow: !!row && row.contains(document.activeElement),
    };
  }).catch(() => undefined);
}

export async function stageSafely<T>(fn: () => Promise<T>, notes: string[]): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    notes.push(`staging failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** start.pageId opens the demo's first page directly (BC's engine does not navigate to start pages). */
function startPageId(rec: Recording): number | string | undefined {
  const id = rec.start?.['pageId'];
  return typeof id === 'number' || typeof id === 'string' ? id : undefined;
}

/**
 * Pacing is driven by when the running narration ends, not by fixed holds: a
 * narrated step waits only until the previous clip has finished; unnarrated
 * steps play on under the voice.
 */
export function waitBeforeStep(narrated: boolean, nowMs: number, narrationEndsAtMs: number): number {
  return narrated ? Math.max(0, narrationEndsAtMs + NARRATION_GAP_MS - nowMs) : 0;
}

/** Visible steps get a short pause; page-shown/validate/wait are invisible and get none. */
export function pauseAfterStep(type: string): number {
  return PASSIVE.has(type) ? 0 : AFTER_STEP_PAUSE_MS;
}

/** After the last step: let the last narration finish, then hold briefly on the result. */
export function waitAtEnd(nowMs: number, narrationEndsAtMs: number): number {
  return Math.max(0, narrationEndsAtMs - nowMs) + END_TAIL_MS;
}

async function dumpFrames(page: Page, path: string): Promise<void> {
  const parts: string[] = [];
  for (const [i, frame] of page.frames().entries()) {
    const text = await frame.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    const buttons: string[] = await frame.getByRole('button').allInnerTexts().catch(() => []);
    const dialogs = await frame.locator('[role=dialog],[role=alertdialog]').count().catch(() => 0);
    // Icon buttons (expand, close) have no text, only an aria-label or title.
    const icons = await frame.locator('[role=dialog] button').evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label') ?? e.getAttribute('title') ?? '').filter(Boolean)).catch(() => [] as string[]);
    if (icons.length) buttons.push(`[dialog icons: ${icons.join(', ')}]`);
    parts.push(`=== frame ${i} ${frame.url()}\ndialogs: ${dialogs}\nbuttons: ${buttons.map((b) => b.trim()).filter(Boolean).join(' | ')}\n${text.slice(0, 4000)}`);
  }
  writeFileSync(path, parts.join('\n\n'));
}

export async function recordDemo(opts: RecordOptions): Promise<RecordResult> {
  mkdirSync(join(opts.outDir, 'shots'), { recursive: true });
  const browser = await chromium.launch({ headless: !opts.headed });
  const steps: StepLog[] = [];
  // Names of icon-only buttons on the last page, so a missed Expand button shows its real name.
  let iconButtons: string[] = [];
  const timing: RecordResult['timing'] = { trimStartMs: 0, steps: [] };
  let failedStep: number | undefined;
  let error: string | undefined;
  let videoPath: string | undefined;
  try {
    const profile = typeof opts.recording.start?.['profile'] === 'string' ? (opts.recording.start['profile'] as string) : undefined;
    const { context, page, videoStartedAt } = await openSession(browser, {
      url: opts.url, profile, pageId: startPageId(opts.recording), user: opts.user, password: opts.password, videoDir: opts.outDir,
    });
    const videoStart = videoStartedAt;
    await injectCursor(page);
    page.setDefaultTimeout(STAGING_ACTION_TIMEOUT_MS);
    // Teaching tips ("About bank accounts") pop up shortly after a page loads; close them while
    // the video is still in the part that gets trimmed.
    await page.waitForTimeout(1500);
    await dismissTeachingTips(await awaitFrame(page)).catch(() => 0);
    // A start page that opens as a dialog (a wizard) is maximized before the video begins.
    if ((await expandPages(await awaitFrame(page)).catch(() => 0)) > 0) await awaitFrame(page).catch(() => {});
    await page.waitForTimeout(500);
    // Everything before the first step (loading, login landing) is trimmed from the final video.
    timing.trimStartMs = Date.now() - videoStart;
    await page.waitForTimeout(LEAD_IN_MS);

    let narrationEndsAt = 0;
    for (const [index, step] of opts.recording.steps.entries()) {
      const t0 = Date.now();
      const passive = PASSIVE.has(step.type);
      const entry: StepLog = { index, type: step.type, cursor: passive ? 'n/a' : 'missing', staging: [], typed: false, ms: 0 };
      try {
        // The narration starts with the step's visuals (cursor, typing), not after them.
        const clip = opts.holds.get(index);
        const wait = waitBeforeStep(clip !== undefined, Date.now() - videoStart, narrationEndsAt);
        entry.waitMs = wait;
        if (wait > 0) await page.waitForTimeout(wait);
        const stepStart = Date.now() - videoStart;
        if (clip !== undefined) narrationEndsAt = stepStart + clip;
        const frame = await awaitFrame(page);
        let typedTarget: Locator | undefined;
        if (step.type === 'input') {
          // A field that depends on the previous input (Amount after Split By) becomes editable only
          // when BC has processed that input; typing earlier is dropped without an error. Waited
          // before staging, so the visible typing lands in an editable field too.
          const t1 = Date.now();
          const field = await findTarget(frame, step).catch(() => undefined);
          while (field && Date.now() - t1 < EDITABLE_WAIT_MS && !(await field.isEditable({ timeout: 500 }).catch(() => false))) {
            await page.waitForTimeout(200);
          }
          entry.editableWaitMs = Date.now() - t1;
        }
        const tStaging = Date.now();
        if (!passive) {
          // Staging only frames the shot; if it fails, the step still runs.
          await stageSafely(async () => {
            const tips = await dismissTeachingTips(frame);
            if (tips) entry.staging.push(`closed ${tips} tip(s)`);
            // Dialogs that open later (a second wizard) are maximized too.
            if (await expandPages(frame)) {
              entry.staging.push('expanded page');
              await awaitFrame(page).catch(() => {});
            }
            const staged = await stage(page, frame, step, opts.hints, () => awaitFrame(page).catch(() => {}));
            const target: Locator | undefined = staged.target;
            const r = staged.report;
            entry.staging.push(
              ...r.expanded.map((c) => `expand ${c}`),
              ...r.collapsedBack.map((c) => `collapse ${c}`),
              ...r.showMore.map((c) => `show more ${c}`),
              ...r.scrolled.map((c) => `scroll ${c}`),
              ...(r.revealed ? ['reveal'] : []),
            );
            entry.visibleBefore = await visibility(target);
            if (target && step.target?.some((t) => t['repeater'])) entry.gridTarget = await describeGridTarget(target);
            const box = target ? await target.boundingBox().catch(() => null) : null;
            if (box) {
              // On fields, rest the cursor near the right end so it doesn't cover the typed text.
              const onField = step.target?.some((t) => t['field']) && box.width > 60;
              await animateClick(page, onField ? box.x + box.width - 28 : box.x + box.width / 2, box.y + box.height / 2);
              entry.cursor = 'found';
            }
            if (target) entry.typed = await typeVisibly(target, step, TYPE_DELAY_MS).catch(() => false);
            if (entry.typed) typedTarget = target;
          }, entry.staging);
        }

        // A value typed visibly is committed the way a user does it, by leaving the field (blur, not
        // Tab, so the current row stays). If it stuck, BC's engine must not write the same field again:
        // two writers raced, and the client's pending edit could win with an empty value.
        const tPlay = Date.now();
        let committedByTyping = false;
        if (typedTarget) {
          await typedTarget.evaluate((el) => (el as HTMLElement).blur()).catch(() => {});
          await awaitFrame(page).catch(() => {});
          const shown = await typedTarget.inputValue().catch(() => undefined);
          committedByTyping = shown !== undefined && sameValue(shown, step.value);
          entry.staging.push(committedByTyping ? 'typed and committed' : `typed, but the field shows "${shown ?? '?'}"; engine plays the step`);
        }
        if (!committedByTyping) {
          try {
            const result = await play(page, sliceFor(opts.recording, index));
            entry.error = errorText(result.error) ?? errorText(result.fileErrors);
          } catch (err) {
            entry.error = `recorder: ${String(err)}`;
          }
        }
        const tAfter = Date.now();
        await awaitFrame(page).catch(() => {});
        if (!entry.error && !passive && step.type !== 'navigate' && step.type !== 'invoke') {
          const after = await findTarget(await awaitFrame(page), step).catch(() => undefined);
          entry.visibleAfter = await visibility(after);
          if (after && step.type === 'input') {
            // A dropdown (enum field) shows its selected option; innerText would list every option.
            entry.valueAfter = await after
              .evaluate((el) => (el instanceof HTMLSelectElement ? el.options[el.selectedIndex]?.text ?? '' : undefined))
              .then((selected) => selected ?? after.inputValue())
              .catch(() => after.innerText())
              .catch(() => undefined);
            if (entry.valueAfter !== undefined) entry.valueMismatch = !sameValue(entry.valueAfter, step.value);
          }
        }
        entry.phaseMs = { staging: tPlay - tStaging, play: tAfter - tPlay, after: Date.now() - tAfter };
        await page.screenshot({ path: join(opts.outDir, 'shots', `step-${String(index).padStart(2, '0')}.png`) });
        // A failed step also keeps each frame's visible text and buttons, to diagnose without the image.
        if (entry.error) await dumpFrames(page, join(opts.outDir, 'shots', `step-${String(index).padStart(2, '0')}.txt`)).catch(() => {});
        const pause = pauseAfterStep(step.type);
        if (!entry.error && pause > 0) await page.waitForTimeout(pause);
        timing.steps.push({ stepIndex: index, startMs: stepStart, endMs: Date.now() - videoStart });
      } catch (err) {
        // Anything else that breaks inside a step (BC never idle, page closed) fails that step.
        entry.error = entry.error ?? `recorder: ${String(err)}`;
      }
      entry.ms = Date.now() - t0;
      steps.push(entry);
      if (entry.error) {
        failedStep = index;
        error = entry.error;
        break;
      }
    }
    if (!error) await page.waitForTimeout(waitAtEnd(Date.now() - videoStart, narrationEndsAt));
    // Buttons in the page header and action bar (top 260 px, the FactBox toggle included), with every name BC gives them.
    iconButtons = await (await awaitFrame(page).catch(() => page.mainFrame())).locator('button:visible, [role=button]:visible').evaluateAll((els) =>
      els.filter((e) => e.getBoundingClientRect().top < 260).map((e) =>
        [e.getAttribute('aria-label'), e.getAttribute('title'), (e.textContent ?? '').trim()].filter(Boolean).join(' / ')).filter(Boolean),
    ).catch(() => [] as string[]);
    await page.close();
    videoPath = await page.video()?.path();
    await context.close();
  } catch (err) {
    error = error ?? `recorder: ${String(err)}`;
  } finally {
    await browser.close();
  }
  // Per-step timings and staging notes, for diagnosing pauses and flicker without the video.
  try {
    writeFileSync(join(opts.outDir, 'steps.json'), JSON.stringify({ trimStartMs: timing.trimStartMs, failedStep, error, iconButtons, steps }, null, 2));
  } catch {
    // diagnostics only
  }
  return { ok: error === undefined, videoPath, failedStep, error, timing, steps };
}
