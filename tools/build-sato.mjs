// Preserve the supplied geometry, skin, textures and idle; append an in-place walk.
// Usage: node tools/build-sato.mjs path/to/original/sato.glb
import fs from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const source=fs.readFileSync(process.argv[2] || 'static/models/sato-source.glb');
const jsonLength=source.readUInt32LE(12);
const json=JSON.parse(source.subarray(20,20+jsonLength).toString());
const binary=source.subarray(28+jsonLength,28+jsonLength+source.readUInt32LE(20+jsonLength));
const loader=new GLTFLoader();
// Textures are retained byte-for-byte; authoring the skeleton needs no image decoder.
loader.register(parser=>({name:'animation-authoring',beforeRoot(){parser.loadTexture=async()=>null;}}));
const {scene,animations}=await loader.parseAsync(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength),'');
const mixer=new T.AnimationMixer(scene);
mixer.clipAction(animations[0]).play();mixer.update(0);scene.updateMatrixWorld(true);
const bones=[];scene.traverse(n=>{if(n.isBone)bones.push(n);});
const rest=new Map(bones.map(n=>[n.name,{p:n.position.clone(),q:n.quaternion.clone(),s:n.scale.clone(),world:n.getWorldQuaternion(new T.Quaternion()),point:n.getWorldPosition(new T.Vector3())}]));
const bone=name=>scene.getObjectByName(name);
const position=n=>n.getWorldPosition(new T.Vector3());
const quat=n=>n.getWorldQuaternion(new T.Quaternion());
const setWorld=(n,q)=>{n.quaternion.copy(quat(n.parent).invert().multiply(q));scene.updateMatrixWorld(true);};
const rotateWorld=(name,x=0,y=0,z=0)=>setWorld(bone(name),new T.Quaternion().setFromEuler(new T.Euler(x,y,z)).multiply(rest.get(name).world));
function aim(n,child,target){
  const origin=position(n),from=position(child).sub(origin).normalize(),to=target.clone().sub(origin).normalize();
  setWorld(n,new T.Quaternion().setFromUnitVectors(from,to).multiply(quat(n)));
}
function leg(side,target){
  const thigh=bone(`${side}_Thigh`),calf=bone(`${side}_Calf`),foot=bone(`${side}_Foot`);
  const hip=position(thigh),a=calf.position.length(),b=foot.position.length();
  const axis=target.clone().sub(hip),d=Math.min(axis.length(),a+b-.0001);axis.normalize();
  const forward=new T.Vector3(0,0,1).addScaledVector(axis,-axis.z).normalize();
  const along=(a*a-b*b+d*d)/(2*d),height=Math.sqrt(Math.max(0,a*a-along*along));
  const knee=hip.clone().addScaledVector(axis,along).addScaledVector(forward,height);
  aim(thigh,calf,knee);aim(calf,foot,target);
  // Keep the soles parallel to their original support plane, independent of knee flex.
  setWorld(foot,rest.get(foot.name).world);
}

const duration=.88,frames=64,stride=.38;
const samples=new Map(bones.map(n=>[n.name,{rotation:[],translation:[],scale:[]}]));
for(let frame=0;frame<=frames;frame++){
  const phase=frame/frames,angle=phase*Math.PI*2;
  for(const n of bones){const r=rest.get(n.name);n.position.copy(r.p);n.quaternion.copy(r.q);n.scale.copy(r.s);}
  scene.updateMatrixWorld(true);
  const hip=bone('Hip'),worldHip=rest.get('Hip').point.clone();
  worldHip.y-=.055+.006*Math.cos(angle*2);worldHip.x+=.008*Math.sin(angle);
  hip.position.copy(hip.parent.worldToLocal(worldHip));scene.updateMatrixWorld(true);
  rotateWorld('Pelvis',0,.045*Math.sin(angle),.018*Math.sin(angle));
  rotateWorld('Waist',.025,-.04*Math.sin(angle),-.012*Math.sin(angle));
  for(const [side,offset] of [['L',0],['R',.5]]){
    const p=(phase+offset)%1,target=rest.get(`${side}_Foot`).point.clone();
    target.x=side==='L'?.055:-.065;
    // Constant-speed planted half; a smooth swing with zero lift velocity at contact.
    if(p<.5){target.z+=stride*(.5-2*p);}
    else {const u=(p-.5)*2;target.z+=stride*(-.5+u-Math.sin(2*Math.PI*u)/Math.PI);target.y+=.07*Math.sin(Math.PI*u)**2;}
    leg(side,target);
    const swing=Math.cos(angle+offset*2*Math.PI);
    rotateWorld(`${side}_Upperarm`,.26*swing);
    // A small elbow pulse keeps the hands relaxed through the stride.
    bone(`${side}_Forearm`).quaternion.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),.06*Math.sin(angle+offset*2*Math.PI)));
  }
  for(const n of bones){const s=samples.get(n.name);s.rotation.push(...n.quaternion.toArray());s.translation.push(...n.position.toArray());s.scale.push(...n.scale.toArray());}
}

const chunks=[binary];let byteLength=binary.length;
function accessor(values,type,min,max){
  const data=Buffer.from(new Float32Array(values).buffer);
  const bufferView=json.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:data.length})-1;
  chunks.push(data);byteLength+=data.length;
  return json.accessors.push({bufferView,componentType:5126,count:values.length/({SCALAR:1,VEC3:3,VEC4:4}[type]),type,...(min?{min,max}:{})})-1;
}
const times=accessor(Array.from({length:frames+1},(_,i)=>i/frames*duration),'SCALAR',[0],[duration]);
const walk={name:'Walk',channels:[],samplers:[],extras:{cycleDistance:stride*2,duration,description:'In-place walk with planted stance, knee IK and opposite arm swing.'}};
for(const n of bones)for(const path of ['rotation','translation','scale']){
  const values=samples.get(n.name)[path],size=path==='rotation'?4:3;
  // Exact periodic endpoint avoids a seam when repeating the clip.
  values.splice(values.length-size,size,...values.slice(0,size));
  const output=accessor(values,path==='rotation'?'VEC4':'VEC3');
  const sampler=walk.samplers.push({input:times,output,interpolation:'LINEAR'})-1;
  walk.channels.push({sampler,target:{node:json.nodes.findIndex(v=>v.name===n.name),path}});
}
json.animations[0].name='Idle';json.animations.push(walk);json.buffers[0].byteLength=byteLength;
json.extras={...json.extras,sato:{sourceClip:'NlaTrack',sourceDuration:animations[0].duration,walkCycleDistance:stride*2}};
let jsonBuffer=Buffer.from(JSON.stringify(json));jsonBuffer=Buffer.concat([jsonBuffer,Buffer.alloc((4-jsonBuffer.length%4)%4,0x20)]);
const binBuffer=Buffer.concat(chunks),header=Buffer.alloc(20),binHeader=Buffer.alloc(8);
header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+jsonBuffer.length+binBuffer.length,8);header.writeUInt32LE(jsonBuffer.length,12);header.writeUInt32LE(0x4e4f534a,16);
binHeader.writeUInt32LE(binBuffer.length,0);binHeader.writeUInt32LE(0x004e4942,4);
fs.mkdirSync('static/models',{recursive:true});fs.writeFileSync('static/models/sato.glb',Buffer.concat([header,jsonBuffer,binHeader,binBuffer]));
console.log(`Sato: Idle (${animations[0].duration.toFixed(3)}s), Walk (${duration}s), ${bones.length} bones.`);
