/** SPEC sect 13 E2E flows, driven through the real UI on :5197. */
import { expect, test, type Page } from '@playwright/test';

interface StoreSnapshot {
  plan: { levels: Array<{ walls: unknown[]; openings: unknown[]; rooms: unknown[]; items: Array<{ id: string; label: string; x: number; y: number }> }> };
  view: { x: number; y: number; s: number };
  ui: { tool: string };
  agent: { messages: Array<{ role: string; text: string; proposalId?: string | null }>; proposal: { id: string; title: string; status: string } | null };
  history: { undo: unknown[]; redo: unknown[] };
}

async function snap(page: Page): Promise<StoreSnapshot> {
  return page.evaluate(() => (window as unknown as { __plumb: { getState(): StoreSnapshot } }).__plumb.getState());
}

async function w2s(page: Page, wx: number, wy: number): Promise<{ sx: number; sy: number }> {
  return page.evaluate(
    ([x, y]) => {
      const { getState } = (window as unknown as { __plumb: { getState(): StoreSnapshot } }).__plumb;
      const v = getState().view;
      const cv = document.querySelector('.cv') as HTMLCanvasElement;
      const r = cv.getBoundingClientRect();
      return { sx: r.left + (x - v.x) * v.s, sy: r.top + (y - v.y) * v.s };
    },
    [wx, wy] as [number, number],
  );
}

async function clickWorld(page: Page, wx: number, wy: number): Promise<void> {
  const p = await w2s(page, wx, wy);
  await page.mouse.click(p.sx, p.sy);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Proactive check posts the issue message.
  await expect(page.locator('.msg.agent .body')).toContainText(/issue/i, { timeout: 20000 });
});

test('1. proactive issue, ghost proposal, apply, follow-up, undo', async ({ page }) => {
  const before = await snap(page);
  const desk = before.plan.levels[0]?.items.find((i) => i.id === 'i_desk');
  expect(desk, 'fixture desk exists').toBeTruthy();

  // Pending proposal card from the proactive check.
  await expect(page.locator('.prop .go')).toBeVisible({ timeout: 20000 });
  await page.locator('.prop .go').first().click();
  await expect(page.locator('.prop .state')).toContainText(/applied/i, { timeout: 10000 });

  const after = await snap(page);
  const moved = after.plan.levels[0]?.items.find((i) => i.id === 'i_desk');
  expect(moved?.x, 'desk moved +200 east').toBe((desk?.x ?? 0) + 200);
  await expect(page.locator('.msg.agent .body').last()).toContainText(/no conflicts|re-checked/i, { timeout: 10000 });

  // Undo restores via the top bar.
  await page.getByLabel('Undo').click();
  const undone = await snap(page);
  expect(undone.plan.levels[0]?.items.find((i) => i.id === 'i_desk')?.x).toBe(desk?.x);
});

test('2. draw wall, add door, drag sofa, undo/redo each', async ({ page }) => {
  const start = await snap(page);
  const walls0 = start.plan.levels[0]?.walls.length ?? 0;
  const openings0 = start.plan.levels[0]?.openings.length ?? 0;

  // Wall tool: two clicks chain a wall, double-click ends.
  await page.keyboard.press('w');
  await clickWorld(page, 1000, 6000);
  await clickWorld(page, 3000, 6000);
  await page.mouse.dblclick((await w2s(page, 3000, 6000)).sx, (await w2s(page, 3000, 6000)).sy);
  await page.waitForTimeout(300);
  let s = await snap(page);
  expect(s.plan.levels[0]?.walls.length).toBe(walls0 + 1);

  // Door tool on the new wall (click near its midpoint).
  await page.keyboard.press('d');
  await clickWorld(page, 2000, 6000);
  await page.waitForTimeout(300);
  s = await snap(page);
  expect(s.plan.levels[0]?.openings.length).toBe(openings0 + 1);

  // Drag the sofa +500 east with Alt (free, no snap rounding surprises).
  await page.keyboard.press('v');
  const sofa = s.plan.levels[0]?.items.find((i) => i.label.toLowerCase().includes('sofa'));
  expect(sofa, 'sofa exists').toBeTruthy();
  const from = await w2s(page, sofa?.x ?? 0, sofa?.y ?? 0);
  const to = await w2s(page, (sofa?.x ?? 0) + 500, sofa?.y ?? 0);
  await page.mouse.move(from.sx, from.sy);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(to.sx, to.sy, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(300);
  s = await snap(page);
  const dragged = s.plan.levels[0]?.items.find((i) => i.id === sofa?.id);
  expect(Math.abs((dragged?.x ?? 0) - (sofa?.x ?? 0) - 500)).toBeLessThan(60);

  // Undo three times restores counts and pose; redo re-applies.
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  s = await snap(page);
  expect(s.plan.levels[0]?.walls.length).toBe(walls0);
  expect(s.plan.levels[0]?.openings.length).toBe(openings0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(300);
  s = await snap(page);
  expect(s.plan.levels[0]?.walls.length).toBe(walls0 + 1);
});

test('3. agent adds a plant to Bedroom 2', async ({ page }) => {
  const start = await snap(page);
  const items0 = start.plan.levels[0]?.items.length ?? 0;
  await page.locator('[data-composer]').fill('add a plant to Bedroom 2');
  await page.locator('[data-composer]').press('Enter');
  await expect(page.locator('.prop .go').last()).toBeVisible({ timeout: 20000 });
  await page.locator('.prop .go').last().click();
  await page.waitForTimeout(400);
  const s = await snap(page);
  expect(s.plan.levels[0]?.items.length).toBe(items0 + 1);
  expect(s.plan.levels[0]?.items.some((i) => i.label.toLowerCase().includes('plant'))).toBe(true);
});

test('4. ft units, dark theme, no overflow at 390px', async ({ page }) => {
  await page.getByRole('button', { name: 'Units' }).click();
  await expect(page.locator('.bottombar')).toContainText(/ft/);
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.getByRole('button', { name: 'Theme' }).click();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(theme).toBe('dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('aside.agent')).toBeVisible();
});

test('5. keyboard map: tools, composer focus, escape', async ({ page }) => {
  for (const [key, tool] of [['h', 'pan'], ['w', 'wall'], ['d', 'door'], ['n', 'window'], ['m', 'measure']] as const) {
    await page.keyboard.press(key);
    expect((await snap(page)).ui.tool).toBe(tool);
  }
  await page.keyboard.press('v');
  expect((await snap(page)).ui.tool).toBe('select');
  await page.keyboard.press('/');
  await expect(page.locator('[data-composer]')).toBeFocused();
  await page.keyboard.press('Escape');
  // Escape with nothing pending keeps select tool and blurs nothing critical.
  expect((await snap(page)).ui.tool).toBe('select');
});
