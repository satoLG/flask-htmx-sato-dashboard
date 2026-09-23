import * as T from '../vendor/three.module.min.js';
import {createInstallations} from './lab-installations.js';
import {createRagDome} from './lab-rag.js';
import {batchStatic} from './lab-batch.js';
import {loadSatoAvatar} from './lab-avatar.js';
import {createRigFactory, poseRig, dampAngle} from './lab-rigs.js';
import {canStand, findPath, nearestFree, moveWithCollision} from './lab-navigation.js';

// Local assets only: the supplied Sato GLB and procedural lab/robots.
const ZONES = {
  hermes: {x: 0, z: 0, color: '#56d5c3'}, models: {x: -10, z: -6, color: '#e9ab61'},
  mcp: {x: 0, z: -7.5, color: '#6ccce0'}, rag: {x: 10, z: -6, color: '#83cbb3'},
  memory: {x: -11, z: 4.5, color: '#bab5e4'}, cron: {x: 10, z: 4.5, color: '#e3b271'},
  vm: {x: 0, z: 8, color: '#80b4c6'},
};
const LIVE = new Set(['recent', 'running', 'process']);
const NAMES = {hermes:'NÚCLEO',models:'PROVIDERS',mcp:'MCP',rag:'RAG',memory:'SKILLS',cron:'CRON',vm:'VM'};

