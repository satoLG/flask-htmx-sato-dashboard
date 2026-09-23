import * as T from '../vendor/three.module.min.js';
import {GLTFLoader} from '../vendor/GLTFLoader.js';

export const AVATAR_HEIGHT=2.45;
export async function loadSatoAvatar(){
  const gltf=await new GLTFLoader().loadAsync(new URL('../models/sato.glb',import.meta.url).href);
  return createSatoAvatar(gltf);
}

export function createSatoAvatar({scene,animations,parser}){
  const idleClip=animations.find(clip=>clip.name==='Idle');
  const walkClip=animations.find(clip=>clip.name==='Walk');
  if(!idleClip||!walkClip)throw new Error('Sato precisa dos clipes Idle e Walk.');
  const root=new T.Group();root.name='Sato';root.rotation.y=.65;
  const mixer=new T.AnimationMixer(scene);
  const idle=mixer.clipAction(idleClip).play();
  const walk=mixer.clipAction(walkClip).play().setEffectiveWeight(0);
  const blinkClip=animations.find(clip=>clip.name==='Blink');
  const blink=blinkClip?mixer.clipAction(blinkClip).play():null;
  mixer.update(0);scene.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(scene);
  const scale=AVATAR_HEIGHT/(bounds.max.y-bounds.min.y);
  const model=new T.Group();model.scale.setScalar(scale);
  model.position.y=-bounds.min.y*scale;model.add(scene);root.add(model);
  scene.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;if(object.isSkinnedMesh)object.frustumCulled=false;}});
  const cycleDistance=parser?.json.extras?.sato?.walkCycleDistance ?? .64;
  let blend=0;
  return {
    type:'sato',root,model,mixer,idle,walk,blink,
    get transitioning(){return blend>0&&blend<1;},
    update(dt,{speed=0,reduced=false}={}){
      // Speed is measured after collision resolution, in world units per second.
      // Both actions keep their phase, so quick input reversals never restart a pose.
      const target=reduced?0:T.MathUtils.smoothstep(speed,0,.7);
      blend=T.MathUtils.damp(blend,target,target>blend?9:11,dt);
      if(Math.abs(blend-target)<.0001)blend=target;
      idle.setEffectiveWeight(1-blend);walk.setEffectiveWeight(blend);
      const worldScale=scale*root.scale.x;
      walk.setEffectiveTimeScale(Math.max(.15,speed*walkClip.duration/(cycleDistance*worldScale)));
      if(reduced){
        // Settle to one neutral frame without continuing ambient animation.
        idle.time=0;if(blink)blink.time=0;mixer.update(0);
      }else mixer.update(dt);
    },
  };
}
