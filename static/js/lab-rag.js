import * as T from '../vendor/three.module.min.js';

const COLORS={root:'#66dfff',repo:'#7ce7bc',category:'#ffc575',doc:'#bbdaf0',query:'#c0a1ff'};
export function createRagDome(world,art,zone){
  const {mesh,ring,glow,textPlane}=art,root=new T.Group();root.position.set(zone.x,.55,zone.z);root.scale.setScalar(1.8);world.add(root);
  const glass=new T.MeshBasicMaterial({color:'#66dcff',transparent:true,opacity:.085,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending});
  mesh(root,new T.SphereGeometry(2.95,32,16,0,Math.PI*2,0,Math.PI/2),glass,0,0,0,false);
  ring(root,2.95,.055,glow('#70c8db'),0,0,0,true);
  for(const r of [2.6,2.8,3.1])ring(root,r,.012,glow('#69edff'),0,.035,0,true);
  const scan=ring(root,2.8,.014,new T.MeshBasicMaterial({color:'#9affef',transparent:true,opacity:.5,blending:T.AdditiveBlending,depthWrite:false}),0,.5,0,true);scan.userData.dynamic=true;
  const cage=new T.Group();root.add(cage);
  for(let a=0;a<Math.PI;a+=Math.PI/4){const pts=[];for(let i=0;i<=32;i++){const p=i/32*Math.PI;pts.push(new T.Vector3(Math.cos(a)*Math.cos(p)*2.95,Math.sin(p)*2.95,Math.sin(a)*Math.cos(p)*2.95));}cage.add(new T.Line(new T.BufferGeometry().setFromPoints(pts),new T.LineBasicMaterial({color:'#92c8cc',transparent:true,opacity:.36})));}
  const network=new T.Group();root.add(network);network.userData.dynamic=true;
  const nodeObjects=new Map(),nodes=new Map(),edges=new Map(),positions=new Map(),pulses=[];
  const sphere=new T.SphereGeometry(1,12,8),materials=new Map(Object.entries(COLORS).map(([kind,color])=>[kind,new T.MeshBasicMaterial({color,toneMapped:false})]));
  const edgeMaterial=new T.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.8,blending:T.AdditiveBlending,depthWrite:false});
  const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d'),gradient=ctx.createRadialGradient(32,32,0,32,32,32);gradient.addColorStop(0,'#ffffff');gradient.addColorStop(.18,'#80eaffbb');gradient.addColorStop(1,'#20bcff00');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
  const haloMaterial=new T.SpriteMaterial({map:new T.CanvasTexture(c),transparent:true,blending:T.AdditiveBlending,depthWrite:false});
  let lines=null,selected=null,isSearch=false,busy=false,label=null;
  function disposeNetwork(){
    for(const object of nodeObjects.values())network.remove(object);nodeObjects.clear();
    for(const p of pulses)network.remove(p.object);pulses.length=0;
    if(lines){network.remove(lines);lines.geometry.dispose();lines=null;}
    if(label){network.remove(label);label.material.map.dispose();label.material.dispose();label.geometry.dispose();label=null;}
  }
  function rebuild(){
    disposeNetwork();positions.clear();const list=[...nodes.values()].slice(0,180);
    const roots=list.filter(n=>n.kind==='root'||n.kind==='query'),others=list.filter(n=>!roots.includes(n));
    for(const n of roots)positions.set(n.id,new T.Vector3(0,1.32,0));
    // Deterministic positions preserve a readable spatial map as branches expand.
    const major=others.filter(n=>n.kind==='repo'),minor=others.filter(n=>n.kind!=='repo');
    major.forEach((n,i)=>{const angle=i/Math.max(1,major.length)*Math.PI*2+.3;positions.set(n.id,new T.Vector3(Math.sin(angle)*1.38,1.55+Math.cos(angle*2)*.34,Math.cos(angle)*1.38));});
    minor.forEach((n,i)=>{const a=i*2.3999632,r=1.7+(i%3)*.22;positions.set(n.id,new T.Vector3(Math.sin(a)*r,.38+(i%5)*.35,Math.cos(a)*r));});
    for(const n of list){const object=new T.Mesh(sphere,materials.get(n.kind)||materials.get('doc'));const r=n.kind==='root'||n.kind==='query'?.22:n.kind==='repo'?.15:n.kind==='category'?.11:.095+(n.score||0)*.055;object.userData.radius=r;object.scale.setScalar(r);object.position.copy(positions.get(n.id));object.userData.ragNode=n.id;object.userData.dynamic=true;const halo=new T.Sprite(haloMaterial);halo.scale.setScalar(5);object.add(halo);network.add(object);nodeObjects.set(n.id,object);}
    const vertices=[],colors=[];
    for(const e of edges.values()){
      const a=positions.get(e.source),b=positions.get(e.target);if(!a||!b)continue;vertices.push(...a.toArray(),...b.toArray());
      const color=new T.Color(isSearch?'#b99aff':'#62b6bf');colors.push(...color.toArray(),...color.toArray());
      if(pulses.length<60){const object=new T.Mesh(sphere,materials.get(isSearch?'query':'root'));object.scale.setScalar(.035);object.userData.dynamic=true;network.add(object);pulses.push({object,a,b,offset:pulses.length*.137,score:e.score??.5});}
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));lines=new T.LineSegments(g,edgeMaterial);network.add(lines);
    if(selected&&nodes.has(selected))select(selected);
  }
  function setGraph(payload,{replace=false,search=false}={}){
    if(replace){nodes.clear();edges.clear();selected=null;}isSearch=search;
    for(const n of payload.nodes||[])if(nodes.size<180||nodes.has(n.id))nodes.set(n.id,n);
    for(const e of payload.edges||[])if(nodes.has(e.source)&&nodes.has(e.target))edges.set(e.id||`${e.source}:${e.target}`,e);
    rebuild();return [...nodes.values()];
  }
  function select(id){
    for(const object of nodeObjects.values())object.scale.setScalar(object.userData.radius);
    selected=id;if(label){network.remove(label);label.material.map.dispose();label.material.dispose();label.geometry.dispose();}
    const n=nodes.get(id),p=positions.get(id);if(!n||!p)return;
    label=textPlane(network,String(n.label),2.8,.42,p.x,p.y+.4,p.z,{color:'#effaff',background:'#102b42',size:100});label.userData.dynamic=true;label.renderOrder=3;
  }
  function tick(t,camera){
    scan.position.y=.15+(t*.25%2.65);scan.scale.setScalar(Math.sqrt(Math.max(.01,1-(scan.position.y/2.95)**2)));
    for(const p of pulses){const fraction=(t*(isSearch?.35:.12)+p.offset)%1;p.object.position.lerpVectors(p.a,p.b,fraction);p.object.visible=!busy;}
    if(label)label.quaternion.copy(camera.quaternion);
    for(const[id,object]of nodeObjects){object.material=materials.get(nodes.get(id).kind)||materials.get('doc');if(id===selected)object.scale.setScalar(object.userData.radius*(1.5+Math.sin(t*3)*.12));}
  }
  // Preserve the network and its last sample during transient fetch failures.
  return {root,network,setGraph,select,tick,pick(ray){return ray.intersectObjects([...nodeObjects.values()],false)[0]?.object.userData.ragNode;},getNode:id=>nodes.get(id),setBusy(value){busy=value;},get count(){return nodes.size;}};
}
