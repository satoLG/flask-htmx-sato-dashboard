const {test,expect}=require('@playwright/test');

test('lab avoids cached legacy JavaScript, including relative module imports',async({page})=>{
  const errors=[],legacy=[],assets=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/lab-assets/'))assets.push(new URL(request.url()).pathname);});
  // Reproduce the pre-immersive script with the current template: its line 33
  // appends labels to a container that the current lab no longer has.
  await page.route('**/static/js/lab*.js',route=>{
    legacy.push(route.request().url());
    return route.fulfill({contentType:'application/javascript',body:'\n'.repeat(32)+"document.getElementById('scene-labels').append(document.createElement('button'));"});
  });
  await page.goto('/lab');
  await expect(page.locator('#loading')).toBeHidden({timeout:20000});
  await expect(page.locator('#scene canvas')).toHaveCount(1);
  await expect(page.locator('#sectors button')).toHaveCount(7);
  await page.locator('#map-toggle').click();await expect(page.locator('#map-panel')).toBeVisible();
  expect(errors).toEqual([]);expect(legacy).toEqual([]);
  for(const file of ['js/lab.js','js/lab-scene.js','js/lab-avatar.js','vendor/GLTFLoader.js','models/sato.glb']){
    expect(assets.some(path=>path.endsWith('/'+file))).toBe(true);
  }
  expect(new Set(assets.map(path=>path.split('/')[2])).size).toBe(1);
});
