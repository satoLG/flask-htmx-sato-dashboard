// Shared collision rules for walking and A*. Circles are the live robot roster.
export const BOUNDS = {minX: -17.1, maxX: 17.1, minZ: -11.65, maxZ: 12.1};
export const PLAYER_RADIUS = .32;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function canStand(x, z, boxes, circles, radius = PLAYER_RADIUS) {
  if (x < BOUNDS.minX + radius || x > BOUNDS.maxX - radius || z < BOUNDS.minZ + radius || z > BOUNDS.maxZ - radius) return false;
  for (const box of boxes) {
    const dx = x - clamp(x, box.x - box.w / 2, box.x + box.w / 2);
    const dz = z - clamp(z, box.z - box.d / 2, box.z + box.d / 2);
    if (dx * dx + dz * dz < radius * radius) return false;
  }
  return !circles.some(c => Math.hypot(x - c.x, z - c.z) < radius + c.r);
}
export function clearSegment(a, b, boxes, circles) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .16);
  for (let i = 1; i <= steps; i++) if (!canStand(a.x + (b.x - a.x) * i / steps, a.z + (b.z - a.z) * i / steps, boxes, circles)) return false;
  return true;
}
export function nearestFree(point, boxes, circles, maxDistance = 3) {
  const p = {x: clamp(point.x, BOUNDS.minX + .4, BOUNDS.maxX - .4), z: clamp(point.z, BOUNDS.minZ + .4, BOUNDS.maxZ - .4)};
  if (canStand(p.x, p.z, boxes, circles)) return p;
  for (let r = .2; r <= maxDistance; r += .2) for (let a = 0; a < 24; a++) {
    const candidate = {x: p.x + Math.cos(a * Math.PI / 12) * r, z: p.z + Math.sin(a * Math.PI / 12) * r};
    if (canStand(candidate.x, candidate.z, boxes, circles)) return candidate;
  }
  return null;
}
class Heap {
  items = [];
  push(item) { let i = this.items.push(item) - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.items[p].f <= item.f) break; this.items[i] = this.items[p]; i = p; } this.items[i] = item; }
  pop() { const first = this.items[0], last = this.items.pop(); if (this.items.length) { let i = 0; while (i * 2 + 1 < this.items.length) { let c = i * 2 + 1; if (c + 1 < this.items.length && this.items[c + 1].f < this.items[c].f) c++; if (last.f <= this.items[c].f) break; this.items[i] = this.items[c]; i = c; } this.items[i] = last; } return first; }
}
export function findPath(start, desired, boxes, circles) {
  const goal = nearestFree(desired, boxes, circles);
  if (!goal) return [];
  if (clearSegment(start, goal, boxes, circles)) return [goal];
  const step = .45, key = (x, z) => `${x},${z}`;
  const cell = p => ({x: Math.round(p.x / step), z: Math.round(p.z / step)});
  const origin = cell(start), open = new Heap(), best = new Map(), closed = new Set();
  const first = {...origin, p: start, g: 0, f: 0, parent: null}; open.push(first); best.set(key(origin.x, origin.z), 0);
  let end = null, iterations = 0;
  while (open.items.length && iterations++ < 6000) {
    const n = open.pop(), nk = key(n.x, n.z);
    if (closed.has(nk)) continue;
    closed.add(nk);
    if (Math.hypot(n.p.x - goal.x, n.p.z - goal.z) < .8 && clearSegment(n.p, goal, boxes, circles)) { end = n; break; }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const x = n.x + dx, z = n.z + dz, k = key(x, z), p = {x: x * step, z: z * step};
      if (closed.has(k) || !clearSegment(n.p, p, boxes, circles)) continue;
      const g = n.g + Math.hypot(p.x - n.p.x, p.z - n.p.z);
      if (g >= (best.get(k) ?? Infinity)) continue;
      best.set(k, g); open.push({x, z, p, g, f: g + Math.hypot(p.x - goal.x, p.z - goal.z), parent: n});
    }
  }
  if (!end) return [];
  const raw = [goal]; for (let n = end; n.parent; n = n.parent) raw.unshift(n.p);
  // String-pull the grid route so walking follows clean, natural diagonals.
  const smooth = []; let anchor = start, i = 0;
  while (i < raw.length) { let j = raw.length - 1; while (j > i && !clearSegment(anchor, raw[j], boxes, circles)) j--; smooth.push(raw[j]); anchor = raw[j]; i = j + 1; }
  return smooth;
}
export function moveWithCollision(position, dx, dz, boxes, circles) {
  // Substeps prevent tunnelling on a slow frame or a fast diagonal.
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .12));
  let x = position.x, z = position.z;
  for (let i = 0; i < count; i++) {
    if (canStand(x + dx / count, z + dz / count, boxes, circles)) { x += dx / count; z += dz / count; }
    else {
      if (canStand(x + dx / count, z, boxes, circles)) x += dx / count;
      if (canStand(x, z + dz / count, boxes, circles)) z += dz / count;
    }
  }
  return {x, z};
}
