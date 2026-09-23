import * as T from '../vendor/three.module.min.js';
import {batchRobot} from './lab-batch.js';

// Rigid meshes attached to a real Bone hierarchy. No downloaded animation clips
// or per-frame geometry allocations: poses blend at the joints, in radians.
export function createRigFactory(art) {
  const {box, sphere, cylinder, ring, rod, mesh, mat, glow, geo} = art;
  const opticRim=new T.MeshBasicMaterial({color:'#65d5ff',toneMapped:false});
  function bone(parent, name, x, y, z) { const b = new T.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); return b; }
  function base(type) {
    const root = new T.Group();
    const hips = bone(root, 'hips', 0, type === 'avatar' ? .95 : .54, 0);
    const spine = bone(hips, 'spine', 0, type === 'avatar' ? .06 : .66, 0);
    const head = bone(spine, 'head', 0, type === 'avatar' ? .84 : 0, 0);
    return {type, root, hips, spine, head, arms: [], legs: [], eyes: [], move: 0, attention: 0, work: .6, phase: 0, greeting: 0};
  }
  function robot() {
    const rig = base('robot');
    sphere(rig.spine, .54, '#e3e8df', 0, 0, 0, [1.08, .96, .98]);
    ring(rig.spine, .535, .043, '#61736c', 0, 0, 0, true);
    ring(rig.spine, .53, .028, '#81928a', 0, 0, 0);
    // Independent gimbal inside the shell keeps eye tracking separate from the torso.
    sphere(rig.head, .31, '#253d3c', 0, .015, .445, [1.2, 1, .5]);
    ring(rig.head, .18, .015, opticRim, 0, .015, .6);
    const pupilMaterial = new T.MeshBasicMaterial({color:'#d5f7ff',toneMapped:false});
    rig.pupil = mesh(rig.head,geo('optic-disc',()=>new T.CircleGeometry(.082,32)),pupilMaterial,0,.015,.611,false);
    const halo=geo('optic-halo-texture',()=>{
      const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d'),g=ctx.createRadialGradient(64,64,3,64,64,64);
      g.addColorStop(0,'rgba(180,244,255,1)');g.addColorStop(.22,'rgba(59,182,255,.85)');g.addColorStop(.55,'rgba(0,133,255,.23)');g.addColorStop(1,'rgba(0,120,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);return new T.CanvasTexture(c);
    });
    const glowMaterial=new T.MeshBasicMaterial({map:halo,transparent:true,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false});
    mesh(rig.head,geo('optic-halo-plane',()=>new T.PlaneGeometry(.65,.65)),glowMaterial,0,.015,.616,false);
    rig.opticMaterial=glowMaterial;
    for (const side of [-1, 1]) {
      box(rig.spine, .13, .47, .3, '#c7d3c7', side * .53, .045, -.045).rotation.z = side * -.2;
      const arm = bone(rig.spine, side < 0 ? 'shoulder_L' : 'shoulder_R', side * .59, -.025, 0);
      sphere(arm, .12, '#435e59');
      rod(arm, [0, 0, 0], [side * .05, -.33, 0], .054, mat('#586e68', .65));
      rod(arm, [side * .07, -.01, -.045], [side * .12, -.31, -.04], .019, mat('#c4d1c2', .65));
      const elbow = bone(arm, 'elbow', side * .05, -.33, 0);
      sphere(elbow, .075, '#405f57');
      cylinder(elbow, .065, .3, '#d5e1d0', 0, -.15, 0);
      for (const finger of [-1, 1]) rod(elbow, [0, -.3, 0], [finger * .065, -.39, .075], .022, mat('#4c665b'));
      rig.arms.push({upper: arm, lower: elbow, side});
      const leg = bone(rig.hips, side < 0 ? 'hip_L' : 'hip_R', side * .25, 0, 0);
      sphere(leg, .11, '#435d54');
      rod(leg, [0, 0, 0], [side * .04, -.22, 0], .074, mat('#e0e7da'));
      const knee = bone(leg, 'knee', side * .04, -.22, 0);
      sphere(knee, .068, '#4b655c');
      rod(knee, [0, 0, 0], [0, -.21, 0], .048, mat('#798b7e', .7));
      const ankle = bone(knee, 'ankle', 0, -.21, 0);
      box(ankle, .27, .13, .4, '#526e61', 0, -.015, .07);
      box(ankle, .26, .05, .27, '#d6e0cf', 0, .065, .07);
      rig.legs.push({upper: leg, lower: knee, ankle, side});
    }
    rod(rig.spine, [.15, .43, -.12], [.22, .75, -.12], .022, mat('#5a7264'));
    rig.indicator = sphere(rig.spine, .06, glow('#779d8a'), .22, .75, -.12);
    rig.root.rotation.y = Math.PI;
    batchRobot(rig);
    return rig;
  }
  return {robot};
}

