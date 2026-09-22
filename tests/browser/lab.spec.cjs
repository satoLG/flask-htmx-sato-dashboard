const {test, expect} = require('@playwright/test');

async function ready(page) {
  await page.goto('/lab');
  await expect(page.locator('#loading')).toBeHidden({timeout:20000});
  await expect(page.locator('#connection')).not.toHaveAttribute('data-state','loading');
}
const position = page => page.locator('#scene').evaluate(el => ({x:+el.dataset.x,z:+el.dataset.z}));
async function visit(page, id) {
  await page.locator('#map-toggle').click();
  await page.locator(`[data-sector="${id}"]`).click();
  await expect(page.locator('#chat')).toBeHidden();
  await expect(page.locator('#interaction')).toHaveAttribute('data-robot',`guide:${id}`,{timeout:55000});
  await expect(page.locator('#interaction')).toBeVisible();
}

test('full-screen WebGL, walking, camera modes and proximity conversation', async ({page}) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await ready(page);
  await expect(page.locator('#scene-fallback')).toBeHidden();
  const canvas=await page.locator('#scene canvas').boundingBox();
  expect(canvas).toEqual({x:0,y:0,width:1440,height:1100});
  await expect(page.locator('#interaction')).toBeHidden();
  await expect(page.locator('.touch-controls,#scene-labels')).toHaveCount(0);
  const before=await position(page);
  await page.locator('#scene').focus();
  await page.keyboard.down('a');await page.waitForTimeout(800);await page.keyboard.up('a');
  await expect.poll(async()=>Math.abs((await position(page)).x-before.x)).toBeGreaterThan(.1);
  await page.locator('#camera-room').click();await expect(page.locator('#scene')).toHaveAttribute('data-camera','room');
  await page.locator('#camera-follow').click();
  await visit(page,'hermes');
  await page.locator('#scene').press('e');
  await expect(page.locator('#chat')).toBeVisible();
  await expect(page.locator('#scene')).toHaveAttribute('data-camera','chat');
  await page.getByRole('button',{name:'Qual é sua função?'}).click();
  await expect(page.locator('#chat-messages .message.robot').last()).toContainText('Coordeno');
  const stopped=await position(page);
  await page.locator('#chat-input').fill('wasd');await page.keyboard.type('wasd');
  await page.waitForTimeout(350);expect(await position(page)).toEqual(stopped);
  await page.keyboard.press('Escape');
  await expect(page.locator('#chat')).toBeHidden();
  await expect(page.locator('#interaction')).toBeVisible();
  await expect(page.locator('#scene')).toHaveAttribute('data-camera','follow');
  expect(errors).toEqual([]);
});

test('all seven stations can be reached around equipment', async ({page}) => {
  test.setTimeout(240000);
  await ready(page);
  for(const id of ['hermes','models','mcp','rag','cron','vm','memory']){
    await visit(page,id);
    await page.locator('#interaction').click();
    await expect(page.locator('#chat')).toBeVisible();
    await expect(page.locator('#chat-sector')).not.toBeEmpty();
    await page.locator('#chat-close').click();
  }
});

test('reconnects and labels retained telemetry stale', async ({page}) => {
  await ready(page);await visit(page,'hermes');
  await page.route('**/api/lab/state',route=>route.abort());
  await expect(page.locator('#connection')).toHaveAttribute('data-state','offline',{timeout:15000});
  await page.locator('#interaction').click();
  await expect(page.locator('#chat-status')).toContainText('desatualizados');
  await page.unroute('**/api/lab/state');
  await expect(page.locator('#connection')).not.toHaveAttribute('data-state','offline',{timeout:15000});
});

test('overflow subagents receive reachable benches and safe task text', async ({page,request}) => {
  const snapshot=await(await request.get('/api/lab/state')).json();
  snapshot.workers.push(...Array.from({length:20},(_,i)=>({id:`test:${i}`,name:i===0?'<img src=x onerror=alert(1)>':`Agente ${i}`,sector:'hermes',kind:'subagent',status:'running',status_label:'Execução registrada',detail:'Consultar documento',source:'fixture: subagent_runs',parent_id:'parent-1'})));
  await page.route('**/api/lab/state',route=>route.fulfill({json:snapshot}));
  await ready(page);await page.locator('#map-toggle').click();
  await expect(page.locator('#roster [data-robot="test:0"]')).toContainText('<img');
  await expect(page.locator('#roster img')).toHaveCount(0);
  await page.locator('#roster [data-robot="test:19"]').click();
  await expect(page.locator('#chat')).toBeHidden();
  await expect(page.locator('#interaction')).toHaveAttribute('data-robot','test:19',{timeout:45000});
  await page.locator('#interaction').click();
  await expect(page.locator('#chat-name')).toHaveText('Agente 19');
  await expect(page.locator('#chat-messages')).toContainText('parent-1');
});

test('telemetry remains accessible without WebGL', async ({page}) => {
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:original.call(this,type,...args);};});
  await ready(page);await expect(page.locator('#scene-fallback')).toBeVisible();
  await page.locator('#telemetry-toggle').click();await expect(page.locator('#telemetry-panel')).toBeVisible();
  await expect(page.locator('#sync-note')).toContainText('Leitura');
  await page.locator('#map-toggle').click();await page.locator('[data-sector="hermes"]').click();
  await expect(page.locator('#toast')).toContainText('WebGL');await expect(page.locator('#chat')).toBeHidden();
});

test('mobile touch scene and conversation fit the viewport', async ({page}) => {
  await page.setViewportSize({width:390,height:844});await ready(page);
  expect(await page.locator('#scene canvas').boundingBox()).toEqual({x:0,y:0,width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  const before=await position(page);await page.locator('#scene canvas').click({position:{x:190,y:640}});
  await expect.poll(async()=>Math.hypot((await position(page)).x-before.x,(await position(page)).z-before.z),{timeout:15000}).toBeGreaterThan(.2);
  await visit(page,'hermes');await page.locator('#interaction').click();
  await expect(page.locator('#chat-input')).toBeVisible();
  const box=await page.locator('#chat').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThan(844*.7);
});

test.describe('ambient movement',()=>{
  test.use({reducedMotion:'no-preference',viewport:{width:900,height:700}});
  test('idle actors animate and can be paused',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await ready(page);await page.waitForTimeout(2300);
    const first=await page.locator('#scene canvas').screenshot();
    await page.waitForTimeout(750);
    const second=await page.locator('#scene canvas').screenshot();
    expect(first.equals(second)).toBe(false);
    await page.locator('#map-toggle').click();await page.locator('#motion-toggle').click();
    await expect(page.locator('#motion-toggle')).toHaveAttribute('aria-pressed','true');
    expect(errors).toEqual([]);
  });
});
