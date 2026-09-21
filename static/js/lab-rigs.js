import * as T from '../vendor/three.module.min.js';
import {batchRobot} from './lab-batch.js';

// Rigid meshes attached to a real Bone hierarchy. No downloaded animation clips
// or per-frame geometry allocations: poses blend at the joints, in radians.
export function createRigFactory(art) {
  const {box, sphere, cylinder, ring, rod, mesh, mat, glow, geo} = art;
  const flat = color => {
    const material = mat(color).clone(); material.flatShading = true; material.roughness = .9; return material;
  };
  const skin = flat('#e4ae79'), hair = flat('#453529'), shirt = flat('#26343d'), jeans = flat('#4d7189');
  const ico = geo('faceted', () => new T.IcosahedronGeometry(1, 1));
  const puff = (parent, material, x, y, z, sx, sy, sz) => { const m = mesh(parent, ico, material, x, y, z); m.scale.set(sx, sy, sz); return m; };
  function bone(parent, name, x, y, z) { const b = new T.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); return b; }
  function base(type) {
    const root = new T.Group();
    const hips = bone(root, 'hips', 0, type === 'avatar' ? .95 : .54, 0);
    const spine = bone(hips, 'spine', 0, type === 'avatar' ? .06 : .66, 0);
    const head = bone(spine, 'head', 0, type === 'avatar' ? .84 : 0, 0);
    return {type, root, hips, spine, head, arms: [], legs: [], eyes: [], move: 0, attention: 0, work: .6, phase: 0, greeting: 0};
  }
  function avatar() {
    const rig = base('avatar');
    const torso = cylinder(rig.spine, .36, .67, shirt, 0, .33, 0, .39); torso.scale.z = .68;
    // Neck and V-neck detail, dark casual T-shirt as in the reference.
    cylinder(rig.spine, .14, .18, skin, 0, .77, 0);
    rod(rig.spine, [-.18, .67, .245], [0, .56, .265], .025, mat('#18262e'));
    rod(rig.spine, [0, .56, .265], [.18, .67, .245], .025, mat('#18262e'));
    puff(rig.head, skin, 0, .22, 0, .48, .51, .42);
    puff(rig.head, hair, 0, .53, -.075, .5, .31, .44);
    // Individually angled, low-poly hair clumps instead of a smooth helmet.
    for (let i = 0; i < 7; i++) {
      const tuft = puff(rig.head, hair, -.37 + i * .12, .61 + Math.sin(i * 2.1) * .05, .17 + Math.sin(i) * .06, .18, .16, .25);
      tuft.rotation.set(.25, i * .31, -.35 + i * .1);
    }
    for (const side of [-1, 1]) {
      puff(rig.head, skin, side * .47, .19, 0, .1, .17, .1);
      puff(rig.head, hair, side * .39, .03, .02, .09, .23, .31);
      puff(rig.head, hair, side * .22, -.1, .24, .24, .19, .16);
      const eye = new T.Group(); eye.position.set(side * .18, .29, .39); rig.head.add(eye); rig.eyes.push(eye);
      sphere(eye, .082, '#faf1d5', 0, 0, 0, [1, 1.2, .35]);
      sphere(eye, .057, '#332a22', 0, 0, .025, [.85, 1.18, .5]);
      sphere(eye, .018, '#fff9dc', -.018, .03, .047);
      box(rig.head, .23, .034, .038, hair, side * .18, .445, .366).rotation.z = side * -.08;
      // Blue-black rectangular eyeglass frames, open lenses.
      for (const y of [.165, .415]) box(rig.head, .32, .038, .042, '#23424d', side * .2, y, .437);
      for (const x of [side * .2 - .16, side * .2 + .16]) box(rig.head, .035, .25, .04, '#23424d', x, .29, .437);
      rod(rig.head, [side * .36, .4, .43], [side * .46, .37, .05], .02, mat('#23424d'));
      const arm = bone(rig.spine, side < 0 ? 'shoulder_L' : 'shoulder_R', side * .38, .59, 0);
      cylinder(arm, .13, .24, shirt, 0, -.08, 0);
      puff(arm, skin, 0, -.23, 0, .105, .18, .1);
      const elbow = bone(arm, 'elbow', 0, -.32, 0);
      puff(elbow, skin, 0, -.15, .01, .087, .19, .087);
      puff(elbow, skin, 0, -.33, .02, .11, .12, .09);
      arm.rotation.z = side * .08; rig.arms.push({upper: arm, lower: elbow, side});
      const leg = bone(rig.hips, side < 0 ? 'hip_L' : 'hip_R', side * .19, -.01, 0);
      cylinder(leg, .14, .43, jeans, 0, -.21, 0, .17);
      const knee = bone(leg, 'knee', 0, -.43, 0);
      cylinder(knee, .14, .39, jeans, 0, -.19, 0, .135);
      const ankle = bone(knee, 'ankle', 0, -.38, 0);
      puff(ankle, mat('#6b4a2e'), 0, -.025, .08, .16, .115, .26);
      box(ankle, .29, .045, .43, '#403b31', 0, -.095, .09);
      for (const z of [0, .07, .14]) box(ankle, .15, .018, .025, '#ae936b', 0, .075, z);
      rig.legs.push({upper: leg, lower: knee, ankle, side});
    }
    box(rig.head, .095, .035, .04, '#23424d', 0, .35, .45);
    puff(rig.head, skin, 0, .15, .42, .067, .105, .095);
    puff(rig.head, hair, 0, -.19, .23, .18, .15, .19);
    for (const side of [-1, 1]) puff(rig.head, hair, side * .1, .015, .389, .13, .045, .05);
    const smile = mesh(rig.head, new T.TorusGeometry(.13, .037, 5, 16, Math.PI), mat('#ffefd0'), 0, -.005, .406); smile.rotation.z = Math.PI;
    rig.root.rotation.y = .65;
    return rig;
  }
  function robot() {
    const rig = base('robot');
    sphere(rig.spine, .54, '#e3e8df', 0, 0, 0, [1.08, .96, .98]);
    ring(rig.spine, .535, .043, '#61736c', 0, 0, 0, true);
    ring(rig.spine, .53, .028, '#81928a', 0, 0, 0);
    // Independent gimbal inside the shell keeps eye tracking separate from the torso.
    sphere(rig.head, .31, '#253d3c', 0, .015, .445, [1.2, 1, .5]);
    ring(rig.head, .195, .038, glow('#238deb'), 0, .015, .6);
    const pupilMaterial = new T.MeshStandardMaterial({color: '#208eff', emissive: '#167bff', emissiveIntensity: 3.4, roughness: .22});
    rig.pupil = sphere(rig.head, .113, pupilMaterial, 0, .015, .621, [1, 1, .35]);
    sphere(rig.head, .036, glow('#96dbff'), -.035, .055, .661);
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
  return {avatar, robot};
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
