// Repair the source skin and author grounded clips in bind space.
import fs from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {repairSkin} from './sato-mesh.mjs';
const source=fs.readFileSync(process.argv[2] || 'static/models/sato-source.glb');
const jsonLength=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonLength));
const binary=source.subarray(28+jsonLength,28+jsonLength+source.readUInt32LE(20+jsonLength));
const loader=new GLTFLoader();
loader.register(parser=>({name:'animation-authoring',beforeRoot(){parser.loadTexture=async()=>null;}}));
const {scene,parser}=await loader.parseAsync(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength),'');
const bones=[];let skeleton;scene.traverse(n=>{if(n.isBone)bones.push(n);if(n.isSkinnedMesh)skeleton=n.skeleton;});
skeleton.pose();scene.updateMatrixWorld(true);
const bone=name=>scene.getObjectByName(name),position=n=>n.getWorldPosition(new T.Vector3()),quat=n=>n.getWorldQuaternion(new T.Quaternion());
const snapshot=()=>new Map(bones.map(n=>[n.name,{p:n.position.clone(),q:n.quaternion.clone(),s:n.scale.clone(),world:quat(n),point:position(n)}]));
const bind=snapshot();
const setWorld=(n,q)=>{n.quaternion.copy(quat(n.parent).invert().multiply(q));scene.updateMatrixWorld(true);};
const atWorld=(n,p)=>{n.position.copy(n.parent.worldToLocal(p.clone()));scene.updateMatrixWorld(true);};
const upright=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),Math.PI);
function aim(n,child,target){const origin=position(n),from=position(child).sub(origin).normalize(),to=target.clone().sub(origin).normalize();setWorld(n,new T.Quaternion().setFromUnitVectors(from,to).multiply(quat(n)));}
const feet={};
for(const side of ['L','R']){
 let sole=Infinity;scene.traverse(n=>{if(n.isSkinnedMesh){const p=n.geometry.attributes.position;for(let i=0;i<p.count;i++)if((p.getX(i)>0)===(side==='L'))sole=Math.min(sole,p.getY(i));}});
 feet[side]=bind.get(`${side}_Foot`).point.clone();feet[side].x=side==='L'?.08:-.08;feet[side].y-=sole;
}
const repair=repairSkin(scene);
function leg(side,target,pitch=0){
 const thigh=bone(`${side}_Thigh`),calf=bone(`${side}_Calf`),foot=bone(`${side}_Foot`),hip=position(thigh),a=calf.position.length(),b=foot.position.length();
 const axis=target.clone().sub(hip),d=axis.length();if(d>a+b+.001)throw new Error(`${side} foot exceeds reach by ${d-a-b}`);
 axis.normalize();const length=Math.min(d,a+b-.00001),forward=new T.Vector3(0,0,1).addScaledVector(axis,-axis.z).normalize();
 const along=(a*a-b*b+length*length)/(2*length),height=Math.sqrt(Math.max(0,a*a-along*along));
 aim(thigh,calf,hip.clone().addScaledVector(axis,along).addScaledVector(forward,height));aim(calf,foot,target);
 // Bind-space sole orientation, not the downward tilt in the source idle.
 setWorld(foot,new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),pitch).multiply(bind.get(foot.name).world));
}
atWorld(bone('Hip'),new T.Vector3(0,.405,.0194));setWorld(bone('Pelvis'),upright);setWorld(bone('Waist'),upright);
for(const side of ['L','R']){
 bone(`${side}_Thigh`).position.y=0;scene.updateMatrixWorld(true);
 const upper=bone(`${side}_Upperarm`),lower=bone(`${side}_Forearm`),hand=bone(`${side}_Hand`),sign=side==='L'?1:-1;
 aim(upper,lower,position(upper).add(new T.Vector3(sign*.032,-.15,0)));aim(lower,hand,position(lower).add(new T.Vector3(sign*.008,-.12,.025)));leg(side,feet[side]);
}
setWorld(bone('NeckTwist01'),new T.Quaternion().setFromEuler(new T.Euler(-.09,Math.PI,0,'YXZ')));
const neutral=snapshot();
const rotate=(name,x=0,y=0,z=0)=>setWorld(bone(name),new T.Quaternion().setFromEuler(new T.Euler(x,y,z)).multiply(neutral.get(name).world));
function reset(){for(const n of bones){const r=neutral.get(n.name);n.position.copy(r.p);n.quaternion.copy(r.q);n.scale.copy(r.s);}scene.updateMatrixWorld(true);}
const chunks=[binary];let byteLength=binary.length;
function accessor(values,type,min,max,componentType=5126){
 const data=Buffer.from((componentType===5123?new Uint16Array(values):new Float32Array(values)).buffer),padding=(4-byteLength%4)%4;
 if(padding){chunks.push(Buffer.alloc(padding));byteLength+=padding;}
 const bufferView=json.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:data.length})-1;chunks.push(data);byteLength+=data.length;
 return json.accessors.push({bufferView,componentType,count:values.length/({SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type]),type,...(min?{min,max}:{})})-1;
}
for(const mesh of repair.meshes){
 const meshIndex=parser.associations.get(mesh).meshes,geometry=mesh.geometry,primitive=json.meshes[meshIndex].primitives[0];geometry.computeBoundingBox();
 for(const [name,semantic,type]of [['position','POSITION','VEC3'],['normal','NORMAL','VEC3'],['uv','TEXCOORD_0','VEC2'],['skinIndex','JOINTS_0','VEC4'],['skinWeight','WEIGHTS_0','VEC4']])primitive.attributes[semantic]=accessor(geometry.attributes[name].array,type,name==='position'?geometry.boundingBox.min.toArray():undefined,name==='position'?geometry.boundingBox.max.toArray():undefined,name==='skinIndex'?5123:5126);
 primitive.indices=accessor(geometry.index.array,'SCALAR',undefined,undefined,5123);
}
const frames=96,stride=.32;json.animations=[];
for(const [name,duration]of [['Idle',4.8],['Walk',.92]]){
 const samples=new Map(bones.map(n=>[n.name,{rotation:[],translation:[],scale:[]}]));
 for(let frame=0;frame<=frames;frame++){
  reset();const phase=frame/frames,angle=phase*Math.PI*2,walking=name==='Walk',hip=neutral.get('Hip').point.clone();
  hip.y+=walking?-.032-.008*Math.cos(angle*2):.0012*Math.sin(angle);
  // Root and hip X/Z stay fixed. Only navigation owns horizontal displacement.
  atWorld(bone('Hip'),hip);
  if(walking){rotate('Pelvis',0,.065*Math.sin(angle),.018*Math.sin(angle));rotate('Waist',.035,-.03*Math.sin(angle),-.01*Math.sin(angle));rotate('Spine01',.02+.01*Math.sin(angle*2),-.05*Math.sin(angle),-.016*Math.sin(angle));rotate('Spine02',.01,-.065*Math.sin(angle),-.012*Math.sin(angle));rotate('NeckTwist01',-.012*Math.sin(angle*2),-.018*Math.sin(angle));}
  else{rotate('Waist',.006*Math.sin(angle));rotate('Spine01',.008*Math.sin(angle),.009*Math.sin(angle));rotate('Spine02',.006*Math.sin(angle+.35),.012*Math.sin(angle));rotate('NeckTwist01',.004*Math.sin(angle),.013*Math.sin(angle));}
  for(const [side,offset]of [['L',0],['R',.5]]){
   const p=(phase+offset)%1,target=feet[side].clone();let pitch=0;
   if(walking){target.z=hip.z;if(p<.5)target.z+=stride*(.5-2*p);else{const u=(p-.5)*2;target.z+=stride*(-.5+u-Math.sin(2*Math.PI*u)/Math.PI);target.y+=.055*Math.sin(Math.PI*u)**2;pitch=.12*Math.sin(2*Math.PI*u);}}
   leg(side,target,pitch);
   const swing=walking?.28*Math.cos(angle+offset*2*Math.PI):.012*Math.sin(angle+offset*2*Math.PI);
   rotate(`${side}_Upperarm`,swing,0,(walking?.015:.007)*Math.sin(angle+offset*2*Math.PI));bone(`${side}_Forearm`).quaternion.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),.06*(walking?Math.sin(angle+offset*2*Math.PI):0)));
  }
  for(const n of bones){const s=samples.get(n.name);s.rotation.push(...n.quaternion.toArray());s.translation.push(...n.position.toArray());s.scale.push(...n.scale.toArray());}
 }
 const times=accessor(Array.from({length:frames+1},(_,i)=>i/frames*duration),'SCALAR',[0],[duration]),clip={name,channels:[],samplers:[]};
 for(const n of bones)for(const path of ['rotation','translation','scale']){const values=samples.get(n.name)[path],size=path==='rotation'?4:3;values.splice(values.length-size,size,...values.slice(0,size));const output=accessor(values,path==='rotation'?'VEC4':'VEC3'),sampler=clip.samplers.push({input:times,output,interpolation:'LINEAR'})-1;clip.channels.push({sampler,target:{node:json.nodes.findIndex(v=>v.name===n.name),path}});}
 json.animations.push(clip);
}
// Small, readable black eyes behind the glasses. Separate pivots close the pupils
// and highlights together; the skin-colored sockets cover the baked eye marks.
const sphere=new T.SphereGeometry(1,16,12);sphere.computeBoundingBox();
const eyeAttributes={POSITION:accessor(sphere.attributes.position.array,'VEC3',[-1,-1,-1],[1,1,1]),NORMAL:accessor(sphere.attributes.normal.array,'VEC3')};
const eyeIndices=accessor(sphere.index.array,'SCALAR',undefined,undefined,5123);
const eyeMeshes=['#dfa341','#11100e','#fff2d3'].map(color=>{
 const material=json.materials.push({name:`Eye ${color}`,pbrMetallicRoughness:{baseColorFactor:[...new T.Color(color).toArray(),1],metallicFactor:0,roughnessFactor:.9}})-1;
 return json.meshes.push({primitives:[{attributes:eyeAttributes,indices:eyeIndices,material}]})-1;
});
const headIndex=json.nodes.findIndex(n=>n.name==='Head'),headInverse=skeleton.boneInverses[skeleton.bones.indexOf(bone('Head'))];
const blinkNodes=[];
for(const [side,x]of [['L',.052],['R',-.052]]){
 const pivot=json.nodes.push({name:`EyeSocket_${side}`,translation:new T.Vector3(x,.823,.114).applyMatrix4(headInverse).toArray(),rotation:bind.get('Head').world.clone().invert().toArray(),children:[]})-1;
 (json.nodes[headIndex].children??=[]).push(pivot);
 const socket=json.nodes.push({name:`EyeSkin_${side}`,mesh:eyeMeshes[0],scale:[.019,.019,.004]})-1;
 const blink=json.nodes.push({name:`EyeBlink_${side}`,translation:[0,0,.006],children:[]})-1;
 json.nodes[pivot].children.push(socket,blink);blinkNodes.push(blink);
 json.nodes[blink].children.push(json.nodes.push({name:`Pupil_${side}`,mesh:eyeMeshes[1],scale:[.0095,.013,.003]})-1);
 json.nodes[blink].children.push(json.nodes.push({name:`EyeHighlight_${side}`,mesh:eyeMeshes[2],translation:[-.003,.004,.0029],scale:[.0022,.0022,.0012]})-1);
}
const blinkInput=accessor([0,3.2,3.26,3.29,3.38,4.6],'SCALAR',[0],[4.6]);
const blinkOutput=accessor([1,1,1,1,1,1,1,.06,1,1,.06,1,1,1,1,1,1,1],'VEC3');
json.animations.push({name:'Blink',samplers:[{input:blinkInput,output:blinkOutput,interpolation:'LINEAR'}],channels:blinkNodes.map(node=>({sampler:0,target:{node,path:'scale'}}))});
json.buffers[0].byteLength=byteLength;
json.extras={...json.extras,sato:{sourceClip:'NlaTrack',sourceDuration:12.2916667,walkCycleDistance:stride*2,skinRepair:'Shared seam weights, knee support rings, rigid head and soles.',idle:'Anchored feet and stationary root/hip XZ.'}};
let jsonBuffer=Buffer.from(JSON.stringify(json));jsonBuffer=Buffer.concat([jsonBuffer,Buffer.alloc((4-jsonBuffer.length%4)%4,0x20)]);
let binBuffer=Buffer.concat(chunks);binBuffer=Buffer.concat([binBuffer,Buffer.alloc((4-binBuffer.length%4)%4)]);
const header=Buffer.alloc(20),binHeader=Buffer.alloc(8);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+jsonBuffer.length+binBuffer.length,8);header.writeUInt32LE(jsonBuffer.length,12);header.writeUInt32LE(0x4e4f534a,16);binHeader.writeUInt32LE(binBuffer.length,0);binHeader.writeUInt32LE(0x004e4942,4);
fs.writeFileSync('static/models/sato.glb',Buffer.concat([header,jsonBuffer,binHeader,binBuffer]));console.log(`Sato: repaired ${repair.vertices} vertices, anchored Idle (4.8s), Walk (.92s).`);
