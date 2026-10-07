/// <reference lib="dom" />
import type { Frame, Locator, Page } from 'playwright';

/**
 * Cosmetic staging: before BC's replay engine executes a step, make the step's target
 * visible on camera. Nothing here executes the step, so a miss costs framing, never
 * correctness. Reveal logic ported from V1 (continia-demo-generator/src/player.ts:
 * prepareFieldAccess, scrollContainerToReveal, scrollFieldToCenter), adapted to the
 * markup probed on BC 29 (probe-fasttab.ts).
 */

import type { RecordingStep as Step, StagingHints } from './recording.ts';
export type { StagingHints };

export type Visibility = 'in-view' | 'edge' | 'off-screen' | 'not-found';

export type StageReport = {
  expanded: string[];
  collapsedBack: string[];
  showMore: string[];
  scrolled: string[];
  revealed: boolean;
};

const VIEWPORT = { width: 1920, height: 1080 };
// V1's comfort zone: a target is well framed when its center sits in the middle of the screen.
const ZONE = { top: 0.25, bottom: 0.75, left: 0.1, right: 0.9 };
const EDGE_MARGIN = 80;

const FASTTAB_HEADER = 'span[role=button].ms-nav-columns-caption';
const SHOW_MORE = 'button.show-more-fields-button';
const SCROLLERS = '.ms-nav-scrollable, .freeze-pane-scrollbar';

/** The caption shown to the user, from the step description (<caption>New</caption>). */
export function shownCaption(step: Step): string | undefined {
  return typeof step.description === 'string' ? /<caption>([^<]+)<\/caption>/.exec(step.description)?.[1] : undefined;
}

export const fieldOf = (step: Step) => step.target?.find((t) => t['field'])?.['field'] as string | undefined;
const actionOf = (step: Step) => step.target?.find((t) => t['action'])?.['action'] as string | undefined;

/** Last visible match wins: BC edit mode renders duplicates after the originals. */
async function lastVisible(candidates: Locator[]): Promise<Locator | undefined> {
  for (const c of candidates) {
    const n = await c.count().catch(() => 0);
    for (let i = n - 1; i >= 0; i--) {
      const el = c.nth(i);
      if (await el.isVisible().catch(() => false)) return el;
    }
  }
  return undefined;
}

/** Locate the element the viewer should see for this step (field, action button or row). */
export async function findTarget(frame: Frame, step: Step): Promise<Locator | undefined> {
  const dialog = frame.locator('[role=dialog]:visible').last();
  const scopes = (await dialog.count()) > 0 ? [dialog, frame.locator('body')] : [frame.locator('body')];
  const field = fieldOf(step);
  const caption = shownCaption(step);

  for (const scope of scopes) {
    if (field && (step.type === 'input' || step.type === 'focus' || step.type === 'validate')) {
      // Recordings name fields by control name, which BC puts on the field container.
      const container = scope.locator(`[controlname="${field}"]`);
      const hit = await lastVisible([
        container.locator('input, textarea, [role=textbox], [role=combobox], [role=checkbox], [role=switch]'),
        container,
        ...(caption
          ? [
              scope.getByRole('textbox', { name: caption, exact: true }),
              scope.getByRole('combobox', { name: caption, exact: true }),
              scope.getByLabel(caption, { exact: true }),
            ]
          : []),
      ]);
      if (hit) return hit;
    } else if (actionOf(step) || step['caption']) {
      const name = (step['caption'] as string | undefined) ?? caption ?? actionOf(step)!;
      const hit = await lastVisible([
        scope.getByRole('menuitem', { name, exact: true }),
        scope.getByRole('button', { name, exact: true }),
        scope.getByRole('link', { name, exact: true }),
        scope.getByRole('menuitemradio', { name, exact: true }),
        scope.getByText(name, { exact: true }),
      ]);
      if (hit) return hit;
    } else if (step.target?.some((t) => t['repeater'])) {
      // Row invoke: the current (selected) row of the grid, else the first data row.
      const hit = await lastVisible([
        scope.locator('table.ms-nav-grid-data-table tbody tr[aria-selected="true"]'),
        scope.locator('table.ms-nav-grid-data-table tbody tr').first(),
      ]);
      if (hit) return hit;
    }
  }
  return undefined;
}

