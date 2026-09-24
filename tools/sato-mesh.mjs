import * as T from 'three';

// UV/material islands may duplicate a surface vertex. Position and skin weights
// must agree across those copies or the animated surface tears at every seam.
export function repairSkin(scene){
  const meshes=[];scene.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});
  const bones=meshes[0].skeleton.bones,names=bones.map(n=>n.name);
  const index=name=>names.indexOf(name);
  const canonical=[];
  const cells=new Map(),epsilon=.0001;
  function shared(point){
    const cell=point.map(v=>Math.floor(v/epsilon));
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
      const near=cells.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))||[];
      for(const id of near)if(point.every((v,i)=>Math.abs(v-canonical[id].p[i])<epsilon))return canonical[id];
    }
    const vertex={p:point,weights:new Map()},id=canonical.push(vertex)-1,key=cell.join(',');
    if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);return vertex;
  }
  const collapse=name=>name.replace(/_(Thigh|Calf|Upperarm|Forearm)Twist\d+$/,'_$1');
  for(const mesh of meshes){
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
    for(let i=0;i<position.count;i++){
      const v=shared([position.getX(i),position.getY(i),position.getZ(i)]);
      for(let c=0;c<4;c++){
        const name=collapse(names[skinIndex.getComponent(i,c)]),weight=skinWeight.getComponent(i,c);
        v.weights.set(name,(v.weights.get(name)||0)+weight);
      }
    }
  }
  function skin(p){
    let weights;
    if(p[1]<.445){
      const side=p[0]>0?'L':'R',knee=.2288;
      const foot=1-T.MathUtils.smoothstep(p[1],.075,.115);
      const thigh=T.MathUtils.smoothstep(p[1],knee-.036,knee+.036);
      const pelvis=T.MathUtils.smoothstep(p[1],.355,.435);
      weights=[[side+'_Foot',foot],[side+'_Calf',(1-foot)*(1-thigh)*(1-pelvis)],
        [side+'_Thigh',(1-foot)*thigh*(1-pelvis)],['Pelvis',(1-foot)*pelvis]];
    }else if(p[1]>.735){
      weights=[['Head',1]];
    }else weights=[...shared(p).weights];
    weights=weights.filter(([,w])=>w>0).sort((a,b)=>b[1]-a[1]).slice(0,4);
    const total=weights.reduce((a,[,w])=>a+w,0);
    const joints=[0,0,0,0],values=[0,0,0,0];
    weights.forEach(([name,w],i)=>{joints[i]=index(name);values[i]=w/total;});
    return {joints,values};
  }
  const mix=(a,b,t)=>({p:a.p.map((v,i)=>v+(b.p[i]-v)*t),n:a.n.map((v,i)=>v+(b.n[i]-v)*t),uv:a.uv.map((v,i)=>v+(b.uv[i]-v)*t)});
  function split(poly,y){
    const below=[],above=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=a.p[1]-y,db=b.p[1]-y;
      if(da<=0)below.push(a);if(da>=0)above.push(a);
      if(da*db<0){const v=mix(a,b,da/(da-db));below.push(v);above.push(v);}
    }
    return [below,above].filter(p=>p.length>=3);
  }
  let vertices=0;
  for(const mesh of meshes){
    const geometry=mesh.geometry,{position,normal,uv}=geometry.attributes;
    const out={position:[],normal:[],uv:[],skinIndex:[],skinWeight:[]};
    for(let i=0;i<geometry.index.count;i+=3){
      let polygons=[[0,1,2].map(c=>{const k=geometry.index.getX(i+c);return {p:shared([position.getX(k),position.getY(k),position.getZ(k)]).p,n:[normal.getX(k),normal.getY(k),normal.getZ(k)],uv:[uv.getX(k),uv.getY(k)]};})];
      // The original trousers have long triangles spanning the knee. Add support
      // rings without changing their silhouette, UVs or the low-poly artwork.
      for(const height of [.075,.095,.115,.19,.21,.23,.25,.27,.355,.395,.435])polygons=polygons.flatMap(p=>split(p,height));
      for(const polygon of polygons)for(let k=1;k<polygon.length-1;k++)for(const v of [polygon[0],polygon[k],polygon[k+1]]){
        const weights=skin(v.p);out.position.push(...v.p);out.normal.push(...new T.Vector3(...v.n).normalize().toArray());out.uv.push(...v.uv);out.skinIndex.push(...weights.joints);out.skinWeight.push(...weights.values);
      }
    }
    const repaired=new T.BufferGeometry();
    for(const [name,values]of Object.entries(out))repaired.setAttribute(name,name==='skinIndex'?new T.Uint16BufferAttribute(values,4):new T.Float32BufferAttribute(values,name==='uv'?2:name==='skinWeight'?4:3));
    repaired.setIndex(Array.from({length:out.position.length/3},(_,i)=>i));
    mesh.geometry=repaired;vertices+=repaired.attributes.position.count;
  }
  return {meshes,vertices,sourceSurfaceVertices:canonical.length};
}
