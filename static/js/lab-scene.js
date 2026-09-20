import * as T from '../vendor/three.module.min.js';

// Procedural models: no game assets, remote fonts, textures, or model downloads.
const ZONES = {
  hermes: {x: 0, z: 0, color: '#56d5c3'}, models: {x: -10, z: -6, color: '#e9ab61'},
  mcp: {x: 0, z: -7.5, color: '#6ccce0'}, rag: {x: 10, z: -6, color: '#83cbb3'},
  memory: {x: -11, z: 4.5, color: '#bab5e4'}, cron: {x: 10, z: 4.5, color: '#e3b271'},
  vm: {x: 0, z: 8, color: '#80b4c6'},
};
const LIVE = new Set(['recent', 'running', 'process']);

export function createLabScene(container, callbacks) {
  const renderer = new T.WebGLRenderer({antialias: true, alpha: false, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
  container.append(renderer.domElement);
  const world = new T.Scene(); world.background = new T.Color('#c4d2cc');
  world.fog = new T.Fog('#c4d2cc', 65, 110);
  const camera = new T.PerspectiveCamera(40, 1, .1, 160);
  const aim = new T.Vector3(0, .7, 0), target = aim.clone();
  let azimuth = .48, elevation = .7, radius = 46, targetRadius = 46, paused = false, stale = false;
  let selected = null, latestData = null, walkingTarget = null, lastTime = 0, animationTime = 0, lastPosition = 0;
  let dirty = true, wasMoving = false, lastShadow = 0, previousAzimuth = azimuth, previousElevation = elevation;
  const keys = new Set(), robots = new Map(), zones = new Map(), hitObjects = [], obstacles = [];
  const mats = new Map(), geometries = new Map();
  const mat = (color, metalness = .1, roughness = .65) => {
    const key = `${color}:${metalness}:${roughness}`;
    if (!mats.has(key)) mats.set(key, new T.MeshStandardMaterial({color, metalness, roughness}));
    return mats.get(key);
  };
  const glow = color => {
    const key = `glow:${color}`;
    if (!mats.has(key)) mats.set(key, new T.MeshStandardMaterial({color, emissive: color, emissiveIntensity: .85, roughness: .4}));
    return mats.get(key);
  };
  const geo = (key, create) => { if (!geometries.has(key)) geometries.set(key, create()); return geometries.get(key); };
  function mesh(parent, geometry, material, x = 0, y = 0, z = 0, shadow = true) {
    const m = new T.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
  }
  function box(parent, w, h, d, color, x = 0, y = 0, z = 0) {
    const m = mesh(parent, geo('box', () => new T.BoxGeometry(1, 1, 1)), typeof color === 'string' ? mat(color) : color, x, y, z);
    m.scale.set(w, h, d); return m;
  }
  function sphere(parent, r, color, x = 0, y = 0, z = 0, scale = [1, 1, 1]) {
    const m = mesh(parent, geo('sphere', () => new T.SphereGeometry(1, 24, 16)), typeof color === 'string' ? mat(color) : color, x, y, z);
    m.scale.set(r * scale[0], r * scale[1], r * scale[2]); return m;
  }
  function cylinder(parent, r, height, color, x = 0, y = 0, z = 0, top = r) {
    return mesh(parent, geo(`cyl:${r}:${top}:${height}`, () => new T.CylinderGeometry(top, r, height, 24)), typeof color === 'string' ? mat(color) : color, x, y, z);
  }
  function ring(parent, r, thickness, color, x = 0, y = 0, z = 0, floor = false) {
    const m = mesh(parent, geo(`ring:${r}:${thickness}`, () => new T.TorusGeometry(r, thickness, 8, 64)), typeof color === 'string' ? mat(color) : color, x, y, z);
    if (floor) m.rotation.x = Math.PI / 2; return m;
  }
  function rod(parent, a, b, width, material) {
    const start = new T.Vector3(...a), end = new T.Vector3(...b), delta = end.clone().sub(start);
    const m = cylinder(parent, width, delta.length(), material);
    m.position.copy(start.add(end).multiplyScalar(.5)); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize()); return m;
  }
  function textPlane(parent, text, width, height, x, y, z, {color = '#315d59', background = '#dbe5da', floor = false, size = 65} = {}) {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 192;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = background; ctx.fillRect(0, 0, 768, 192);
    ctx.fillStyle = color; ctx.font = `600 ${size}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 384, 96);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    const material = new T.MeshBasicMaterial({map: texture, side: T.DoubleSide});
    const plane = mesh(parent, new T.PlaneGeometry(width, height), material, x, y, z, false);
    if (floor) plane.rotation.x = -Math.PI / 2; return plane;
  }
  world.add(new T.HemisphereLight('#e9fff4', '#617670', 2.9));
  const sunlight = new T.DirectionalLight('#fff1d7', 4.3); sunlight.position.set(-12, 25, 10); sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024); Object.assign(sunlight.shadow.camera, {left: -27, right: 27, top: 24, bottom: -24, far: 70});
  sunlight.shadow.normalBias = .045; sunlight.shadow.bias = -.0001; world.add(sunlight);
  const fill = new T.DirectionalLight('#a3e9f0', 1.4); fill.position.set(13, 9, -10); world.add(fill);

  // Cutaway test chamber: tiled concrete, exposed mechanics, luminous seams.
  box(world, 38, .7, 28, '#5f7978', 0, -.55, .3);
  box(world, 37.4, .16, 27.4, '#80948d', 0, -.12, .3);
  const tileGeo = new T.BoxGeometry(1.92, .12, 1.92);
  const tiles = new T.InstancedMesh(tileGeo, mat('#b8c7bd'), 18 * 13);
  const matrix = new T.Matrix4(); let index = 0;
  for (let x = 0; x < 18; x++) for (let z = 0; z < 13; z++) {
    matrix.makeTranslation(x * 2 - 17, -.01, z * 2 - 12); tiles.setMatrixAt(index, matrix);
    tiles.setColorAt(index++, new T.Color().setHSL(.38, .07, .59 + ((x * 7 + z * 3) % 7) * .017));
  }
  tiles.receiveShadow = true; world.add(tiles);
  // Back wall deliberately leaves the front open for a readable dollhouse view.
  for (let x = -17; x <= 17; x += 2) {
    box(world, 1.94, 5.6, .42, '#c5d1c7', x, 2.8, -13.2);
    box(world, 1.94, .12, .45, '#91a9a1', x, 2.2, -13.17);
    box(world, 1.5, .09, .12, glow('#c8f4e3'), x, 4.85, -12.9);
  }
  for (let z = -11; z <= 9; z += 2) {
    box(world, .42, 3.2, 1.94, '#adbfb4', -18.1, 1.6, z);
    box(world, .1, .09, 1.4, glow('#c8f4e3'), -17.84, 2.7, z);
  }
  box(world, 36.8, .28, .65, '#405b59', 0, 5.72, -13.2);
  for (const y of [3.8, 4.18]) rod(world, [-17, y, -12.7], [17, y, -12.7], .1, mat('#667c77', .65));
  for (const x of [-16, -7, 7, 16]) {
    box(world, .18, 1.45, .26, '#536d67', x, 3.95, -12.63);
    box(world, 1.3, .9, .15, '#294d4d', x, .9, -12.92);
    for (let j = 0; j < 5; j++) box(world, 1.1, .035, .05, '#8ea89b', x, .57 + j * .15, -12.8);
  }
  textPlane(world, 'SATO  /  AGENT RESEARCH', 10, 1.5, -4.5, 3.05, -12.91, {color: '#345853', size: 45});
  textPlane(world, '07  /  SYSTEMS', 4, .9, 11.2, 2.9, -12.9, {size: 48});
  // Observation window.
  box(world, 5, 2.2, .25, '#385b5b', 11.6, 4.1, -13);
  box(world, 4.65, 1.86, .05, '#83b6b5', 11.6, 4.1, -12.83);
  box(world, .12, 2, .1, '#3c6663', 11.6, 4.1, -12.77);
  // Entry airlock, white shell with cyan edge.
  ring(world, 1.5, .24, '#e3ece0', -13.5, 1.64, -12.78);
  const door = cylinder(world, 1.27, .1, '#345753', -13.5, 1.64, -12.65); door.rotation.x = Math.PI / 2;
  ring(world, 1.3, .055, glow('#8df6e0'), -13.5, 1.64, -12.51);
  box(world, .07, 2.1, .1, '#789d8c', -13.5, 1.6, -12.5);
  textPlane(world, '↓  ENTRADA', 2.3, .55, -13.5, 3.5, -12.8, {color: '#315854', size: 57});
  // Floor conduits link the sectors to the nucleus; these are architecture, not traces.
  for (const [id, zone] of Object.entries(ZONES)) {
    if (id === 'hermes') continue;
    const bend = [zone.x * .58, .12, zone.z * .3];
    rod(world, [0, .12, 0], bend, .06, mat('#547e76'));
    rod(world, bend, [zone.x, .12, zone.z], .06, mat('#547e76'));
    for (let i = .2; i < 1; i += .18) sphere(world, .065, glow(zone.color), zone.x * i, .16, zone.z * i, [1, .35, 1]);
  }
  // Small floor markings and test crates give the chamber a lived-in scale.
  for (let i = 0; i < 8; i++) {
    const stripe = box(world, .42, .025, 1.15, i % 2 ? '#acb3a1' : '#dcac5a', 13.6 + i * .36, .08, 9.8); stripe.rotation.y = -.35;
  }
  for (const [x, z] of [[15, -9], [-15, -2], [15, 8]]) {
    box(world, 1.15, 1.15, 1.15, '#d7e1d6', x, .63, z);
    box(world, .8, .8, 1.21, '#879b90', x, .63, z);
    ring(world, .23, .05, '#d7e1d6', x, .63, z + .62);
    obstacles.push({x, z, w: 1.6, d: 1.6});
  }

  function consoleDesk(group, color) {
    box(group, 2.5, .22, 1.25, '#e4eade', 0, 1, -.4);
    box(group, 1.95, .82, .75, '#82998b', 0, .5, -.55);
    box(group, 2.05, .07, .06, glow(color), 0, .85, .23);
    const monitor = box(group, 1.65, .92, .11, '#385b53', 0, 1.6, -.72); monitor.rotation.x = -.18;
    const screen = box(group, 1.44, .71, .035, '#183e3c', 0, 1.6, -.64); screen.rotation.x = -.18;
    for (let k = 0; k < 4; k++) box(group, .4 + .14 * k, .038, .04, glow(color), -.35 + .055 * k, 1.78 - k * .13, -.54);
    box(group, .88, .04, .3, '#708c7b', 0, 1.15, -.01);
    for (let k = 0; k < 3; k++) sphere(group, .04, glow(k === 0 ? color : '#b1bc9b'), .79 + k * .15, 1.15, .02);
  }

  for (const [id, zone] of Object.entries(ZONES)) {
    const group = new T.Group(); group.position.set(zone.x, .09, zone.z); world.add(group);
    const r = id === 'hermes' ? 3.3 : 2.6;
    cylinder(group, r, .21, '#6c8b7e', 0, .08, 0);
    cylinder(group, r - .12, .12, '#cbd9ca', 0, .23, 0);
    const trim = ring(group, r - .22, .035, glow(zone.color), 0, .32, 0, true);
    ring(group, r - .07, .045, '#3a6157', 0, .27, 0, true);
    const desk = new T.Group(); desk.position.z = -.75; group.add(desk); consoleDesk(desk, zone.color);
    obstacles.push({x: zone.x, z: zone.z - 1.15, w: 3.1, d: 1.8});
    zones.set(id, {group, trim, labelPoint: new T.Vector3(zone.x, .4, zone.z + 3), status: 'unknown'});
    textPlane(group, id === 'hermes' ? '01  /  HERMES' : `0${Object.keys(ZONES).indexOf(id) + 1}  /  ${id.toUpperCase()}`, 2.4, .46, 0, .31, 1.95, {floor: true, color: '#4b7060', background: '#cbd9ca', size: 47});
  }
  // Nucleus: segmented containment ring with articulated supports.
  const nucleus = zones.get('hermes').group;
  ring(nucleus, 2.05, .14, '#dde7d9', 0, 3.65, -.45, true);
  ring(nucleus, 1.87, .035, glow('#6df4da'), 0, 3.64, -.45, true);
  for (const side of [-1, 1]) {
    rod(nucleus, [side * 2.4, .35, -1.6], [side * 2.2, 2.8, -1.6], .11, mat('#617c6e', .55));
    rod(nucleus, [side * 2.2, 2.8, -1.6], [side * 1.6, 3.65, -1.6], .09, mat('#dae4d4'));
  }
  // Provider portals: two gateways, configuration is shown by the UI, never invented.
  const providers = zones.get('models').group;
  for (const side of [-1, 1]) {
    ring(providers, .9, .17, '#dce3d3', side * 1.35, 1.5, -1.3);
    ring(providers, .71, .065, glow(side === -1 ? '#70d9f5' : '#ffb76b'), side * 1.35, 1.5, -1.17);
    const inner = cylinder(providers, .65, .07, '#376768', side * 1.35, 1.5, -1.2); inner.rotation.x = Math.PI / 2;
  }
  // MCP patch bay: cabling plugs into a central spine.
  const patch = zones.get('mcp').group;
  box(patch, 3.35, 2.15, .35, '#365851', 0, 1.55, -1.7);
  for (let i = 0; i < 6; i++) {
    const x = -.99 + (i % 3) * .99, y = 1.05 + Math.floor(i / 3) * .95;
    box(patch, .76, .58, .18, '#b3c7b4', x, y, -1.42);
    sphere(patch, .08, glow('#80d3d8'), x - .17, y, -1.28);
    rod(patch, [x + .1, y, -1.24], [x + .2, .44, -1.1], .035, mat('#456f65'));
  }
  // RAG archive: luminous glass towers enclosing stacked document wafers.
  const archive = zones.get('rag').group;
  for (const side of [-1, 1]) {
    const x = side * 1.5;
    cylinder(archive, .55, .2, '#749a81', x, .4, -1.1);
    cylinder(archive, .48, 2.45, new T.MeshStandardMaterial({color: '#84cbb2', transparent: true, opacity: .28, roughness: .2, depthWrite: false}), x, 1.65, -1.1);
    ring(archive, .5, .07, '#e0e6d2', x, 2.85, -1.1, true);
    for (let i = 0; i < 6; i++) box(archive, .55, .12, .5, i % 2 ? '#daebd5' : glow('#78c9a0'), x, .65 + i * .33, -1.1);
  }
  // Memory shelves and removable context cartridges.
  const shelves = zones.get('memory').group;
  box(shelves, 3.4, 2.1, .54, '#678374', 0, 1.4, -1.8);
  for (let row = 0; row < 2; row++) {
    box(shelves, 3.5, .12, .73, '#dce5d0', 0, .52 + row * 1.12, -1.65);
    for (let col = 0; col < 7; col++) box(shelves, .27, .72 + (col % 2) * .11, .4, ['#abb0cf', '#d8ce9f', '#8ac4b1'][col % 3], -1.35 + col * .43, .96 + row * 1.1, -1.54);
  }
  // Cron clock, with a static dial; robot activity is driven only by evidence.
  const scheduler = zones.get('cron').group;
  rod(scheduler, [0, .3, -1.65], [0, 2.8, -1.65], .16, mat('#66816d'));
  ring(scheduler, 1.05, .17, '#e1e6d2', 0, 2.85, -1.6);
  const dial = cylinder(scheduler, .94, .1, '#426e62', 0, 2.85, -1.6); dial.rotation.x = Math.PI / 2;
  for (let i = 0; i < 12; i++) {
    const tick = box(scheduler, .05, .14, .035, '#d6dcbc', Math.sin(i * Math.PI / 6) * .78, 2.85 + Math.cos(i * Math.PI / 6) * .78, -1.49); tick.rotation.z = -i * Math.PI / 6;
  }
  rod(scheduler, [0, 2.85, -1.45], [.52, 3.15, -1.45], .045, glow('#ebc786'));
  rod(scheduler, [0, 2.85, -1.44], [0, 3.44, -1.44], .03, '#e9e3c5');
  // Infrastructure cabinets.
  const racks = zones.get('vm').group;
  for (const side of [-1, 1]) {
    box(racks, .82, 2.4, .88, '#486b63', side * 1.65, 1.5, -.65);
    box(racks, .72, 2.25, .06, '#274d49', side * 1.65, 1.5, -.18);
    for (let i = 0; i < 7; i++) {
      box(racks, .54, .19, .06, '#8ea595', side * 1.65, .6 + i * .29, -.12);
      sphere(racks, .025, glow('#a6d3a1'), side * 1.65 + .2, .6 + i * .29, -.07);
    }
  }

  // Spherical, single-eye service robots: shell, gimbal, pistons and little claws.
  function makeRobot(worker) {
    const root = new T.Group(); root.userData.robot = worker.id;
    const body = new T.Group(); body.position.y = 1.12; root.add(body);
    sphere(body, .55, '#dfe8dc', 0, 0, 0, [1.04, .96, .94]);
    ring(body, .54, .055, '#4c665d', 0, 0, 0, true);
    ring(body, .53, .035, '#7d9486', 0, 0, 0);
    sphere(body, .33, '#2b4943', 0, .015, .43, [1.1, 1, .5]);
    const iris = ring(body, .19, .055, glow('#94a59b'), 0, .015, .587);
    sphere(body, .15, '#263e38', 0, .015, .59, [1, 1, .22]);
    sphere(body, .035, '#eafff2', -.055, .07, .634);
    const arms = [];
    for (const side of [-1, 1]) {
      box(body, .16, .55, .28, '#bfcfc0', side * .52, .03, -.03).rotation.z = side * -.2;
      sphere(body, .12, '#557262', side * .57, -.1, 0);
      const arm = new T.Group(); arm.position.set(side * .6, -.08, 0); body.add(arm); arms.push(arm);
      rod(arm, [0, 0, 0], [side * .16, -.44, .08], .055, mat('#506d5f', .55));
      rod(arm, [side * .17, -.42, .08], [-side * .01, -.64, .25], .065, mat('#dce6d6'));
      for (const finger of [-1, 1]) rod(arm, [-side * .01, -.64, .25], [-side * .01 + finger * .06, -.75, .3], .025, mat('#526e61'));
      sphere(root, .12, '#4e6e5b', side * .25, .63, 0);
      rod(root, [side * .25, .68, 0], [side * .31, .28, .05], .09, mat('#d8e2d1'));
      rod(root, [side * .19, .6, -.03], [side * .25, .25, .02], .025, mat('#496253', .65));
      box(root, .3, .16, .46, '#466557', side * .3, .17, .13);
      box(root, .29, .07, .3, '#d6e3cf', side * .3, .25, .14);
    }
    rod(body, [.14, .45, -.1], [.23, .78, -.1], .025, mat('#587463'));
    sphere(body, .065, glow(ZONES[worker.sector].color), .23, .78, -.1);
    const selection = ring(root, .78, .025, glow('#f2c56e'), 0, .07, 0, true); selection.visible = false;
    world.add(root);
    return {root, body, iris, selection, arms, worker, phase: robots.size * 1.72};
  }

  // Friendly explorer with oversized head, casual striped knit, jeans and sneakers.
  const avatar = new T.Group(); avatar.position.set(-3, .14, 6); world.add(avatar);
  const person = new T.Group(); avatar.add(person);
  const skin = '#dfac7f', hair = '#4d4c3c';
  cylinder(person, .36, .65, '#71968c', 0, .88, 0, .26);
  for (const y of [.68, .87, 1.02]) cylinder(person, .36 - (y - .6) * .12, .055, '#e8ebd5', 0, y, 0);
  sphere(person, .54, skin, 0, 1.6, .015, [1, .98, .9]);
  const cap = mesh(person, new T.SphereGeometry(.565, 24, 16, 0, Math.PI * 2, 0, Math.PI * .53), mat(hair), 0, 1.65, -.01);
  cap.rotation.x = -.12;
  for (const side of [-1, 1]) {
    sphere(person, .13, skin, side * .52, 1.53, .025, [.8, 1.15, .8]);
    sphere(person, .105, '#faf9e3', side * .2, 1.57, .446, [.83, 1.3, .35]);
    sphere(person, .06, '#365d51', side * .2, 1.565, .476, [.85, 1.25, .5]);
    sphere(person, .027, '#172f2c', side * .2, 1.565, .501, [.9, 1.2, .3]);
    sphere(person, .019, '#fffdec', side * .18, 1.6, .515);
    sphere(person, .067, '#cd8f73', side * .32, 1.4, .393, [1, .55, .17]);
    rod(person, [side * .26, 1.06, 0], [side * .44, .72, .07], .11, mat('#71968c'));
    sphere(person, .125, skin, side * .46, .67, .075);
  }
  sphere(person, .075, '#cf9066', 0, 1.46, .487, [.72, .75, 1]);
  const smile = mesh(person, new T.TorusGeometry(.095, .014, 5, 16, Math.PI), mat('#94674b'), 0, 1.35, .456); smile.rotation.z = Math.PI;
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new T.Group(); leg.position.set(side * .17, .61, 0); person.add(leg);
    cylinder(leg, .12, .42, '#789aa3', 0, -.2, 0);
    box(leg, .26, .12, .38, '#eee7ce', 0, -.44, .075);
    box(leg, .28, .055, .4, '#b4b8a1', 0, -.51, .075); legs.push(leg);
  }
  // A small cross-body bag.
  rod(person, [.25, 1.19, .27], [-.3, .64, .32], .028, mat('#3b6155'));
  box(person, .29, .26, .16, '#d1ad6e', -.29, .68, .31);
  const destination = ring(world, .35, .028, glow('#e5e8bd'), 0, .2, 0, true); destination.visible = false;

  const raycaster = new T.Raycaster(), pointer = new T.Vector2(), floor = new T.Plane(new T.Vector3(0, 1, 0), -.3);
  function cast(event) {
    const rect = container.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }
  let drag = null;
  container.addEventListener('pointerdown', event => { if (event.button !== 0) return; container.focus(); drag = {x: event.clientX, y: event.clientY, px: event.clientX, py: event.clientY, moved: false}; container.setPointerCapture(event.pointerId); });
  container.addEventListener('pointermove', event => {
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true;
    if (drag.moved) { azimuth -= (event.clientX - drag.px) * .007; elevation = T.MathUtils.clamp(elevation + (event.clientY - drag.py) * .005, .35, 1.25); }
    drag.px = event.clientX; drag.py = event.clientY;
  });
  container.addEventListener('pointerup', event => {
    if (!drag) return; const clicked = !drag.moved; drag = null;
    if (!clicked) return; cast(event);
    const hit = raycaster.intersectObjects(hitObjects, false)[0];
    if (hit) { let object = hit.object; while (object && !object.userData.robot) object = object.parent; if (object) { callbacks.onRobot(object.userData.robot); return; } }
    const point = raycaster.ray.intersectPlane(floor, new T.Vector3());
    if (point) { walkingTarget = point; walkingTarget.x = T.MathUtils.clamp(point.x, -16.8, 16.8); walkingTarget.z = T.MathUtils.clamp(point.z, -11.4, 11.7); destination.position.set(point.x, .2, point.z); destination.visible = true; }
  });
  for (const type of ['pointercancel', 'lostpointercapture']) container.addEventListener(type, () => drag = null);
  container.addEventListener('wheel', event => { event.preventDefault(); targetRadius = T.MathUtils.clamp(targetRadius + Math.sign(event.deltaY) * 2, 12, 70); }, {passive: false});
  function clearKeys() { keys.clear(); walkingTarget = null; dirty = true; }
  function interact() {
    let closest = null, distance = 4;
    for (const item of robots.values()) { const d = avatar.position.distanceTo(item.root.position); if (d < distance) { closest = item; distance = d; } }
    if (closest) callbacks.onRobot(closest.worker.id);
  }
  container.addEventListener('keydown', event => {
    if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); keys.add(event.key); walkingTarget = null; }
    if (event.key.toLowerCase() === 'e') { event.preventDefault(); interact(); }
  });
  window.addEventListener('keyup', event => keys.delete(event.key));
  window.addEventListener('blur', clearKeys); container.addEventListener('blur', clearKeys);
  function canStand(x, z) { return x > -16.8 && x < 16.8 && z > -11.4 && z < 11.7 && !obstacles.some(o => Math.abs(x - o.x) < o.w / 2 + .28 && Math.abs(z - o.z) < o.d / 2 + .28); }

  function update(data) {
    stale = false; latestData = data; dirty = true; renderer.shadowMap.needsUpdate = true;
    // Up to 8 per sector on the floor. Selecting any roster member brings it
    // into the scene, including workers beyond the visual capacity.
    const visible = [];
    for (const id of Object.keys(ZONES)) {
      const members = data.workers.filter(w => w.sector === id);
      const priority = w => w.kind === 'guide' ? 0 : w.id === selected ? 1 : 2;
      visible.push(...members.sort((a, b) => priority(a) - priority(b)).slice(0, 8));
    }
    const ids = new Set(visible.map(w => w.id));
    for (const [id, item] of robots) if (!ids.has(id)) { world.remove(item.root); robots.delete(id); }
    hitObjects.length = 0;
    const counts = {};
    for (const worker of visible) {
      let item = robots.get(worker.id);
      if (!item) { item = makeRobot(worker); robots.set(worker.id, item); }
      item.worker = worker;
      const zone = ZONES[worker.sector], i = counts[worker.sector] || 0; counts[worker.sector] = i + 1;
      if (!i) item.root.position.set(zone.x, .39, zone.z + .65);
      else {
        const angle = -1.65 + (i - 1) * .55, spread = 3.1;
        item.root.position.set(T.MathUtils.clamp(zone.x + Math.sin(angle) * spread, -16, 16), .15, T.MathUtils.clamp(zone.z + Math.cos(angle) * spread, -11, 11.5));
      }
      item.root.scale.setScalar(i ? .72 : 1);
      item.iris.material = glow(worker.status === 'error' ? '#dc9d67' : LIVE.has(worker.status) ? zone.color : '#82988a');
      item.root.traverse(child => { if (child.isMesh) hitObjects.push(child); });
      item.selection.visible = selected === worker.id;
      if (worker.kind === 'guide') zones.get(worker.sector).status = worker.status;
    }
    for (const [id, zone] of zones) zone.trim.material = LIVE.has(zone.status) ? glow(ZONES[id].color) : mat('#8ba498');
  }
  function focusSector(id) { const z = ZONES[id]; target.set(z.x * .65, .8, z.z * .65); targetRadius = Math.max(24, 30 / Math.min(camera.aspect, 1.3)); }
  function setStale(value) {
    stale = value; dirty = true;
    if (value) {
      for (const item of robots.values()) item.iris.material = glow('#82988a');
      for (const zone of zones.values()) zone.trim.material = mat('#8ba498');
    }
  }
  function selectRobot(id) {
    selected = id;
    const wasStale = stale;
    if (latestData) update(latestData);
    if (wasStale) setStale(true);
  }
  function reset() { target.set(0, .7, 0); targetRadius = camera.aspect < 1 ? 60 : 46; azimuth = .48; elevation = .7; }
  const projected = new T.Vector3();
  function resize() { const {width, height} = container.getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); if (width < 500 && targetRadius === 46) targetRadius = 60; dirty = true; }
  new ResizeObserver(resize).observe(container); resize();
  const direction = new T.Vector3();
  function frame(ms) {
    requestAnimationFrame(frame);
    // Cap motion at 30fps and render still scenes only after an input or sample.
    // Software WebGL otherwise spends every frame redrawing hundreds of shadows.
    if (ms - lastTime < 1000 / 30) return;
    const dt = Math.min((ms - lastTime) / 1000, .05); lastTime = ms;
    if (document.hidden) return;
    if (!paused) animationTime += dt;
    const cameraChanging = aim.distanceToSquared(target) > .00001 || Math.abs(radius - targetRadius) > .001 || azimuth !== previousAzimuth || elevation !== previousElevation;
    previousAzimuth = azimuth; previousElevation = elevation;
    aim.lerp(target, 1 - Math.exp(-dt * 6)); radius = T.MathUtils.lerp(radius, targetRadius, 1 - Math.exp(-dt * 6));
    camera.position.set(aim.x + Math.sin(azimuth) * Math.cos(elevation) * radius, aim.y + Math.sin(elevation) * radius, aim.z + Math.cos(azimuth) * Math.cos(elevation) * radius); camera.lookAt(aim);
    let x = 0, z = 0;
    if (keys.has('w') || keys.has('ArrowUp')) z -= 1;
    if (keys.has('s') || keys.has('ArrowDown')) z += 1;
    if (keys.has('a') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('d') || keys.has('ArrowRight')) x += 1;
    direction.set(x * Math.cos(azimuth) + z * Math.sin(azimuth), 0, z * Math.cos(azimuth) - x * Math.sin(azimuth));
    if (walkingTarget && !keys.size) { direction.subVectors(walkingTarget, avatar.position); direction.y = 0; if (direction.length() < .2) { walkingTarget = null; direction.set(0, 0, 0); } }
    const moving = direction.lengthSq() > .01;
    const animating = !paused && !stale && [...robots.values()].some(item => LIVE.has(item.worker.status));
    if (!dirty && !moving && !wasMoving && !cameraChanging && !animating) return;
    dirty = false; wasMoving = moving;
    if (moving) {
      direction.normalize(); const nx = avatar.position.x + direction.x * dt * 4, nz = avatar.position.z + direction.z * dt * 4;
      let moved = false;
      if (canStand(nx, avatar.position.z)) { avatar.position.x = nx; moved = true; }
      if (canStand(avatar.position.x, nz)) { avatar.position.z = nz; moved = true; }
      if (!moved) walkingTarget = null;
      avatar.rotation.y = Math.atan2(direction.x, direction.z);
    }
    destination.visible = !!walkingTarget;
    legs[0].rotation.x = moving && !paused ? Math.sin(animationTime * 12) * .45 : 0;
    legs[1].rotation.x = -legs[0].rotation.x;
    person.position.y = moving && !paused ? Math.abs(Math.sin(animationTime * 12)) * .055 : 0;
    for (const item of robots.values()) {
      const active = !stale && LIVE.has(item.worker.status);
      const working = !stale && item.worker.status === 'running' && selected !== item.worker.id;
      item.body.position.y = 1.12 + (!paused && active ? Math.sin(animationTime * 3 + item.phase) * .035 : 0);
      item.body.rotation.y = !paused && active ? Math.sin(animationTime * .9 + item.phase) * .16 : 0;
      item.root.rotation.y = working ? Math.PI : 0;
      item.arms.forEach((arm, i) => arm.rotation.x = working ? -1.05 + (!paused ? Math.sin(animationTime * 6 + i * 2) * .13 : 0) : 0);
    }
    for (const [id, zone] of zones) {
      projected.copy(zone.labelPoint).project(camera);
      const label = document.querySelector(`[data-label="${id}"]`);
      label.style.left = `${(projected.x + 1) * container.clientWidth / 2}px`;
      label.style.top = `${(-projected.y + 1) * container.clientHeight / 2}px`;
      label.style.visibility = projected.z > 1 || Math.abs(projected.x) > 1.05 || Math.abs(projected.y) > 1.05 ? 'hidden' : 'visible';
    }
    if (ms - lastPosition > 200) { callbacks.onPosition(avatar.position.x, avatar.position.z); lastPosition = ms; }
    if (moving && ms - lastShadow > 500) { renderer.shadowMap.needsUpdate = true; lastShadow = ms; }
    renderer.render(world, camera);
  }
  requestAnimationFrame(frame);
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); document.getElementById('scene-fallback').hidden = false; document.getElementById('scene-labels').hidden = true; });
  renderer.domElement.addEventListener('webglcontextrestored', () => { dirty = true; renderer.shadowMap.needsUpdate = true; document.getElementById('scene-fallback').hidden = true; document.getElementById('scene-labels').hidden = false; });
  return {update, focusSector, selectRobot, reset, clearKeys, interact,
    zoom(delta) { targetRadius = T.MathUtils.clamp(targetRadius + delta * 4, 12, 70); },
    setPaused(value) { paused = value; dirty = true; }, setKey(key, value) { if (value) { keys.add(key); walkingTarget = null; } else keys.delete(key); dirty = true; },
    setStale,
  };
}