export async function visibility(target: Locator | undefined): Promise<Visibility> {
  if (!target) return 'not-found';
  const box = await target.boundingBox().catch(() => null);
  if (!box) return 'not-found';
  const inside = box.y >= 0 && box.y + box.height <= VIEWPORT.height && box.x >= 0 && box.x + box.width <= VIEWPORT.width;
  if (!inside) return 'off-screen';
  return box.y >= EDGE_MARGIN && box.y + box.height <= VIEWPORT.height - EDGE_MARGIN ? 'in-view' : 'edge';
}

/** Close Fluent teaching tips ("About bank accounts") that cover the page. */
export async function dismissTeachingTips(frame: Frame): Promise<number> {
  const close = frame.locator(
    '[class*="TeachingBubble"] button[aria-label="Close"], [class*="TeachingBubble"] .ms-TeachingBubble-closebutton',
  );
  let closed = 0;
  for (let i = (await close.count().catch(() => 0)) - 1; i >= 0; i--) {
    const btn = close.nth(i);
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      closed++;
    }
  }
  return closed;
}

type Idle = () => Promise<unknown>;

async function clickHeader(frame: Frame, caption: string, expanded: boolean): Promise<boolean> {
  const header = frame
    .locator(`${FASTTAB_HEADER}[aria-expanded="${expanded ? 'true' : 'false'}"]`, { hasText: caption })
    .first();
  if ((await header.count()) === 0) return false;
  await header.click();
  return true;
}

/** V1's scrollContainerToReveal: page through BC's scroll containers, vertical then horizontal. */
async function scrollToReveal(frame: Frame, find: () => Promise<Locator | undefined>, report: StageReport): Promise<Locator | undefined> {
  for (const axis of ['vertical', 'horizontal'] as const) {
    if (axis === 'horizontal') {
      await frame.evaluate((sel) => document.querySelectorAll(sel).forEach((el) => ((el as HTMLElement).scrollTop = 0)), SCROLLERS);
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      const moved = await frame.evaluate(
        ({ sel, axis }) => {
          let best: HTMLElement | null = null;
          let bestRemaining = 0;
          for (const el of Array.from(document.querySelectorAll(sel))) {
            const h = el as HTMLElement;
            const remaining = axis === 'vertical'
              ? h.scrollHeight - h.scrollTop - h.clientHeight
              : h.scrollWidth - h.scrollLeft - h.clientWidth;
            if (remaining > bestRemaining) {
              bestRemaining = remaining;
              best = h;
            }
          }
          if (!best || bestRemaining < 5) return false;
          if (axis === 'vertical') {
            best.scrollTop += best.clientHeight * 0.7;
          } else {
            // Smaller steps so partially visible columns aren't skipped; keep header and body in sync.
            const amount = best.clientWidth * 0.4;
            const grid = best.closest('.ms-nav-grid-horizontal-container');
            if (grid) {
              grid.querySelectorAll('div').forEach((d) => {
                const div = d as HTMLElement;
                if (div.scrollWidth - div.clientWidth > 10) div.scrollLeft += amount;
              });
            } else {
              best.scrollLeft += amount;
            }
          }
          return true;
        },
        { sel: SCROLLERS, axis },
      );
      if (!moved) break;
      await new Promise((r) => setTimeout(r, 300));
      const hit = await find();
      if (hit) {
        report.scrolled.push(`${axis} x${attempt + 1}`);
        return hit;
      }
    }
  }
  return undefined;
}

