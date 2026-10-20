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
 * The external-services question comes from Continia apps on a sandbox, where outbound HTTP is
 * off by default; Yes stores the setting for the tenant, so it is asked only once.
 */
const STARTUP_DIALOGS = [
  { text: /Welcome to your Continia Demo Environment/i, button: 'Close' },
  { text: /communicate with external services/i, button: 'Yes' },
];

/**
 * The dialog's text and button in whichever frame shows them. BC's confirm dialogs don't all
 * carry role=dialog, and some render outside the client iframe, so match on visible text.
 */
async function answerDialog(page: Page, text: RegExp, button: string): Promise<boolean> {
  for (const frame of page.frames()) {
    const shown = await frame.getByText(text).first().isVisible().catch(() => false);
    if (!shown) continue;
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
    for (const { text, button } of STARTUP_DIALOGS) {
      if (!(await answerDialog(page, text, button))) continue;
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
