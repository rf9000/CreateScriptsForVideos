/// <reference lib="dom" />
import type { Page } from 'playwright';

// Ported from continia-demo-generator/src/cursor.ts (V1). Purely cosmetic:
// the step itself is executed by BC's replay engine, not by this click.

const MOVE_MS = 600;
const CLICK_MS = 400;

export async function injectCursor(page: Page): Promise<void> {
  await page.evaluate(
    ({ moveMs, clickMs }: { moveMs: number; clickMs: number }) => {
      if (document.getElementById('demo-cursor')) return;
      const cursor = document.createElement('div');
      cursor.id = 'demo-cursor';
      cursor.innerHTML = '<div id="demo-cursor-dot"></div><div id="demo-cursor-ring"></div>';
      const style = document.createElement('style');
      style.textContent = `
        #demo-cursor { position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;
          pointer-events: none; transition: transform ${moveMs}ms cubic-bezier(0.22, 1, 0.36, 1); }
        #demo-cursor-dot { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px;
          border-radius: 50%; background: rgba(255, 80, 80, 0.85); box-shadow: 0 0 6px rgba(255, 80, 80, 0.4); }
        #demo-cursor-ring { position: absolute; width: 32px; height: 32px; margin: -16px 0 0 -16px;
          border-radius: 50%; border: 2px solid rgba(255, 80, 80, 0.5); opacity: 0; transform: scale(0.5); }
        #demo-cursor-ring.clicking { animation: demo-cursor-click ${clickMs}ms ease-out forwards; }
        @keyframes demo-cursor-click { 0% { opacity: 1; transform: scale(0.5); } 100% { opacity: 0; transform: scale(2); } }
      `;
      document.head.appendChild(style);
      document.body.appendChild(cursor);
    },
    { moveMs: MOVE_MS, clickMs: CLICK_MS },
  );
}

/** Glide to page-level coordinates and show the click ripple. */
export async function animateClick(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(({ x, y }) => {
    const cursor = document.getElementById('demo-cursor');
    if (cursor) cursor.style.transform = `translate(${x}px, ${y}px)`;
  }, { x, y });
  await page.waitForTimeout(MOVE_MS + 50);
  await page.evaluate(() => {
    const ring = document.getElementById('demo-cursor-ring');
    if (!ring) return;
    ring.classList.remove('clicking');
    void ring.offsetWidth;
    ring.classList.add('clicking');
  });
  await page.waitForTimeout(CLICK_MS);
}
