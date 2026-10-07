// One-off probe: dump the markup of collapsed FastTab headers on a Bank Account Card.
// Usage: node --env-file-if-exists=../../.env probe-fasttab.ts <envId>
import { chromium } from 'playwright';
import { spawnSync } from 'child_process';

const id = process.argv[2]!;
const cli = '../../.tools/continia.exe';
const run = (args: string[]) =>
  JSON.parse(spawnSync(cli, ['--auth-method', 'api-token', ...args, '--json'], { encoding: 'utf-8' }).stdout);
const env = run(['env', 'get', id]);
const users = run(['env', 'users', id]);
const user = (Array.isArray(users) ? users : users.users).find((u: any) => u.password);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${env.url}/?profile=BUSINESS%20MANAGER&page=370`);
if (await page.locator('input[name=UserName]').isVisible({ timeout: 10000 }).catch(() => false)) {
  await page.fill('input[name=UserName]', user.username ?? user.userName);
  await page.fill('input[name=Password]', user.password);
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
}
await page.waitForTimeout(8000);
const frame = page.frames()[1]!;
const html = await frame.evaluate(() => {
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll('[aria-expanded]'))) {
    const text = (el.textContent ?? '').trim().slice(0, 40);
    out.push(`${el.tagName} role=${el.getAttribute('role')} expanded=${el.getAttribute('aria-expanded')} ` +
      `class="${(el.getAttribute('class') ?? '').slice(0, 80)}" text="${text}"`);
  }
  return out.join('\n');
});
console.log(html);
await frame.locator('span[role=button].ms-nav-columns-caption', { hasText: 'Transfer' }).first().click();
await page.waitForTimeout(3000);
console.log('--- masked');
console.log(await frame.evaluate(() => {
  const out: string[] = [];
  const els = Array.from(document.querySelectorAll('[aria-label*="IBAN"], [controlname*="IBAN"], [title*="IBAN"]'));
  for (const el of els.slice(0, 6)) {
    out.push(`${el.tagName} role=${el.getAttribute('role')} type=${el.getAttribute('type')} aria-label="${el.getAttribute('aria-label')}" controlname="${el.getAttribute('controlname')}" class="${(el.getAttribute('class') ?? '').slice(0, 70)}"`);
  }
  const host = els[0]?.closest('[controlname]') ?? els[0]?.parentElement?.parentElement;
  out.push((host?.outerHTML ?? 'none').replace(/\s+/g, ' ').slice(0, 1500));
  return out.join(String.fromCharCode(10));
}));
console.log('--- show more');
console.log(await frame.evaluate(() => Array.from(document.querySelectorAll('a,button,[role=button],span'))
  .filter((e) => /^show (more|less)$/i.test((e as HTMLElement).innerText?.trim() ?? ''))
  .map((e) => `${e.tagName} role=${e.getAttribute('role')} class="${(e.getAttribute('class') ?? '').slice(0, 60)}" aria-label="${e.getAttribute('aria-label')}" title="${e.getAttribute('title')}"`)
  .join(String.fromCharCode(10))));
await browser.close();
