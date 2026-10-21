/// <reference lib="dom" />
import type { Browser, BrowserContext, Frame, Page } from 'playwright';
import type { Recording } from './recording.ts';

/**
 * The BC side of recording: log in off camera, wait for the web client to be
 * idle, and run steps through BC's own replay engine (window.DN.playRecording,
 * the engine behind @microsoft/bc-replay). Ported from spikes/replay-video.
 */

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

/**
 * First-run dialogs on a fresh Continia demo environment, answered before the demo starts.
 * Sandboxes block outbound HTTP by default: Continia's own question (Yes) and BC's per-extension
 * prompt (Allow Always, then OK) both store the answer, so each is asked once per extension.
 */
const STARTUP_DIALOGS: Array<{ text: RegExp; button: string; choose?: string }> = [
  { text: /Welcome to your Continia Demo Environment/i, button: 'Close' },
  { text: /communicate with external services/i, button: 'Yes' },
  { text: /is making a request to an external service/i, choose: 'Allow Always', button: 'OK' },
];

/**
 * The dialog's text and button in whichever frame shows them. BC's confirm dialogs don't all
 * carry role=dialog, and some render outside the client iframe, so match on visible text.
 */
async function answerDialog(page: Page, text: RegExp, button: string, choose?: string): Promise<boolean> {
  for (const frame of page.frames()) {
    const shown = await frame.getByText(text).first().isVisible().catch(() => false);
    if (!shown) continue;
    if (choose) {
      const option = frame.getByRole('radio', { name: choose, exact: true }).last();
      const target = (await option.isVisible().catch(() => false)) ? option : frame.getByText(choose, { exact: true }).last();
      await target.click();
    }
    const target = frame.getByRole('button', { name: button, exact: true }).last();
    if (!(await target.isVisible().catch(() => false))) continue;
    await target.click();
    return true;
  }
  return false;
}

/**
 * Answers the startup dialogs. Some open only after the page's first server call, so it keeps
 * looking until none has shown for `settleMs`.
 */
export async function dismissStartupDialogs(page: Page, settleMs = 0): Promise<string[]> {
  const closed: string[] = [];
  let quietSince = Date.now();
  for (let i = 0; i < 40; i++) {
    await awaitFrame(page);
    let hit = false;
    for (const { text, button, choose } of STARTUP_DIALOGS) {
      if (!(await answerDialog(page, text, button, choose))) continue;
      closed.push(text.source);
      hit = true;
    }
    if (hit) quietSince = Date.now();
    else if (Date.now() - quietSince >= settleMs) break;
    await page.waitForTimeout(500);
  }
  if (closed.length) console.log(`  Answered startup dialog(s): ${closed.join(' | ')}`);
  return closed;
}

/** How long to keep watching for a startup dialog after the start page loads. */
const DIALOG_SETTLE_MS = 8_000;

/** A Continia product's activation wizard, opened instead of the product's first page. */
const ACTIVATION_WIZARD = /Welcome to the activation of/i;
const MAX_WIZARD_PAGES = 15;

/** Finish when it's enabled, else Next; neither means the page wants input we can't give. */
export function wizardMove(state: { finish: boolean; next: boolean }): 'finish' | 'next' | 'stuck' {
  return state.finish ? 'finish' : state.next ? 'next' : 'stuck';
}

async function enabledButton(page: Page, name: string) {
  for (const frame of page.frames()) {
    const button = frame.getByRole('button', { name, exact: true }).last();
    if ((await button.isVisible().catch(() => false)) && (await button.isEnabled().catch(() => false))) return button;
  }
  return undefined;
}

async function wizardText(page: Page): Promise<string> {
  const texts = await Promise.all(page.frames().slice(1).map((f) => f.locator('body').innerText({ timeout: 2000 }).catch(() => '')));
  return texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * Walks a Continia activation wizard off camera: Next until Finish is enabled, then Finish.
 * Activation is per company and asked once, so the video then opens the real start page.
 * Throws with the page's text when a page has neither button enabled.
 */
export async function completeActivationWizards(page: Page): Promise<void> {
  let inWizard = false; // past its welcome page: later pages don't repeat the welcome text
  for (let clicks = 0; clicks < MAX_WIZARD_PAGES; clicks++) {
    await awaitFrame(page);
    let welcome = false;
    for (const frame of page.frames()) {
      if (await frame.getByText(ACTIVATION_WIZARD).first().isVisible().catch(() => false)) welcome = true;
    }
    if (!welcome && !inWizard) return;
    // An error dialog (e.g. "You must specify a user ID") sits over the wizard with an OK button.
    if (await enabledButton(page, 'OK')) throw new Error(`activation wizard error: ${await wizardText(page)}`);
    const finish = await enabledButton(page, 'Finish');
    const next = await enabledButton(page, 'Next');
    const move = wizardMove({ finish: finish !== undefined, next: next !== undefined });
    const text = await wizardText(page);
    console.log(`  Activation wizard: ${move} — ${text}`);
    if (move === 'stuck') throw new Error(`activation wizard needs input on: ${text}`);
    await (finish ?? next)!.click();
    // After Finish, another product's wizard may follow; it starts with its own welcome page.
    inWizard = move === 'next';
    await page.waitForTimeout(1000);
  }
  throw new Error(`activation wizard still open after ${MAX_WIZARD_PAGES} clicks`);
}

/** Web client URL with profile and, optionally, the start page as a deep link. */
export function startUrl(base: string, profile?: string, pageId?: number | string): string {
  const url = new URL(base);
  if (profile) url.searchParams.set('profile', profile);
  if (pageId !== undefined) url.searchParams.set('page', String(pageId));
  return url.toString().replaceAll('+', '%20');
}

/** Log in off camera, then open a video-recorded context on the authenticated page. */
export async function openSession(
  browser: Browser,
  opts: { url: string; profile?: string; pageId?: number | string; user: string; password: string; videoDir: string },
): Promise<{ context: BrowserContext; page: Page; videoStartedAt: number }> {
  const start = startUrl(opts.url, opts.profile, opts.pageId);

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
  const landed = authPage.url();
  // The login redirect drops the query, so the deep link goes back onto where it landed. Open
  // it once off camera too: questions the start page asks first (the Continia external-services
  // one) are answered here and stay answered, so the video starts on the page itself.
  const deepLink = startUrl(landed, opts.profile, opts.pageId);
  if (opts.pageId !== undefined) {
    await authPage.goto(deepLink);
    await awaitFrame(authPage);
    await dismissStartupDialogs(authPage, DIALOG_SETTLE_MS);
    await completeActivationWizards(authPage);
  }
  const cookies = await auth.cookies();
  await auth.close();

  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: opts.videoDir, size: VIEWPORT } });
  await context.addCookies(cookies);
  const page = await context.newPage();
  // The video starts with the page; the loading screen before the first step is trimmed later.
  const videoStartedAt = Date.now();
  await page.goto(deepLink);
  await awaitFrame(page);
  // Still in the part of the video that gets trimmed.
  await dismissStartupDialogs(page, opts.pageId !== undefined ? DIALOG_SETTLE_MS : 0);
  return { context, page, videoStartedAt };
}
