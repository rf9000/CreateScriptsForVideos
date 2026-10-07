import { chromium } from 'playwright';
import type { Locator } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { animateClick, injectCursor } from './cursor.ts';
import { dismissTeachingTips, findTarget, stage, typeVisibly, visibility } from './staging.ts';
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
  staging: string[];
  typed: boolean;
  ms: number;
};

export type RecordOptions = {
  recording: Recording;
  hints: StagingHints;
  /** Narration clip length per step index (ms); steps without a clip get the default hold. */
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

/** Run cosmetic staging; a failure is noted on the step and swallowed. */
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
    const { context, page, videoStartedAt } = await openSession(browser, {
      url: opts.url, profile, pageId: startPageId(opts.recording), user: opts.user, password: opts.password, videoDir: opts.outDir,
    });
    const videoStart = videoStartedAt;
    await injectCursor(page);
    // Teaching tips ("About bank accounts") pop up shortly after a page loads; close them while
    // the video is still in the part that gets trimmed.
    await page.waitForTimeout(1500);
    await dismissTeachingTips(await awaitFrame(page)).catch(() => 0);
    await page.waitForTimeout(500);
    // Everything before the first step (loading, login landing) is trimmed from the final video.
    timing.trimStartMs = Date.now() - videoStart;

    for (const [index, step] of opts.recording.steps.entries()) {
      const t0 = Date.now();
      const passive = PASSIVE.has(step.type);
      const entry: StepLog = { index, type: step.type, cursor: passive ? 'n/a' : 'missing', staging: [], typed: false, ms: 0 };
      try {
        const frame = await awaitFrame(page);
        if (!passive) {
          // Staging only frames the shot; if it fails, the step still runs.
          await stageSafely(async () => {
            const tips = await dismissTeachingTips(frame);
            if (tips) entry.staging.push(`closed ${tips} tip(s)`);
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
            const box = target ? await target.boundingBox().catch(() => null) : null;
            if (box) {
              // On fields, rest the cursor near the right end so it doesn't cover the typed text.
              const onField = step.target?.some((t) => t['field']) && box.width > 60;
              await animateClick(page, onField ? box.x + box.width - 28 : box.x + box.width / 2, box.y + box.height / 2);
              entry.cursor = 'found';
            }
            if (target) entry.typed = await typeVisibly(target, step, TYPE_DELAY_MS).catch(() => false);
          }, entry.staging);
        }

        const stepStart = Date.now() - videoStart;
        try {
          const result = await play(page, sliceFor(opts.recording, index));
          entry.error = errorText(result.error) ?? errorText(result.fileErrors);
        } catch (err) {
          entry.error = `recorder: ${String(err)}`;
        }
        await awaitFrame(page).catch(() => {});
        if (!entry.error && !passive && step.type !== 'navigate' && step.type !== 'invoke') {
          entry.visibleAfter = await visibility(await findTarget(await awaitFrame(page), step).catch(() => undefined));
        }
        await page.screenshot({ path: join(opts.outDir, 'shots', `step-${String(index).padStart(2, '0')}.png`) });
        if (!entry.error) await page.waitForTimeout(holdFor(index, opts.holds, DEFAULT_HOLD_MS));
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
