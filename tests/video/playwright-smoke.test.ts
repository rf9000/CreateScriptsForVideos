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
