import { chromium, expect, type WebSocketRoute } from '@playwright/test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation';
import { applyAction, isAction } from '../src/protocol';
import { ITEMS } from '../src/data';

// Use the real client and simulation, with an isolated world connection. No live player data changes.
const sim = new Simulation();
const browser = await chromium.launch({ headless: true, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
let socket: WebSocketRoute;
const snapshot = () => socket.send(JSON.stringify({
  type: 'world', state: sim.state, revision: sim.revision, population: 1, bases: [], explored: [],
  players: [{ id: 'inventory-test', name: 'Engineer', color: '#e9c77e', ...sim.state.player, base: { x: 0, z: 0 } }],
}));
await page.routeWebSocket('**/api/world', route => {
  socket = route;
  route.onMessage(raw => {
    const message = JSON.parse(String(raw));
    if (message.type === 'join') {
      route.send(JSON.stringify({ type: 'welcome', id: 'inventory-test', token: 'isolated-inventory-test' }));
      snapshot();
    } else if (isAction(message)) {
      const result = applyAction(sim, message);
      route.send(JSON.stringify({ type: 'result', message: result }));
      snapshot();
    }
  });
});

try {
  await page.goto(process.env.PLAY_URL || 'http://localhost:5173');
  await expect(page.locator('#res-log')).toHaveText('90');
  await expect(page.locator('#inventory-items .resource')).toHaveCount(4);
  await expect(page.locator('#discovery')).toBeHidden();
  await expect(page.locator('[data-build="quarry"], [data-build="press"], [data-build="assembler"]')).toHaveCount(0);
  await expect(page.locator('#res-gear, #res-coal, #res-crystal')).toHaveCount(0);
  const originalHeight = (await page.locator('.resources').boundingBox())!.height;
  assert.ok(originalHeight <= 44, `Compact inventory is ${originalHeight}px tall`);
  await page.screenshot({ path: '.context/inventory-compact.png' });

  // Number keys follow the displayed cards after hidden blueprints are removed.
  await page.keyboard.press('Digit3');
  await expect(page.locator('[data-build="sawmill"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Craft with your supplies' }).click();
  await expect(page.locator('[data-craft]')).toHaveCount(3);
  await page.locator('[data-craft="gear"]').click();
  await expect(page.locator('#res-gear')).toHaveText('1');
  await expect(page.locator('[data-craft="mechanism"]')).toBeVisible();
  await expect(page.locator('#discovery')).toBeHidden();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('#discovery')).toContainText('New material discovered!');
  await expect(page.locator('#discovery strong')).toHaveText('Gears');
  await page.evaluate(() => document.querySelector('#discovery')!.getAnimations().forEach(animation => animation.playbackRate = .1));
  await page.screenshot({ path: '.context/inventory-material-discovered.png' });
  await page.getByRole('button', { name: 'Dismiss discovery' }).click();
  await expect(page.locator('#discovery')).toContainText('New blueprint discovered!');
  await expect(page.locator('#discovery strong')).toHaveText('Mechanisms');
  await page.getByRole('button', { name: 'Dismiss discovery' }).click();
  await expect(page.locator('#discovery')).toBeHidden();
  snapshot();
  await expect(page.locator('#discovery')).toBeHidden();

  // A chapter update should reveal its machine, without adding output materials early.
  sim.state.unlock = 1;snapshot();
  await expect(page.locator('[data-build="press"]')).toBeVisible();
  await expect(page.locator('#discovery strong')).toHaveText('Gear press');
  await expect.poll(() => page.locator('#discovery').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
  await page.screenshot({ path: '.context/inventory-blueprint-discovered.png' });
  await page.getByRole('button', { name: 'Dismiss discovery' }).click();
  await expect(page.locator('#discovery')).toBeHidden();

  // Consuming the last gear retains its slot, including after the next connection.
  await page.getByRole('button', { name: 'Craft with your supplies' }).click();
  await page.locator('[data-craft="mechanism"]').click();
  await expect(page.locator('#res-gear')).toHaveText('0');
  await page.reload();
  await expect(page.locator('#res-gear')).toHaveText('0');
  await expect(page.locator('#res-mechanism')).toHaveText('1');
  await expect(page.locator('#discovery')).toBeHidden();

  // At full progression every slot remains reachable, including with reduced motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const item of Object.keys(ITEMS)) sim.state.inventory[item as keyof typeof ITEMS] = 1000;
  sim.state.unlock = 2;snapshot();
  await expect(page.locator('#inventory-items .resource')).toHaveCount(Object.keys(ITEMS).length);
  await expect(page.locator('#discovery')).toBeVisible();
  assert.equal(await page.locator('#discovery').evaluate(node => getComputedStyle(node).animationName), 'none');
  for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 800 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    const bounds = await page.locator('.resources').boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, JSON.stringify(bounds));
    assert.ok(bounds!.height <= 44);
    await expect(page.getByRole('button', { name: 'Craft with your supplies' })).toBeInViewport();
    await page.locator('.resource').first().focus();
    await page.locator('.resource').last().focus();
    await expect(page.locator('.resource').last()).toBeInViewport();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `.context/inventory-${viewport.width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('INVENTORY PASSED: compact starter HUD, hidden unknowns, keyboard mapping, craft discoveries, queued notices, chapter unlock, spending/reconnect, all-resource layouts, reduced motion, no client errors.');
} finally {
  await browser.close();
}
