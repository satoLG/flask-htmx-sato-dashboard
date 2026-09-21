import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canStand,findPath,clearSegment,moveWithCollision,PLAYER_RADIUS,BOUNDS} from '../static/js/lab-navigation.js';

test('walking cannot tunnel through a robot even with a long frame',()=>{
  const robots=[{x:0,z:0,r:.57}],end=moveWithCollision({x:-2,z:0},5,0,[],robots);
  assert.ok(end.x<=-(.57+PLAYER_RADIUS));assert.ok(canStand(end.x,end.z,[],robots));
});
test('route skirts robot and equipment and every segment remains walkable',()=>{
  const boxes=[{x:0,z:0,w:2,d:3}],robots=[{x:0,z:2.7,r:.57}],start={x:-4,z:0},goal={x:4,z:0};
  const path=findPath(start,goal,boxes,robots);assert.ok(path.length>1);
  let previous=start;for(const p of path){assert.ok(clearSegment(previous,p,boxes,robots));previous=p;}
  assert.deepEqual(path.at(-1),goal);
});
test('blocked target resolves to a nearby free position',()=>{
  const robots=[{x:2,z:1,r:.57}],path=findPath({x:-3,z:1},{x:2,z:1},[],robots);
  assert.ok(path.length);const end=path.at(-1);assert.ok(canStand(end.x,end.z,[],robots));assert.ok(Math.hypot(end.x-2,end.z-1)<1.5);
});
test('enclosed destination has no path and room limits cannot be crossed',()=>{
  const boxes=[{x:0,z:-2,w:4.6,d:.6},{x:0,z:2,w:4.6,d:.6},{x:-2,z:0,w:.6,d:4},{x:2,z:0,w:.6,d:4}];
  assert.deepEqual(findPath({x:-6,z:0},{x:0,z:0},boxes,[]),[]);
  const end=moveWithCollision({x:16,z:10},20,20,[],[]);
  assert.ok(end.x<=BOUNDS.maxX-PLAYER_RADIUS);assert.ok(end.z<=BOUNDS.maxZ-PLAYER_RADIUS);
});
test('diagonal movement slides along a bench while preserving clearance',()=>{
  const boxes=[{x:0,z:0,w:2,d:2}],end=moveWithCollision({x:-2,z:-.7},2,2,boxes,[]);
  assert.ok(canStand(end.x,end.z,boxes,[]));assert.ok(end.z>.5);
});
