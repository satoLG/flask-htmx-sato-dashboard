import * as T from '../vendor/three.module.min.js';

// Collapse the stationary chamber by material. Bones, screens with moving parts,
// status rings and interactive signs are kept separate by their caller.
export function batchStatic(scene) {
  scene.updateMatrixWorld(true);
  const buckets = new Map();
  scene.traverse(object => {
    if (!object.isMesh || object.isInstancedMesh || object.userData.dynamic || object.userData.station || Array.isArray(object.material) || object.material.transparent) return;
    const key = `${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
    if (!buckets.has(key)) buckets.set(key,[]);
    buckets.get(key).push(object);
  });
  for (const objects of buckets.values()) {
    if (objects.length < 2) continue;
    const parts = objects.map(m => { const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); return g.applyMatrix4(m.matrixWorld); });
    const geometry = new T.BufferGeometry();
    for (const attribute of ['position','normal','uv','color']) {
      if (!parts.every(g => g.hasAttribute(attribute))) continue;
      const length = parts.reduce((n,g) => n + g.getAttribute(attribute).array.length,0);
      const merged = new Float32Array(length); let offset = 0;
      for (const g of parts) { const source = g.getAttribute(attribute).array; merged.set(source,offset); offset += source.length; }
      geometry.setAttribute(attribute,new T.BufferAttribute(merged,parts[0].getAttribute(attribute).itemSize));
    }
    geometry.computeBoundingSphere();
    const batch = new T.Mesh(geometry,objects[0].material); batch.castShadow = objects[0].castShadow; batch.receiveShadow = objects[0].receiveShadow; scene.add(batch);
    for (const object of objects) object.removeFromParent();
    for (const part of parts) part.dispose();
  }
}

const shellMaterial = new T.MeshStandardMaterial({vertexColors:true,roughness:.7,metalness:.18});
// Merge only rigid pieces that share a joint. The bone hierarchy remains intact.
export function batchRobot(rig) {
  const parents=[];rig.root.traverse(o=>{if(o.children.length)parents.push(o);});
  const owned=[];
  for(const parent of parents){
    const pieces=parent.children.filter(o=>o.isMesh&&!o.userData.dynamic&&o.material.isMeshStandardMaterial&&o.material.emissive.getHex()===0);
    if(pieces.length<2)continue;
    const temporary=new T.Group();
    for(const piece of pieces){
      const geometry=piece.geometry.index?piece.geometry.toNonIndexed():piece.geometry.clone();
      const colors=new Float32Array(geometry.getAttribute('position').count*3),color=piece.material.color;
      for(let i=0;i<colors.length;i+=3){colors[i]=color.r;colors[i+1]=color.g;colors[i+2]=color.b;}
      geometry.setAttribute('color',new T.BufferAttribute(colors,3));
      piece.removeFromParent();piece.geometry=geometry;piece.material=shellMaterial;temporary.add(piece);
    }
    batchStatic(temporary);
    for(const child of [...temporary.children]){parent.add(child);owned.push(child.geometry);}
    for(const piece of pieces)piece.geometry.dispose();
  }
  rig.ownedGeometry=owned;
}
