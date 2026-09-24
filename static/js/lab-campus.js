import * as T from '../vendor/three.module.min.js';
import {findPath} from './lab-navigation.js';

export const ZONES = {
  hermes:{x:0,z:-3,color:'#56d5c3'}, models:{x:-19,z:-16,color:'#e9ab61'},
  mcp:{x:-3,z:-21,color:'#6ccce0'}, rag:{x:19,z:-14,color:'#83cbb3'},
  memory:{x:-19,z:4,color:'#bab5e4'}, cron:{x:19,z:7,color:'#e3b271'},
  vm:{x:0,z:11,color:'#80b4c6'}, gateway:{x:0,z:23,color:'#a0dfff'},
};
export const slotsFor = id => id==='rag'?[[0,7.3],[-6.5,4],[6.5,4],[0,9]]:
  id==='gateway'?[[0,0],[-6,0],[6,0],[-12,0],[12,0]]:[[0,.25],[-3.3,.3],[3.3,.3],[0,3.6]];

export function createCampus(world,art,obstacles){
  const {box,mesh,mat,ring,textPlane,glow,cylinder}=art;
  box(world,210,.4,210,'#769660',0,-.55,10);
  // Low polygon trees and grass stay outside the paved forecourt.
  const grass=new T.InstancedMesh(new T.ConeGeometry(.14,.65,3),mat('#527c45'),1700);
  const matrix=new T.Matrix4();let seed=137;
  const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  for(let i=0;i<1700;i++){let x=(random()-.5)*165,z=(random()-.5)*170;
    if(Math.abs(x)<38&&z>-35&&z<58)x=(x<0?-1:1)*(39+random()*40);
    matrix.makeTranslation(x,-.05,z);grass.setMatrixAt(i,matrix);
  }world.add(grass);
  for(let i=0;i<38;i++){const x=(i%2?-1:1)*(43+random()*35),z=-34+random()*115;
    cylinder(world,.35,2.8,'#745d45',x,1,z);
    for(let k=0;k<3;k++)mesh(world,new T.ConeGeometry(2.6-k*.55,3.8,7),mat(k%2?'#486c49':'#608653'),x,3+k*1.5,z);
  }
  box(world,68,.24,64,'#80918a',0,-.2,-1);
  box(world,66,.12,23,'#b8bcb0',0,-.08,40);
  for(let x=-31;x<=31;x+=2)for(let z=-29;z<=29;z+=2)box(world,1.94,.1,1.94,'#c3cec3',x,0,z);
  // Brick promenade meets concrete paving at the entrance.
  for(let z=31;z<58;z+=1)for(let x=-5;x<=5;x++)box(world,.95,.06,.46,(x+z)%3?'#b78c73':'#c8a38a',x+(z%2)*.48,.07,z);
  for(const x of [-8,8]){
    box(world,1.5,.6,17,'#667c6b',x,.25,42);
    box(world,1.3,.2,16.8,'#729356',x,.65,42);
    for(const z of [33,43,51]){cylinder(world,.1,2.2,'#344d4c',x,1.1,z);box(world,.65,.15,.65,glow('#fff4c4'),x,2.25,z);}
  }
  const shell=new T.Group();world.add(shell);
  const facade=new T.MeshStandardMaterial({color:'#e5e7dc',roughness:.65,transparent:true});
  const windows=new T.MeshStandardMaterial({color:'#55878a',metalness:.45,roughness:.25,transparent:true});
  const shellMaterials=[facade,windows];
  box(shell,64,34,60,facade,0,24,-1);
  // Repetitive recessed window grid, inspired by the reference office building.
  const panes=new T.InstancedMesh(new T.BoxGeometry(1.8,2.1,.08),windows,22*11*4);
  let index=0;const dummy=new T.Object3D();
  for(let side=0;side<4;side++)for(let col=0;col<22;col++)for(let row=0;row<11;row++){
    const p=-29.4+col*2.8,y=9+row*2.8;
    dummy.position.set(side<2?p:(side===2?-32.05:32.05),y,side<2?(side===0?29.05:-31.05):p-1);
    dummy.rotation.y=side<2?0:Math.PI/2;dummy.updateMatrix();panes.setMatrixAt(index++,dummy.matrix);
  }shell.add(panes);
  for(let x=-29;x<=29;x+=2.8)if(Math.abs(x)>5)box(shell,1.8,3.4,.1,windows,x,2.5,29.27);
  for(const x of [-18,18])box(shell,28,7,.45,facade,x,3.5,29);
  for(const x of [-32,32])box(shell,.45,7,60,facade,x,3.5,-1);
  box(shell,64,7,.4,facade,0,3.5,-31);
  const title=textPlane(shell,'Sato Agents Lab',24,2.5,13,40.2,29.12,{color:'#334c4c',background:'#e5e7dc',size:77});
  title.material.transparent=true;shellMaterials.push(title.material);
  box(shell,9,.3,5,facade,0,4,30);
  for(const x of [-4.1,4.1])box(world,.22,4,.25,'#405f5f',x,2,29);
  textPlane(shell,'BEM-VINDO / RECEPÇÃO',7,.6,0,3.4,29.25,{color:'#e2ffff',background:'#183c43',size:60});
  const doors=[];
  for(const side of [-1,1]){const door=box(world,3.6,3,.12,new T.MeshStandardMaterial({color:'#a8e6e1',transparent:true,opacity:.38,roughness:.2}),side*1.85,1.5,29);door.userData.dynamic=true;doors.push({door,side});}
  // Physical perimeter, with one eight-unit entrance. Interior stays a cutaway.
  obstacles.push({x:-18,z:29,w:28,d:.6},{x:18,z:29,w:28,d:.6},{x:-32,z:-1,w:.6,d:60},{x:32,z:-1,w:.6,d:60},{x:0,z:-31,w:64,d:.6});
  box(world,64,1.2,.35,'#94aaa0',0,.6,-30.8);
  shell.traverse(o=>o.userData.dynamic=true);
  let opacity=1;
  return {tick(dt,position){
    const interior=1-T.MathUtils.smoothstep(position.z,25,33);
    opacity=T.MathUtils.damp(opacity,1-interior,5,dt);
    shell.visible=opacity>.015;
    shellMaterials.forEach(m=>{m.opacity=opacity;m.depthWrite=opacity>.98;});
    shell.traverse(o=>{if(o.isMesh)o.castShadow=opacity>.9;});
    doors.forEach(({door,side})=>door.position.x=T.MathUtils.damp(door.position.x,side*(Math.hypot(position.x,position.z-29)<8?5.5:1.85),6,dt));
    return interior;
  }};
}

