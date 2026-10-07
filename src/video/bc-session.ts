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
  const cookies = await auth.cookies();
  const landed = authPage.url();
  await auth.close();

  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: opts.videoDir, size: VIEWPORT } });
  await context.addCookies(cookies);
  const page = await context.newPage();
  // The video starts with the page; the loading screen before the first step is trimmed later.
  const videoStartedAt = Date.now();
  await page.goto(landed);
  await awaitFrame(page);
  await dismissStartupDialogs(page);
  return { context, page, videoStartedAt };
}
