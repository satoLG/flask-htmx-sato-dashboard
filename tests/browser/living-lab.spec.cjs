const {test,expect}=require('@playwright/test');
const {livingFixture}=require('./living-fixture.cjs');

async function enterRag(page){
  await page.goto('/lab');await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#map-toggle').click();await page.locator('[data-sector="rag"]').click();
  await expect(page.locator('#rag-action')).toBeVisible({timeout:45000});await page.locator('#rag-action').click();
  await expect(page.locator('#rag-panel')).toBeVisible();
}
test('RAG dome expands real endpoint payloads and displays semantic search results',async({page,request})=>{
  test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const fixture=await livingFixture(page,request);await enterRag(page);
  await expect(page.locator('#rag-node-list [data-node="doc:0"]')).toBeVisible();
  await page.locator('#rag-query').fill('como conectar MCP?');await page.locator('#rag-search-submit').click();
  await expect(page.locator('#rag-summary')).toContainText('3 resultados reais');
  expect(fixture.queries).toEqual(['como conectar MCP?']);
  await expect(page.locator('#rag-node-detail')).toContainText('Distância vetorial: 0.1200');
  await page.locator('#rag-node-list [data-node="doc:2"]').click();
  await expect(page.locator('#rag-node-detail')).toContainText('Trecho de teste 3');
  await page.route('**/api/rag/graph*',route=>route.abort());await page.locator('#rag-reset').click();
  await expect(page.locator('#rag-summary')).toContainText('Última leitura preservada');
  await expect(page.locator('#rag-node-list [data-node="doc:2"]')).toBeVisible();
  await page.locator('#rag-close').click();await expect(page.locator('#scene')).toHaveAttribute('data-camera','follow');
  expect(errors).toEqual([]);
});

test('mobile RAG keeps the dome above the controls',async({page,request})=>{
  test.setTimeout(90000);await page.setViewportSize({width:390,height:844});await livingFixture(page,request);await enterRag(page);
  const box=await page.locator('#rag-panel').boundingBox();expect(box.y).toBeGreaterThan(844*.5);expect(box.x+box.width).toBeLessThanOrEqual(390);
  await page.locator('#rag-query').fill('memória');await page.locator('#rag-search-submit').click();await expect(page.locator('#rag-summary')).toContainText('3 resultados reais');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('an explicitly visited guide wins over an adjacent cron worker',async({page,request})=>{
  test.setTimeout(90000);const {state}=await livingFixture(page,request);
  for(let i=0;i<3;i++)state.workers.push({id:`cron:test-${i}`,name:`Timer ${i}`,sector:'cron',kind:'job',status:'configured',status_label:'Configurado',detail:'Teste',source:'fixture'});
  await page.goto('/lab');await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#map-toggle').click();await page.locator('[data-sector="cron"]').click();
  await expect(page.locator('#interaction')).toHaveAttribute('data-robot','guide:cron',{timeout:55000});
  await page.locator('#interaction').click();await expect(page.locator('#chat-name')).toHaveText('C-06');
});
