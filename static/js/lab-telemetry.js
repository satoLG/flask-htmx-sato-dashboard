// Missing values stay missing; a disconnected host must never become a 0% host.
export function percent(value){return typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(100,value)):null;}
export function instrumentData(snapshot){
  const calls=(snapshot.events||[]).filter(e=>e.sector==='models'||e.kind==='model');
  const memory=snapshot.visuals?.memory||{};
  return {cpu:percent(snapshot.metrics?.cpu),ram:percent(snapshot.metrics?.memory),calls,
    outgoing:calls.length,incoming:calls.filter(e=>Number(e.output_tokens)>0).length,eventAvailable:!!snapshot.telemetry_available||calls.length>0,
    primary:snapshot.visuals?.providers?.primary||'Provider não informado',
    memoryItems:memory.items||[],memoryCount:memory.count??null,memoryAvailable:!!memory.available,
    memoryEvents:(snapshot.events||[]).filter(e=>e.sector==='memory'),sampledAt:snapshot.now};
}
export function heatLevel(total,peak){return total>0?Math.max(1,Math.min(4,Math.ceil(total/Math.max(1,peak)*4))):0;}
