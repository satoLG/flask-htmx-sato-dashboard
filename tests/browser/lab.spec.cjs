const {test, expect} = require('@playwright/test');

async function ready(page) {
  await page.goto('/lab');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('.robot-button').first()).toBeVisible();
}

test('renders real WebGL, moves the explorer, zooms, and explains a robot', async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  await expect(page.locator('#scene canvas')).toBeVisible();
  await expect(page.locator('#scene-fallback')).toBeHidden();
  const before = await page.locator('#coordinates').textContent();
  await page.locator('#scene').focus();
  await page.keyboard.down('a'); await page.waitForTimeout(700); await page.keyboard.up('a');
  await expect(page.locator('#coordinates')).not.toHaveText(before);
  await page.getByRole('button', {name:'Aproximar', exact:true}).click();
  await page.getByRole('button', {name:'Visão geral', exact:true}).click();
  await page.locator('[data-sector="rag"]').click();
  await page.locator('[data-robot="guide:rag"]').click();
  await expect(page.locator('#chat')).toBeVisible();
  await page.getByRole('button', {name:'Qual é sua função?'}).click();
  await expect(page.locator('#chat-messages .message.robot').last()).toContainText('base vetorial');
  await expect(page.locator('#chat-messages .message.robot').last()).toContainText('LanceDB');
  await page.locator('#chat-input').fill('wasd');
  const position = await page.locator('#coordinates').textContent();
  await page.keyboard.type('wasd');
  await expect(page.locator('#coordinates')).toHaveText(position);
  await page.keyboard.press('Escape'); await expect(page.locator('#chat')).toBeHidden();
  expect(errors).toEqual([]);
});

test('each sector is accessible through the keyboard-friendly roster', async ({page}) => {
  await ready(page);
  for (const id of ['hermes','models','mcp','rag','memory','cron','vm']) {
    await page.locator(`[data-sector="${id}"]`).click();
    await expect(page.locator(`[data-robot="guide:${id}"]`)).toBeVisible();
  }
});

test('recovers from network failure and marks retained data stale', async ({page}) => {
  await ready(page);
  await page.route('**/api/lab/state', route => route.abort());
  await expect(page.locator('#connection')).toHaveAttribute('data-state', 'offline', {timeout:15000});
  await expect(page.locator('#sync-note')).toContainText('desatualizados');
  await page.locator('[data-robot="guide:hermes"]').click();
  await expect(page.locator('#chat-status')).toContainText('desatualizados');
  await page.unroute('**/api/lab/state');
  await expect(page.locator('#connection')).not.toHaveAttribute('data-state', 'offline', {timeout:15000});
});

test('handles dynamic workers and task text safely', async ({page, request}) => {
  const snapshot = await (await request.get('/api/lab/state')).json();
  snapshot.workers.push(...Array.from({length:20}, (_, i) => ({id:`test:${i}`, name: i === 0 ? '<img src=x onerror=alert(1)>' : `Agente ${i}`, sector:'hermes', kind:'subagent', status:'running', status_label:'Execução registrada', detail:'Consultar documento', source:'fixture: subagent_runs', parent_id:'parent-1'})));
  snapshot.telemetry_available = true;
  await page.route('**/api/lab/state', route => route.fulfill({json:snapshot}));
  await ready(page);
  await expect(page.locator('[data-robot="test:0"]')).toContainText('<img');
  await expect(page.locator('#roster img')).toHaveCount(0);
  await page.locator('[data-robot="test:19"]').click();
  await expect(page.locator('#chat-name')).toHaveText('Agente 19');
  await expect(page.locator('#chat-messages')).toContainText('parent-1');
});

test('retains telemetry and chat when WebGL is unavailable', async ({page}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await ready(page);
  await expect(page.locator('#scene-fallback')).toBeVisible();
  await page.locator('[data-robot="guide:hermes"]').click();
  await expect(page.locator('#chat')).toBeVisible();
});

test('mobile layout has touch movement and usable conversation without overflow', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await ready(page);
  await expect(page.locator('.touch-controls')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-robot="guide:hermes"]').click();
  await expect(page.locator('#chat-input')).toBeVisible();
  const box = await page.locator('#chat').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
});
