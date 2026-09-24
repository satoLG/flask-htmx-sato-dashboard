import * as T from 'three';

// Mirror the anatomical right side in bind space, including skin influences.
// The face/hair remain original. This fixes proportions, not just joint angles.
export function fitSato(scene,skeleton){
  const bones=skeleton.bones,names=bones.map(b=>b.name);
  const swap=names.map((name,i)=>name.startsWith('R_')?names.indexOf(name.replace('R_','L_')):i);
  const worlds=new Map(bones.map(b=>[b.name,b.matrixWorld.clone()]));
  const reflect=new T.Matrix4().makeScale(-1,1,1);
  const ordered=[];scene.traverse(b=>{if(b.isBone&&b.name.startsWith('L_'))ordered.push(b);});
  for(const b of ordered){
    const world=reflect.clone().multiply(worlds.get(b.name.replace('L_','R_'))).multiply(reflect);
    const local=b.parent.matrixWorld.clone().invert().multiply(world);
    local.decompose(b.position,b.quaternion,b.scale);scene.updateMatrixWorld(true);
  }
  skeleton.calculateInverses();
  const mix=(a,b,t)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k].map((v,i)=>v+(b[k][i]-v)*t)]));
  function clip(poly,axis,limit,keepLower){
    const out=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=a.p[axis]-limit,db=b.p[axis]-limit;
      if(keepLower?da<=0:da>=0)out.push(a);
      if(da*db<0)out.push(mix(a,b,da/(da-db)));
    }
    return out;
  }
  scene.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const g=mesh.geometry,a=g.attributes,out={position:[],normal:[],uv:[],skinIndex:[],skinWeight:[]};
    function emit(poly,mirror=false){
      for(let k=1;k<poly.length-1;k++)for(const v of mirror?[poly[0],poly[k+1],poly[k]]:[poly[0],poly[k],poly[k+1]]){
        out.position.push(mirror?-v.p[0]:v.p[0],v.p[1],v.p[2]);out.normal.push(mirror?-v.n[0]:v.n[0],v.n[1],v.n[2]);out.uv.push(...v.uv);
        const weights=v.w.map((w,i)=>[mirror?swap[i]:i,w]).filter(([,w])=>w>0).sort((x,y)=>y[1]-x[1]).slice(0,4),sum=weights.reduce((s,[,w])=>s+w,0);
        while(weights.length<4)weights.push([0,0]);out.skinIndex.push(...weights.map(([i])=>i));out.skinWeight.push(...weights.map(([,w])=>w/sum));
      }
    }
    for(let i=0;i<g.index.count;i+=3){
      const tri=[0,1,2].map(c=>{const k=g.index.getX(i+c),w=new Array(bones.length).fill(0);for(let j=0;j<4;j++)w[a.skinIndex.getComponent(k,j)]+=a.skinWeight.getComponent(k,j);return {p:[a.position.getX(k),a.position.getY(k),a.position.getZ(k)],n:[a.normal.getX(k),a.normal.getY(k),a.normal.getZ(k)],uv:[a.uv.getX(k),a.uv.getY(k)],w};});
      emit(clip(tri,1,.735,false));
      const right=clip(clip(tri,1,.735,true),0,0,true);emit(right);emit(right,true);
    }
    const repaired=new T.BufferGeometry();
    for(const [name,values]of Object.entries(out))repaired.setAttribute(name,name==='skinIndex'?new T.Uint16BufferAttribute(values,4):new T.Float32BufferAttribute(values,name==='uv'?2:name==='skinWeight'?4:3));
    repaired.setIndex(Array.from({length:out.position.length/3},(_,i)=>i));mesh.geometry=repaired;
    if(mesh.name==='tripo_part_19'){
      // Bring the front rims back 9 mm in model units; taper the temple arms
      // toward the unchanged ear attachment instead of translating the frame.
      const p=repaired.attributes.position;
      for(let i=0;i<p.count;i++)p.setZ(i,p.getZ(i)-.009*T.MathUtils.smoothstep(p.getZ(i),.02,.115));
      repaired.computeVertexNormals();
    }
  });
}