export async function createLabScene(container, callbacks) {
  const hero = await loadSatoAvatar();
  const renderer = new T.WebGLRenderer({antialias: true, alpha: false, powerPreference: 'high-performance'});
  let pixelRatio=Math.min(devicePixelRatio,1.35),qualityFrames=0,qualityElapsed=0;
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  container.append(renderer.domElement);
  const world = new T.Scene(); world.background = new T.Color('#c4d2cc');
  world.fog = new T.Fog('#c4d2cc', 100, 160);
  const camera = new T.PerspectiveCamera(42, 1, .1, 160);
  const aim = new T.Vector3(-4, 1, 4), target = aim.clone();
  let azimuth = .55, elevation = .64, radius = 14, targetRadius = 14, paused = false, stale = false;
  let latestData = null, lastTime = 0, animationTime = 0, lastPosition = 0;
  let dirty = true, lastShadow = 0;
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
    ctx.fillStyle = color; ctx.font = `600 ${size}px monospace`;while(ctx.measureText(text).width>720&&size>16){size-=2;ctx.font=`600 ${size}px monospace`;}ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 384, 96);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    const material = new T.MeshBasicMaterial({map: texture, side: T.DoubleSide});
    const plane = mesh(parent, new T.PlaneGeometry(width, height), material, x, y, z, false);
    if (floor) plane.rotation.x = -Math.PI / 2; return plane;
  }
  world.add(new T.HemisphereLight('#e5f6ff', '#687772', 2.5));
  const sunlight = new T.DirectionalLight('#fff0d8', 3.5); sunlight.position.set(-12, 25, 10); sunlight.castShadow = true;
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
    box(world, 1.94, 8.6, .42, '#c5d1c7', x, 4.3, -13.2);
    box(world, 1.94, .12, .45, '#91a9a1', x, 2.2, -13.17);
    box(world, 1.5, .09, .12, glow('#c8f4e3'), x, 4.85, -12.9);
  }
  for (let z = -11; z <= 9; z += 2) {
    box(world, .42, 3.2, 1.94, '#adbfb4', -18.1, 1.6, z);
    box(world, .1, .09, 1.4, glow('#c8f4e3'), -17.84, 2.7, z);
  }
  box(world, 36.8, .28, .65, '#405b59', 0, 8.72, -13.2);
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

  function makeScreen(parent, x, y, z, width = 1.44, height = .76) {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 384;
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    const plane = mesh(parent, new T.PlaneGeometry(width,height), new T.MeshBasicMaterial({map:texture}), x,y,z,false);
    plane.rotation.x = -.18;
    let previous = '';
    function update(lines) {
      const key = lines.join('|'); if (key === previous) return; previous = key;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#102e34'; ctx.fillRect(0,0,768,384);
      ctx.fillStyle = '#52a6c0'; ctx.fillRect(32,28,5,38);
      for (let i=0;i<lines.length;i++) { ctx.font = `${i===0 ? 600 : 400} ${i===0 ? 42 : 29}px monospace`; ctx.fillStyle = i===0 ? '#a4e7ff' : i===1 ? '#e7f8ed' : '#94ada9'; let text=String(lines[i]); while(ctx.measureText(text).width>690 && text.length>2) text=text.slice(0,-2)+'…'; ctx.fillText(text,55,59+i*72); }
      texture.needsUpdate = true;
    }
    update(['AGUARDANDO DADOS','Sem telemetria','']);
    return {update,texture,plane};
  }
  function consoleDesk(group, color) {
    box(group, 2.5, .22, 1.25, '#e4eade', 0, 1, -.4);
    box(group, 1.95, .82, .75, '#82998b', 0, .5, -.55);
    box(group, 2.05, .07, .06, glow(color), 0, .85, .23);
    const monitor = box(group, 1.65, .92, .11, '#385b53', 0, 1.6, -.72); monitor.rotation.x = -.18;
    const screen = makeScreen(group,0,1.6,-.57);
    box(group, 1.08, .07, .55, '#b7cbbb', 0, 1.07, .27);
    box(group, .88, .04, .3, '#708c7b', 0, 1.15, .34);
    for (let k = 0; k < 3; k++) sphere(group, .04, glow(k === 0 ? color : '#b1bc9b'), .79 + k * .15, 1.15, .02);
    return screen;
  }

  for (const [id, zone] of Object.entries(ZONES)) {
    const group = new T.Group(); group.position.set(zone.x, .09, zone.z); world.add(group);
    const r = id === 'hermes' ? 3.3 : 2.6;
    cylinder(group, r, .21, '#6c8b7e', 0, .08, 0);
    cylinder(group, r - .12, .12, '#cbd9ca', 0, .23, 0);
    const trim = ring(group, r - .22, .035, glow(zone.color), 0, .32, 0, true);
    ring(group, r - .07, .045, '#3a6157', 0, .27, 0, true);
    const desk = new T.Group(); desk.position.z = -.75; group.add(desk); const display = consoleDesk(desk, zone.color);
    obstacles.push({x: zone.x, z: zone.z - 1.15, w: 3.1, d: 1.8});
    zones.set(id, {group, trim, display, status:'unknown',radius:r});
    // Physical double-sided plaque, with a steel post and an actual collider.
    const sign = new T.Group(); group.add(sign); sign.position.set(1.95,0,2.12);
    box(sign,.4,.13,.38,'#647e75',0,.36,0); box(sign,.075,1.1,.08,'#68867b',0,.9,0);
    box(sign,2.65,.75,.13,'#294c4d',0,1.59,0);
    const plaque = textPlane(sign,NAMES[id],2.52,.67,0,1.59,.071,{color:'#d7eee5',background:'#294c4d',size:142});
    const rear = plaque.clone(); rear.position.z=-.071; rear.rotation.y=Math.PI; sign.add(rear);
    sign.traverse(o=>o.userData.station=id);
    obstacles.push({x:zone.x+1.95,z:zone.z+2.12,w:.55,d:.5});
  }
  // Nucleus: segmented containment ring with articulated supports.
  const nucleus = new T.Group(); zones.get('hermes').group.add(nucleus);
  ring(nucleus, 2.05, .14, '#dde7d9', 0, 3.65, -.45, true);
  ring(nucleus, 1.87, .035, glow('#6df4da'), 0, 3.64, -.45, true);
  for (const side of [-1, 1]) {
    rod(nucleus, [side * 2.4, .35, -1.6], [side * 2.2, 2.8, -1.6], .11, mat('#617c6e', .55));
    rod(nucleus, [side * 2.2, 2.8, -1.6], [side * 1.6, 3.65, -1.6], .09, mat('#dae4d4'));
  }
  nucleus.traverse(o => o.userData.dynamic = true);
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
  // Each extra worker has its own bench, terminal and tool to operate.
  const slots = [[0,.25],[-2.85,.3],[2.85,.3],[0,3.15]];
  const benches = new Map(), machineParts = [];
  for (const [id,zone] of Object.entries(ZONES)) {
    for (let i=1;i<slots.length;i++) {
      const [sx,sz] = slots[i], g = new T.Group();
      g.position.set(zone.x+sx,groundAt(zone.x+sx,zone.z+sz)-.078,zone.z+sz-.66);g.scale.y=.8;world.add(g);
      box(g,1.2,.14,.62,'#bccdc4',0,.86,0); box(g,.85,.75,.39,'#59756b',0,.42,-.07);
      box(g,.83,.5,.08,'#294d4b',0,1.22,-.2);
      const display = makeScreen(g,0,1.22,-.145,.75,.4); display.update(['BANCADA AUXILIAR','Aguardando agente','']);
      box(g,.56,.04,.21,'#506e64',-.14,.96,.05);
      const tool = new T.Group(); tool.position.set(.42,1.02,.09); g.add(tool);
      cylinder(tool,.08,.15,'#d7e3d6'); ring(tool,.08,.018,glow('#54b9f1'),0,.05,.07);
      tool.traverse(o => o.userData.dynamic=true); machineParts.push({object:tool,sector:id,slot:i,position:tool.getWorldPosition(new T.Vector3())});
      benches.set(`${id}:${i}`,{group:g,display});
      obstacles.push({x:g.position.x,z:g.position.z,w:1.3,d:.72});
    }
    const z = zones.get(id); z.trim.userData.dynamic = true;
    // Back equipment, not just the desktops, participates in collision.
    obstacles.push({x:zone.x,z:zone.z-1.8,w:id==='hermes'?4.8:3.6,d:.8});
  }
  for (const side of [-1,1]) obstacles.push({x:side*1.65,z:6.1,w:1.25,d:.5});
  // Keep the plaques raycastable when batching the static chamber.
  world.traverse(o => { if (o.isMesh && o.userData.station) hitObjects.push(o); });
  const art={box,sphere,cylinder,ring,rod,mesh,mat,glow,geo,textPlane};
  const installations=createInstallations(world,zones,art),ragDome=createRagDome(world,art);
  obstacles.push({x:10,z:-7.45,w:5.8,d:3.2});
  batchStatic(world);

  const factory = createRigFactory({box,sphere,cylinder,ring,rod,mesh,mat,glow,geo});
  const avatar = hero.root; avatar.position.set(-4,.13,4); avatar.scale.setScalar(1.12); world.add(avatar);
  const destination = ring(world,.27,.023,glow('#c6f0f7'),0,.16,0,true); destination.visible=false;
  let study=false,savedStudyCamera=null;
  let cameraMode='follow', savedCamera=null, chatId=null, desiredRobot=null, route=[], location=null, candidate=null, emoteUntil=0;
  let targetAzimuth=azimuth, targetElevation=elevation, wasMoving=false, contextLost=false;
  const circles=[], zoneByRobot=new Map();
  const phaseFor=id => [...id].reduce((n,c) => (n*31+c.charCodeAt(0))%997,0)/71;
  const dist=(a,b) => Math.hypot(a.x-b.x,a.z-b.z);
  function inside(id,p=avatar.position) { const z=ZONES[id]; return Math.hypot(p.x-z.x,p.z-z.z)<3.65; }
  function groundAt(x,z) { for (const [id,data] of zones) if (Math.hypot(x-ZONES[id].x,z-ZONES[id].z)<data.radius-.12) return .38; return .13; }
  const emoticons=new Map();
  for (const text of ['…','?','!','✓','✦']) {
    const c=document.createElement('canvas'); c.width=128;c.height=128; const ctx=c.getContext('2d');
    ctx.fillStyle='#f1fbf3';ctx.beginPath();ctx.roundRect(7,5,114,99,27);ctx.fill();ctx.beginPath();ctx.moveTo(45,100);ctx.lineTo(50,122);ctx.lineTo(72,100);ctx.fill();
    ctx.fillStyle='#28637b';ctx.font='600 61px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,64,55);
    const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;
    emoticons.set(text,new T.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
  }
  function bubble(parent,height) { const sprite=new T.Sprite(emoticons.get('…'));sprite.position.y=height;sprite.scale.set(.53,.53,1);sprite.visible=false;sprite.renderOrder=10;parent.add(sprite);return sprite; }
  hero.bubble=bubble(avatar,2.7);
  function showBubble(rig,text) { rig.bubble.material=emoticons.get(text);rig.bubble.visible=true; }
  function refreshCircles() { circles.length=0; for (const [id,item] of robots) circles.push({id,x:item.rig.root.position.x,z:item.rig.root.position.z,r:item.slot===0?.57:.44}); }
  function update(data) {
    latestData=data;stale=false;dirty=true;installations.update(data);
    const keep=new Set();
    for (const [id,zone] of Object.entries(ZONES)) {
      const workers=data.workers.filter(w=>w.sector===id), guide=workers.find(w=>w.kind==='guide');
      const priority=w=>w.kind==='guide'?0:w.id===chatId?1:w.id===desiredRobot?2:3;
      const visible=workers.sort((a,b)=>priority(a)-priority(b)).slice(0,4);
      const occupied=new Set();
      // Preserve each actor's workstation across snapshots, even when order changes.
      for (const w of visible) if (robots.has(w.id)) occupied.add(robots.get(w.id).slot);
      for (const w of visible) {
        keep.add(w.id); let item=robots.get(w.id);
        if (!item) {
          const slot=w.kind==='guide'?0:[1,2,3].find(i=>!occupied.has(i));if(slot===undefined)continue;occupied.add(slot);
          const rig=factory.robot();rig.phase=phaseFor(w.id);rig.root.scale.setScalar(slot===0?1:.8);rig.root.position.set(zone.x+slots[slot][0],groundAt(zone.x+slots[slot][0],zone.z+slots[slot][1]),zone.z+slots[slot][1]);
          rig.root.traverse(o=>o.userData.robot=w.id);rig.bubble=bubble(rig.root,2.27);world.add(rig.root);
          item={rig,slot,worker:w};robots.set(w.id,item);renderer.shadowMap.needsUpdate=true;
        }
        item.worker=w;zoneByRobot.set(w.id,id);
        item.rig.indicator.material=glow(w.status==='error'?'#df9c6d':LIVE.has(w.status)?'#89d7b9':'#829c93');
        if(item.slot)benches.get(`${id}:${item.slot}`).display.update([w.name,w.status_label,w.detail||'']);
      }
      for(let i=1;i<4;i++) if(!visible.some(w=>robots.get(w.id)?.slot===i))benches.get(`${id}:${i}`).display.update(['BANCADA AUXILIAR','Aguardando agente','']);
      const z=zones.get(id);z.status=guide?.status||'unknown';z.trim.material=LIVE.has(z.status)?glow(zone.color):mat('#8ca89a');
      if(guide)z.display.update([NAMES[id]+' / '+guide.name,guide.status_label,...(guide.facts||[]).slice(0,2)]);
    }
    for(const[id,item]of robots)if(!keep.has(id)){world.remove(item.rig.root);for(const g of item.rig.ownedGeometry)g.dispose();item.rig.pupil.material.dispose();item.rig.opticMaterial.dispose();robots.delete(id);zoneByRobot.delete(id);renderer.shadowMap.needsUpdate=true;}
    refreshCircles();
    const free=nearestFree(avatar.position,obstacles,circles,2);if(free&&!canStand(avatar.position.x,avatar.position.z,obstacles,circles)){avatar.position.x=free.x;avatar.position.z=free.z;stopWalking();}
    if(route.length)route=findPath(avatar.position,route.at(-1),obstacles,circles);
    if(chatId&&!robots.has(chatId))endChat();
  }
  function stopWalking(){keys.clear();route=[];movementSpeed=0;destination.visible=false;dirty=true;}
  function navigate(point){if(chatId||study)return false;const next=findPath(avatar.position,point,obstacles,circles);if(!next.length){callbacks.onToast('Não encontrei um caminho livre até esse ponto.');return false;}route=next;destination.position.set(next.at(-1).x,groundAt(next.at(-1).x,next.at(-1).z)+.025,next.at(-1).z);destination.visible=true;dirty=true;return true;}
  function approach(item){
    const center=item.rig.root.position,options=[];
    for(let i=0;i<16;i++){const angle=i*Math.PI/8,p={x:center.x+Math.sin(angle)*1.5,z:center.z+Math.cos(angle)*1.5};if(inside(item.worker.sector,p)&&canStand(p.x,p.z,obstacles,circles))options.push(p);}
    options.sort((a,b)=>dist(a,avatar.position)-dist(b,avatar.position));
    for(const p of options){const path=findPath(avatar.position,p,obstacles,circles);if(path.length)return path;}
    return [];
  }
  function visitRobot(id){
    if(chatId)return;desiredRobot=id;
    if(!robots.has(id)&&latestData){const wasStale=stale;update(latestData);if(wasStale)setStale(true);}
    const item=robots.get(id);if(!item)return;
    route=approach(item);
    if(!route.length){callbacks.onToast('Não há caminho livre até essa bancada.');return;}
    if(cameraMode==='room')setCameraMode('follow');
    destination.position.set(route.at(-1).x,groundAt(route.at(-1).x,route.at(-1).z)+.025,route.at(-1).z);destination.visible=true;dirty=true;
  }
  function canInteract(id){const item=robots.get(id);return !contextLost&&!!item&&inside(item.worker.sector)&&dist(avatar.position,item.rig.root.position)<2.05;}
  function interact(){if(!chatId&&candidate&&canInteract(candidate.worker.id))callbacks.onInteract(candidate.worker.id);}
  function beginChat(id){
    if(!canInteract(id)||chatId||study)return false;
    stopWalking();chatId=id;savedCamera={mode:cameraMode,azimuth:targetAzimuth,elevation:targetElevation,radius:targetRadius};
    nucleus.visible = false;renderer.shadowMap.needsUpdate=true;
    const robot=robots.get(id).rig,dx=robot.root.position.x-avatar.position.x,dz=robot.root.position.z-avatar.position.z;
    targetAzimuth=Math.atan2(-dz,dx)+.12;targetElevation=.73;targetRadius=18.5;
    hero.greeting=animationTime+1.5;robot.greeting=animationTime+1.8;showBubble(hero,'✦');showBubble(robot,'…');emoteUntil=performance.now()+2500;
    callbacks.onCamera('chat');dirty=true;return true;
  }
  function endChat(){
    chatId=null;hero.bubble.visible=false;for(const item of robots.values())item.rig.bubble.visible=false;
    nucleus.visible=true;renderer.shadowMap.needsUpdate=true;previousCandidate=null;
    if(savedCamera){cameraMode=savedCamera.mode;targetAzimuth=savedCamera.azimuth;targetElevation=savedCamera.elevation;targetRadius=savedCamera.radius;savedCamera=null;}
    callbacks.onCamera(cameraMode);dirty=true;
  }
  function emote(kind){if(!chatId)return;const rig=robots.get(chatId)?.rig;if(!rig)return;showBubble(hero,kind==='question'?'?':'…');showBubble(rig,kind==='question'?'…':kind==='error'?'!':'✓');emoteUntil=performance.now()+3000;dirty=true;}
  function setCameraMode(mode){if(chatId||study)return;cameraMode=mode;targetRadius=mode==='room'?Math.max(44,43/camera.aspect):14;targetElevation=mode==='room'?.77:.64;targetAzimuth=.55;callbacks.onCamera(mode);dirty=true;}
  function setStale(value){stale=value;installations.setStale(value);dirty=true;if(value){for(const[id,z]of zones){z.trim.material=mat('#8ca89a');z.display.update([NAMES[id],'DADOS DESATUALIZADOS','Aguardando conexão']);}for(const item of robots.values())item.rig.indicator.material=glow('#829c93');}}
  // Rays reach actual robot meshes and actual physical signboards, not HTML labels.
  const raycaster=new T.Raycaster(),pointer=new T.Vector2(),floor=new T.Plane(new T.Vector3(0,1,0),-.15);let drag=null;
  function cast(event){const r=container.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);}
  container.addEventListener('pointerdown',e=>{if(chatId||e.button!==0)return;container.focus({preventScroll:true});drag={x:e.clientX,y:e.clientY,px:e.clientX,py:e.clientY,moved:false};container.setPointerCapture(e.pointerId);});
  container.addEventListener('pointermove',e=>{if(!drag)return;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>7)drag.moved=true;if(drag.moved){targetAzimuth-=(e.clientX-drag.px)*.006;targetElevation=T.MathUtils.clamp(targetElevation+(e.clientY-drag.py)*.004,.35,1.18);dirty=true;}drag.px=e.clientX;drag.py=e.clientY;});
  container.addEventListener('pointerup',e=>{
    if(!drag||chatId)return;const clicked=!drag.moved;drag=null;if(!clicked)return;cast(e);
    if(study){const node=ragDome.pick(raycaster);if(node)callbacks.onRagNode(ragDome.getNode(node));return;}
    const objects=[...hitObjects,...[...robots.values()].map(item=>item.rig.root)];
    const hits=raycaster.intersectObjects(objects,true).filter(h=>!h.object.isSprite);
    if(hits.length){let object=hits[0].object;while(object&&!object.userData.robot&&!object.userData.station)object=object.parent;if(object?.userData.robot){const id=object.userData.robot;if(canInteract(id))callbacks.onInteract(id);else visitRobot(id);return;}if(object?.userData.station){visitRobot(`guide:${object.userData.station}`);return;}}
    const point=raycaster.ray.intersectPlane(floor,new T.Vector3());if(point)navigate(point);
  });
  for(const type of ['pointercancel','lostpointercapture'])container.addEventListener(type,()=>drag=null);
  container.addEventListener('wheel',e=>{if(chatId)return;e.preventDefault();targetRadius=T.MathUtils.clamp(targetRadius+Math.sign(e.deltaY)*1.2,8,75);dirty=true;},{passive:false});
  container.addEventListener('keydown',e=>{if(chatId||study)return;const key=e.key.length===1?e.key.toLowerCase():e.key;if(['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)){e.preventDefault();keys.add(key);route=[];}if(key==='e'){e.preventDefault();interact();}});
  window.addEventListener('keyup',e=>keys.delete(e.key.length===1?e.key.toLowerCase():e.key));window.addEventListener('blur',stopWalking);container.addEventListener('blur',()=>keys.clear());
  const resizeObserver=new ResizeObserver(()=>{const r=container.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();if(study)targetRadius=camera.aspect>.85?13:20;else if(cameraMode==='room'&&!chatId)targetRadius=Math.max(44,43/camera.aspect);dirty=true;});resizeObserver.observe(container);
  const direction=new T.Vector3(),travelDirection=new T.Vector3();
  let movementSpeed=0,previousLocation='',previousCandidate='';
  function frame(ms){
    requestAnimationFrame(frame);if(ms-lastTime<1000/30)return;
    const elapsed=Math.min((ms-lastTime)/1000,.25),dt=elapsed;lastTime=ms;if(document.hidden||contextLost)return;
    // Lower fill cost on sustained slow devices, keeping the canvas/UI dimensions.
    if(!paused){qualityFrames++;qualityElapsed+=elapsed;if(qualityFrames>=45){if(qualityElapsed/qualityFrames>.055&&pixelRatio>.7){pixelRatio=Math.max(.7,pixelRatio-.2);renderer.setPixelRatio(pixelRatio);dirty=true;}qualityFrames=0;qualityElapsed=0;}}
    if(!paused)animationTime+=dt;
    let x=0,z=0;if(keys.has('w')||keys.has('ArrowUp'))z--;if(keys.has('s')||keys.has('ArrowDown'))z++;if(keys.has('a')||keys.has('ArrowLeft'))x--;if(keys.has('d')||keys.has('ArrowRight'))x++;
    direction.set(x*Math.cos(azimuth)+z*Math.sin(azimuth),0,z*Math.cos(azimuth)-x*Math.sin(azimuth));
    let remaining=Infinity;
    if(!keys.size&&route.length){
      while(route.length&&dist(avatar.position,route[0])<.08)route.shift();
      if(route.length){direction.set(route[0].x-avatar.position.x,0,route[0].z-avatar.position.z);remaining=direction.length();}
      else {direction.set(0,0,0);movementSpeed=0;}
    }
    const wantsToMove=direction.lengthSq()>.001;
    const desiredSpeed=wantsToMove?2.7*(route.length===1?Math.min(1,remaining/.45):1):0;
    movementSpeed=T.MathUtils.damp(movementSpeed,desiredSpeed,wantsToMove?8:12,dt);
    if(movementSpeed<.005)movementSpeed=0;
    if(wantsToMove)travelDirection.copy(direction).normalize();
    else if(movementSpeed)direction.copy(travelDirection);
    const step=Math.min(dt*movementSpeed,remaining);
    const before={x:avatar.position.x,z:avatar.position.z};
    if(!chatId&&direction.lengthSq()>.001){direction.normalize();const next=moveWithCollision(avatar.position,direction.x*step,direction.z*step,obstacles,circles);avatar.position.x=next.x;avatar.position.z=next.z;if(dist(before,next)<.001&&route.length){route=findPath(avatar.position,route.at(-1),obstacles,circles);}}
    const moving=dist(before,avatar.position)>.001;
    if(moving)avatar.rotation.y=dampAngle(avatar.rotation.y,Math.atan2(avatar.position.x-before.x,avatar.position.z-before.z),dt,12);
    avatar.position.y=T.MathUtils.lerp(avatar.position.y,groundAt(avatar.position.x,avatar.position.z),1-Math.exp(-dt*10));
    destination.visible=route.length>0&&!chatId;
    location=Object.keys(ZONES).find(id=>inside(id))||null;candidate=null;let nearest=2.05;
    for(const item of robots.values()){const distance=dist(avatar.position,item.rig.root.position);if(inside(item.worker.sector)&&distance<nearest){candidate=item;nearest=distance;}}
    if(desiredRobot&&canInteract(desiredRobot))candidate=robots.get(desiredRobot);
    if(location!==previousLocation){callbacks.onLocation(location);previousLocation=location;if(location){for(const item of robots.values())if(item.worker.sector===location){item.rig.greeting=animationTime+1.3;showBubble(item.rig,'✦');}emoteUntil=ms+1700;}}
    const candidateId=candidate?.worker.id||'';if(candidateId!==previousCandidate){callbacks.onCandidate(candidate?.worker||null);previousCandidate=candidateId;}
    if(chatId){const other=robots.get(chatId)?.rig.root;if(other){target.copy(avatar.position).add(other.position).multiplyScalar(.5);target.y=8.4;avatar.rotation.y=dampAngle(avatar.rotation.y,Math.atan2(other.position.x-avatar.position.x,other.position.z-avatar.position.z),dt);}}
    else if(study){target.set(10,2.5,-7.45);if(camera.aspect>.85){target.x-=Math.cos(azimuth)*1.8;target.z+=Math.sin(azimuth)*1.8;}else target.y=.4;}
    else if(cameraMode==='follow'){target.copy(avatar.position);target.y+=1.1;}
    else target.set(0,.65,0);
    const changing=aim.distanceToSquared(target)>.0001||Math.abs(radius-targetRadius)>.002||Math.abs(azimuth-targetAzimuth)>.002||Math.abs(elevation-targetElevation)>.002;
    aim.lerp(target,1-Math.exp(-elapsed*5));radius=T.MathUtils.lerp(radius,targetRadius,1-Math.exp(-elapsed*5));azimuth=dampAngle(azimuth,targetAzimuth,elapsed,6);elevation=T.MathUtils.lerp(elevation,targetElevation,1-Math.exp(-elapsed*5));
    camera.position.set(aim.x+Math.sin(azimuth)*Math.cos(elevation)*radius,aim.y+Math.sin(elevation)*radius,aim.z+Math.cos(azimuth)*Math.cos(elevation)*radius);camera.lookAt(aim);
    if(emoteUntil&&ms>emoteUntil){hero.bubble.visible=false;for(const item of robots.values())item.rig.bubble.visible=false;emoteUntil=0;dirty=true;}
    if(!dirty&&paused&&!moving&&!wasMoving&&!changing&&!hero.transitioning)return;dirty=false;wasMoving=moving;
    hero.update(dt,{speed:dist(before,avatar.position)/dt,reduced:paused});
    for(const item of robots.values()){
      const rig=item.rig,attention=inside(item.worker.sector)&&(item.worker.kind!=='catalog'||chatId===item.worker.id||animationTime<rig.greeting)?1:0;
      const look=Math.atan2(avatar.position.x-rig.root.position.x,avatar.position.z-rig.root.position.z);
      const beforeTurn=rig.root.rotation.y;
      rig.root.rotation.y=dampAngle(beforeTurn,attention?look:Math.PI,dt,attention?4:2);
      // Ambient inspection/tapping remains subtle while real work increases its pace.
      poseRig(rig,animationTime,dt,{speed:Math.min(.3,Math.abs(rig.root.rotation.y-beforeTurn)/dt*.2),attention,work:stale?.7:item.worker.status==='running'||item.worker.kind==='catalog'&&installations.memoryActive()?1:.8,talk:chatId===item.worker.id,lookYaw:T.MathUtils.clamp(Math.atan2(Math.sin(look-rig.root.rotation.y),Math.cos(look-rig.root.rotation.y)),-.3,.3),reduced:paused});
    }
    if(!paused)for(const part of machineParts){if(dist(avatar.position,part.position)<13)part.object.rotation.y=animationTime*.65+part.slot;}
    if(ms-lastPosition>150){callbacks.onPosition(avatar.position.x,avatar.position.z);lastPosition=ms;}
    // Static room shadows are cached; update actors at a lower cadence.
    if(ms-lastShadow>700&&moving){renderer.shadowMap.needsUpdate=true;lastShadow=ms;}
    installations.tick(animationTime,dt,paused);ragDome.tick(animationTime,camera);
    renderer.render(world,camera);
  }
  function setRagOpen(value){
    if(value){if(chatId||!inside('rag'))return false;stopWalking();study=true;savedStudyCamera={mode:cameraMode,azimuth:targetAzimuth,elevation:targetElevation,radius:targetRadius};targetRadius=camera.aspect>.85?13:20;targetElevation=.54;targetAzimuth=.28;callbacks.onCamera('rag');}
    else if(study){study=false;previousCandidate=null;cameraMode=savedStudyCamera.mode;targetRadius=savedStudyCamera.radius;targetAzimuth=savedStudyCamera.azimuth;targetElevation=savedStudyCamera.elevation;savedStudyCamera=null;callbacks.onCamera(cameraMode);}
    dirty=true;return true;
  }
  callbacks.onCamera('follow');requestAnimationFrame(frame);
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;stopWalking();callbacks.onLostContext(true);});
  renderer.domElement.addEventListener('webglcontextrestored',()=>{contextLost=false;dirty=true;renderer.shadowMap.needsUpdate=true;callbacks.onLostContext(false);});
  return {setRagOpen,setRagGraph(payload,options){dirty=true;return ragDome.setGraph(payload,options);},selectRagNode(id){ragDome.select(id);dirty=true;},setRagBusy(value){ragDome.setBusy(value);dirty=true;},updateHeatmap(payload){installations.updateHeatmap(payload);dirty=true;},update,visitRobot,canInteract,interact,beginChat,endChat,emote,setCameraMode,setStale,stopWalking,setPaused(value){paused=value;dirty=true;}};
}