const damp = (a, b, dt, rate = 6) => a + (b - a) * (1 - Math.exp(-rate * dt));
export function dampAngle(a, b, dt, rate = 7) { return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * (1 - Math.exp(-rate * dt)); }
export function poseRig(rig, t, dt, {speed = 0, attention = 0, work = 0, talk = false, lookYaw = 0, reduced = false} = {}) {
  rig.move = damp(rig.move, speed, dt, 10);
  rig.attention = damp(rig.attention, attention, dt, 5);
  rig.work = damp(rig.work, work * (1 - attention), dt, 5);
  const phase = t + rig.phase, stride = Math.sin(t * 9), move = reduced ? 0 : rig.move;
  const idle = reduced ? 0 : 1 - move;
  rig.hips.position.y = (rig.type === 'avatar' ? .95 : .54) + Math.abs(Math.sin(t * 9)) * .025 * move;
  rig.hips.rotation.z = Math.sin(t * 4.5) * .035 * move + Math.sin(phase * .73) * .012 * idle;
  rig.spine.rotation.x = -.035 * move + Math.sin(phase * 1.8) * .012 * idle + rig.work * .09;
  rig.spine.rotation.y = stride * .065 * move + Math.sin(phase * .55) * .025 * idle;
  rig.spine.rotation.z = -rig.hips.rotation.z * .65;
  rig.head.rotation.y = damp(rig.head.rotation.y, lookYaw * rig.attention + Math.sin(phase * .63) * .055 * idle * (1 - rig.attention), dt);
  rig.head.rotation.x = Math.sin(phase * (talk ? 4.8 : .9)) * (talk ? .055 : .016) * idle;
  for (let i = 0; i < rig.arms.length; i++) {
    const {upper, lower, side} = rig.arms[i];
    const wave = !reduced && t < rig.greeting && i === 1 ? Math.sin(Math.min(1, rig.greeting - t) * Math.PI / 2) : 0;
    upper.rotation.x = -stride * side * .5 * move - rig.work * .98;
    upper.rotation.z = side * (.06 + Math.sin(phase * 1.2 + i) * .018 * idle) - wave * 1.7;
    lower.rotation.x = -.15 - Math.max(0, -stride * side) * .22 * move - rig.work * (.65 + Math.sin(phase * 4.5 + i * 1.8) * .12);
    lower.rotation.z = wave * (Math.sin(t * 9) * .28 - .35);
  }
  for (const {upper, lower, ankle, side} of rig.legs) {
    upper.rotation.x = stride * side * .5 * move;
    lower.rotation.x = Math.max(0, -stride * side) * .65 * move;
    ankle.rotation.x = -lower.rotation.x * .45;
  }
  // Short, sparse blinks are independent of walking, with different phase per actor.
  const blinkPhase = (phase + 50) % 5.3;
  for (const eye of rig.eyes) eye.scale.y = reduced ? 1 : blinkPhase < .13 ? Math.max(.08, Math.abs(blinkPhase - .065) / .065) : 1;
}
