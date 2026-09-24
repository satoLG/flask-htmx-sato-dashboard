const {test,expect}=require('@playwright/test');

test('real GLB textures render and animated poses blend without WebGL errors',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/__avatar_test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
  await page.goto('/__avatar_test');
  const result=await page.evaluate(async()=>{
    const T=await import('/static/vendor/three.module.min.js');
    const {loadSatoAvatar}=await import('/static/js/lab-avatar.js');
    const hero=await loadSatoAvatar(),scene=new T.Scene();scene.add(hero.root);
    scene.add(new T.HemisphereLight(0xffffff,0x555555,3));
    const camera=new T.PerspectiveCamera(40,1,.1,100);camera.position.set(0,1.3,5);camera.lookAt(0,1.3,0);
    const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(400,400);document.body.append(renderer.domElement);
    let textured=0,bones=0;hero.model.traverse(n=>{if(n.isSkinnedMesh&&n.material.map?.image)textured++;if(n.isBone)bones++;});
    const foot=hero.model.getObjectByName('L_Foot'),poses=[];
    for(const speed of [0,2.7,0]){
      for(let i=0;i<45;i++){hero.update(1/60,{speed});renderer.render(scene,camera);}
      poses.push({weight:hero.walk.getEffectiveWeight(),position:foot.getWorldPosition(new T.Vector3()).toArray()});
    }
    hero.update(1/60,{reduced:true});renderer.render(scene,camera);
    const gl=renderer.getContext(),pixels=new Uint8Array(400*400*4);gl.readPixels(0,0,400,400,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const lit=pixels.filter((v,i)=>i%4!==3&&v>20).length;
    const glError=gl.getError();renderer.dispose();return {textured,bones,poses,lit,glError};
  });
  expect(result.textured).toBe(37);expect(result.bones).toBe(41);expect(result.lit).toBeGreaterThan(5000);
  expect(result.poses[0].weight).toBe(0);expect(result.poses[1].weight).toBeGreaterThan(.99);expect(result.poses[2].weight).toBeLessThan(.001);
  expect(result.poses[0].position).not.toEqual(result.poses[1].position);
  expect(result.glError).toBe(0);expect(errors).toEqual([]);
});

test('failed avatar request leaves the telemetry fallback usable',async({page})=>{
  await page.route('**/models/sato.glb',route=>route.abort());
  await page.goto('/lab');await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#scene-fallback')).toBeVisible();
  await page.locator('#telemetry-toggle').click();await expect(page.locator('#telemetry-panel')).toBeVisible();
  await expect(page.locator('#connection')).not.toHaveAttribute('data-state','loading');
});