/** V1's comfort zone: scroll only when the target sits outside the middle of the screen. */
async function center(target: Locator, report: StageReport): Promise<void> {
  const box = await target.boundingBox().catch(() => null);
  if (!box) return;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const outsideV = cy < VIEWPORT.height * ZONE.top || cy > VIEWPORT.height * ZONE.bottom;
  const outsideH = cx < VIEWPORT.width * ZONE.left || cx > VIEWPORT.width * ZONE.right;
  if (!outsideV && !outsideH) return;
  await target
    .evaluate((el) => {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      // Grids scroll header and body in separate divs: line them up again.
      const grid = el.closest('.ms-nav-grid-horizontal-container');
      if (grid) {
        const divs = Array.from(grid.querySelectorAll('div')).filter((d) => d.scrollWidth - d.clientWidth > 10);
        const left = Math.max(...divs.map((d) => d.scrollLeft));
        divs.forEach((d) => (d.scrollLeft = left));
      }
    })
    .catch(() => {});
  report.scrolled.push('center');
}

/**
 * Make the step's target visible: expand its FastTab (hinted, else try each and collapse
 * misses back), "Show more" scoped to that FastTab, scroll to reveal, center, and reveal
 * masked values for input steps.
 */
export async function stage(
  page: Page,
  frame: Frame,
  step: Step,
  hints: StagingHints,
  idle: Idle,
): Promise<{ target?: Locator; report: StageReport }> {
  const report: StageReport = { expanded: [], collapsedBack: [], showMore: [], scrolled: [], revealed: false };
  const find = () => findTarget(frame, step).catch(() => undefined);
  let target = await find();
  const field = fieldOf(step);

  if (!target && field) {
    // Collapsed FastTabs don't render their fields at all.
    const hinted = hints.fieldGroups?.[field];
    const captions = hinted
      ? [hinted]
      : (await frame.locator(`${FASTTAB_HEADER}[aria-expanded="false"]`).allTextContents()).map((t) => t.trim()).filter(Boolean);
    for (const caption of captions) {
      if (!(await clickHeader(frame, caption, false))) continue;
      report.expanded.push(caption);
      await idle();
      target = await find();
      if (target) break;
      if (!hinted && (await clickHeader(frame, caption, true))) {
        report.collapsedBack.push(caption);
        await idle();
      }
    }
  }

  if (!target && field) {
    // Fields marked Importance = Additional hide behind the FastTab's "Show more".
    const hinted = hints.fieldGroups?.[field];
    const buttons = frame.locator(hinted ? `${SHOW_MORE}[aria-label="${hinted}, Show more"]` : SHOW_MORE);
    const labels = (await buttons.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))).filter(Boolean);
    for (const label of labels) {
      const btn = frame.locator(`${SHOW_MORE}[aria-label="${label}"]`).first();
      if (!(await btn.isVisible().catch(() => false))) continue;
      await btn.click();
      report.showMore.push(label.replace(', Show more', ''));
      await idle();
      target = await find();
      if (target) break;
    }
  }

  if (!target && (field || step.target?.some((t) => t['repeater']))) {
    target = await scrollToReveal(frame, find, report);
  }

  // Center fields and rows only: action bars and Role Center links sit at the top by design,
  // and scrolling toward them just adds motion.
  if (target && (field || step.target?.some((t) => t['repeater']))) {
    await center(target, report);
    await page.waitForTimeout(report.scrolled.length ? 700 : 150);
    target = (await find()) ?? target;
  }

  if (target && field && step.type === 'input') {
    const reveal = frame.locator(`[controlname="${field}"] button.concealed-data-reveal-button`).last();
    if (await reveal.isVisible().catch(() => false)) {
      await reveal.click().catch(() => {});
      report.revealed = true;
      await idle();
      target = (await find()) ?? target;
    }
  }
  return { target, report };
}

/** Type the value visibly; BC's engine commits the same value right after, which fires the triggers. */
export async function typeVisibly(target: Locator, step: Step, delayMs: number): Promise<boolean> {
  if (step.type !== 'input' || typeof step.value !== 'string' || step.value.startsWith('=')) return false;
  const kind = await target
    .evaluate((el) => {
      const input = el as HTMLInputElement;
      return el.tagName === 'INPUT' && (input.type === 'text' || input.type === 'password') && el.getAttribute('role') !== 'combobox'
        ? 'text'
        : 'other';
    })
    .catch(() => 'other');
  if (kind !== 'text') return false;
  await target.click();
  await target.fill('');
  await target.pressSequentially(step.value, { delay: delayMs });
  return true;
}
