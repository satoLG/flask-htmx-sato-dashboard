const {test,expect}=require('@playwright/test');

test('private robot chat logs in, queues a question and later shows the Hermes answer',async({page})=>{
  let authenticated=false,csrfSeen=false;const jobs=[];
  await page.route('**/api/lab/hermes-chat/session',route=>route.fulfill({json:{available:true,authenticated,csrf:authenticated?'test-csrf':null}}));
  await page.route('**/api/lab/hermes-chat/login',route=>{
    authenticated=route.request().postDataJSON().password==='test-password';
    return route.fulfill({json:{available:true,authenticated,csrf:'test-csrf'}});
  });
  await page.route('**/api/lab/hermes-chat/jobs',route=>{
    csrfSeen=route.request().headers()['x-chat-csrf']==='test-csrf';
    const payload=route.request().postDataJSON();jobs.push({id:'a'.repeat(32),robot_id:payload.robot_id,question:payload.question,status:'queued',answer:null,error:null,attempts:0,created_at:Date.now()/1000,updated_at:Date.now()/1000});
    setTimeout(()=>{jobs[0].status='done';jobs[0].answer='Hermes confirma que a VM usa CPU e RAM.';jobs[0].updated_at=Date.now()/1000;},4000);
    return route.fulfill({status:202,json:{id:jobs[0].id,status:'queued'}});
  });
  await page.route('**/api/lab/hermes-chat/history?**',route=>route.fulfill({json:{jobs}}));
  await page.goto('/lab');await expect(page.locator('#loading')).toBeHidden({timeout:20000});
  await page.locator('#map-toggle').click();await page.locator('[data-sector="hermes"]').click();
  await expect(page.locator('#interaction')).toHaveAttribute('data-robot','guide:hermes',{timeout:55000});
  await page.locator('#interaction').click();await expect(page.locator('#chat-login')).toBeVisible();
  await expect(page.locator('#chat-form')).toBeHidden();
  await page.locator('#chat-password').fill('test-password');await page.locator('#chat-login button').click();
  await expect(page.locator('#chat-form')).toBeVisible();
  await page.locator('#chat-input').fill('Qual é o uso da VM?');await page.locator('#chat-form button').click();
  await expect(page.locator('#chat-messages')).toContainText('Pergunta guardada na fila');
  await expect(page.locator('#chat-messages')).toContainText('Hermes confirma que a VM usa CPU e RAM.',{timeout:10000});
  expect(csrfSeen).toBe(true);
});