export function createParcelFlow(world,art,zones,factory,obstacles){
  const {box,rod,mat,textPlane}=art,packets=[],couriers=[];
  // Belts sit beside the visitor's central aisle, moving behind reception to VM.
  const paths=[[[ -6,1,21],[-6,1,16],[ -3,1,16],[-3,1,11],[-3,1,2],[0,.65,2]],[[6,1,21],[6,1,16],[3,1,16],[3,1,11],[3,1,2],[0,.65,2]]].map(p=>p.map(v=>new T.Vector3(...v)));
  for(const points of paths){
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=a.distanceTo(b),belt=box(world,1.1,.2,length,'#293d43');
      belt.position.copy(a).add(b).multiplyScalar(.5);obstacles.push({x:belt.position.x,z:belt.position.z,w:Math.abs(b.x-a.x)+1.1,d:Math.abs(b.z-a.z)+1.1});
      belt.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),b.clone().sub(a).normalize());
      for(let d=0;d<length;d+=.4){const p=a.clone().lerp(b,d/length);rod(world,[p.x-.48,p.y+.13,p.z],[p.x+.48,p.y+.13,p.z],.04,mat('#718d91'));}
    }
    const curve=new T.CurvePath();for(let i=1;i<points.length;i++)curve.add(new T.LineCurve3(points[i-1],points[i]));
    for(let i=0;i<6;i++){const p=box(world,.48,.44,.48,i%2?'#e0b570':'#8bcbd0');p.userData.dynamic=true;packets.push({p,curve,phase:i/6});}
  }
  for(const x of [-3,3]){box(world,1.7,.25,.7,'#729fa6',x,2.3,11);for(const dx of [-.75,.75])box(world,.12,1.4,.6,'#315660',x+dx,1.6,11);textPlane(world,'VM / IN',1.3,.3,x,2.31,11.37,{color:'#b6ffff',background:'#14343e',size:80});}
  box(world,3,.22,2,'#284b50',0,.35,2);
  textPlane(world,'TRIAGEM / NÚCLEO',3.2,.5,0,1.35,.9,{color:'#fff5d7',background:'#19353b',size:80});
  for(const id of ['models','mcp','rag','memory','cron']){
    const z=zones[id],end=new T.Vector3(z.x+(z.x<0?5:id==='rag'?-7.5:-5),.38,z.z+4);
    box(world,1.6,.2,1.6,'#254b50',end.x,.26,end.z);
    const rig=factory.robot();rig.root.scale.setScalar(.65);rig.root.traverse(o=>o.userData.dynamic=true);world.add(rig.root);
    const parcel=box(rig.root,.6,.5,.6,'#e0b570',0,1.25,.55);parcel.userData.dynamic=true;
    const route=findPath({x:0,z:2},end,obstacles,[]),curve=new T.CurvePath();let previous=new T.Vector3(0,.38,2);for(const point of route){const next=new T.Vector3(point.x,.38,point.z);curve.add(new T.LineCurve3(previous,next));previous=next;}
    couriers.push({rig,parcel,end,curve,phase:couriers.length/5});
  }
  textPlane(world,'FLUXO ILUSTRATIVO',3,.4,0,.6,3.5,{color:'#b4d8d8',background:'#254b50',size:70});
  return {tick(t){
    for(const {p,curve,phase} of packets){const u=(t*.065+phase)%1;p.position.copy(curve.getPoint(u));p.position.y+=.4;p.rotation.y=t*.15;}
    for(const {rig,parcel,end,curve,phase} of couriers){const p=(t*.022+phase)%1,out=p<.5,u=out?p*2:(1-p)*2;
      if(curve.curves.length){rig.root.position.copy(curve.getPoint(u));const direction=curve.getTangent(u);rig.root.rotation.y=Math.atan2(direction.x,direction.z)+(out?0:Math.PI);}parcel.visible=out;
    }
  },couriers};
}
