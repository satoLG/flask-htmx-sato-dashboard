import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from '../static/vendor/three.module.min.js';
import {GLTFLoader} from '../static/vendor/GLTFLoader.js';
import {createSatoAvatar,AVATAR_HEIGHT} from '../static/js/lab-avatar.js';

async function load(){
  const loader=new GLTFLoader();
  loader.register(parser=>({name:'headless-test',beforeRoot(){parser.loadTexture=async()=>null;}}));
  const b=await fs.readFile(new URL('../static/models/sato.glb',import.meta.url));
  return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
}
test('asset has a preserved idle, a periodic walk and a bound 41-bone skin',async()=>{
  const unpack=buffer=>{const length=buffer.readUInt32LE(12);return {json:JSON.parse(buffer.subarray(20,20+length)),binary:buffer.subarray(28+length)};};
  const source=unpack(await fs.readFile(new URL('../static/models/sato-source.glb',import.meta.url)));
  const derived=unpack(await fs.readFile(new URL('../static/models/sato.glb',import.meta.url)));
  assert.deepEqual(derived.binary.subarray(0,source.binary.length),source.binary);
  for(const key of ['nodes','meshes','skins','materials','images'])assert.deepEqual(derived.json[key],source.json[key]);
  assert.deepEqual(derived.json.animations[0],{...source.json.animations[0],name:'Idle'});
  const gltf=await load();assert.deepEqual(gltf.animations.map(c=>c.name),['Idle','Walk']);
  assert.ok(Math.abs(gltf.animations[0].duration-12.291667)<.00001);
  let meshes=0;gltf.scene.traverse(n=>{if(n.isSkinnedMesh){meshes++;assert.equal(n.skeleton.bones.length,41);}});assert.equal(meshes,48);
  const clip=gltf.animations[1];assert.equal(clip.tracks.length,123);assert.ok(clip.validate());
  for(const track of clip.tracks){const size=track.getValueSize();assert.deepEqual([...track.values.slice(0,size)],[...track.values.slice(-size)]);}
});
test('feet remain planted during stance and clear the floor during swing',async()=>{
  const {scene,animations}=await load(),mixer=new T.AnimationMixer(scene);mixer.clipAction(animations[1]).play();
  for(const [side,offset] of [['L',0],['R',.5]]){
    const foot=scene.getObjectByName(`${side}_Foot`),samples=[];
    for(let i=0;i<=20;i++){
      const phase=i/40;mixer.setTime(((phase+offset)%1)*animations[1].duration);scene.updateMatrixWorld(true);samples.push(foot.getWorldPosition(new T.Vector3()));
    }
    const ys=samples.map(p=>p.y);assert.ok(Math.max(...ys)-Math.min(...ys)<.004,`${side} stance y drift: ${Math.max(...ys)-Math.min(...ys)}`);
    // Support foot moves backward at constant speed to cancel forward root motion.
    for(let i=1;i<samples.length;i++)assert.ok(Math.abs(samples[i].z-samples[i-1].z+.019)<.003,`${side} stance slides`);
    mixer.setTime(((.75+offset)%1)*animations[1].duration);scene.updateMatrixWorld(true);
    assert.ok(foot.getWorldPosition(new T.Vector3()).y-Math.max(...ys)>.055);
  }
});
test('idle/walk blending is continuous, reversible, speed-matched and respects pause',async()=>{
  const rig=createSatoAvatar(await load());
  assert.equal(rig.idle.getEffectiveWeight(),1);assert.equal(rig.walk.getEffectiveWeight(),0);
  rig.root.scale.setScalar(1.12);
  const height=new T.Box3().setFromObject(rig.root).getSize(new T.Vector3()).y;assert.ok(Math.abs(height-AVATAR_HEIGHT*1.12)<.001);
  rig.update(1/60,{speed:2.7});let w=rig.walk.getEffectiveWeight();assert.ok(w>0&&w<.2);
  for(let i=0;i<60;i++)rig.update(1/60,{speed:2.7});assert.ok(rig.walk.getEffectiveWeight()>.99);
  assert.ok(Math.abs(rig.walk.getEffectiveTimeScale()*.76*rig.model.scale.x*1.12/rig.walk.getClip().duration-2.7)<.001);
  const before=rig.walk.time;rig.update(1/60,{speed:0});w=rig.walk.getEffectiveWeight();assert.ok(w>.8&&w<1);assert.ok(rig.walk.time>=before);
  rig.update(1/60,{speed:2.7});assert.ok(rig.walk.getEffectiveWeight()>w);
  for(let i=0;i<90;i++)rig.update(1/60,{speed:0});assert.equal(rig.walk.getEffectiveWeight(),0);
  for(let i=0;i<60;i++)rig.update(1/60,{speed:2.7});
  rig.update(1/60,{speed:0,reduced:true});assert.ok(rig.transitioning);
  for(let i=0;i<90;i++)rig.update(1/60,{speed:2.7,reduced:true});assert.equal(rig.walk.getEffectiveWeight(),0);assert.equal(rig.idle.time,0);assert.equal(rig.transitioning,false);
  assert.ok(Math.abs(rig.idle.getEffectiveWeight()+rig.walk.getEffectiveWeight()-1)<1e-6);
});
