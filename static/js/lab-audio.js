// Web Audio synthesis: no samples, requests or autoplay before a user gesture.
export function createLabAudio(){
  let ctx,master,nature,machines,enabled=false,inside=0,lastChirp=0,lastTick=0;
  function tone(freq,end,duration=.08,volume=.035,type='sine',bus=master){
    if(!ctx||!enabled||document.hidden)return;
    const osc=ctx.createOscillator(),gain=ctx.createGain(),t=ctx.currentTime;
    osc.type=type;osc.frequency.setValueAtTime(freq,t);osc.frequency.exponentialRampToValueAtTime(end,t+duration);
    gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(volume,t+.012);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    osc.connect(gain).connect(bus);osc.start(t);osc.stop(t+duration+.03);osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  function init(){
    const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return false;
    ctx=new Context();master=ctx.createGain();master.gain.value=.35;master.connect(ctx.destination);
    nature=ctx.createGain();nature.gain.value=1;nature.connect(master);
    machines=ctx.createGain();machines.gain.value=0;machines.connect(master);
    const buffer=ctx.createBuffer(1,ctx.sampleRate*3,ctx.sampleRate),data=buffer.getChannelData(0);let prev=0;
    for(let i=0;i<data.length;i++){prev=(prev+(Math.random()*2-1)*.025)/1.025;data[i]=prev;}
    const wind=ctx.createBufferSource(),filter=ctx.createBiquadFilter();wind.buffer=buffer;wind.loop=true;filter.type='lowpass';filter.frequency.value=650;wind.connect(filter).connect(nature);wind.start();
    for(const frequency of [60,120,181]){const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=frequency;g.gain.value=.012;o.connect(g).connect(machines);o.start();}
    return true;
  }
  async function toggle(){if(!ctx&&!init())return false;enabled=!enabled;if(enabled)await ctx.resume();else await ctx.suspend();return enabled;}
  document.addEventListener('visibilitychange',()=>{if(ctx){if(document.hidden)ctx.suspend();else if(enabled)ctx.resume();}});
  return {toggle,get enabled(){return enabled;},cue(kind){
    if(!enabled||!ctx)return;
    const now=ctx.currentTime;if(now-lastTick<.09)return;lastTick=now;
    const notes={walk:[130,90,.04,.012],click:[640,920,.08,.025],chat:[420,840,.16,.035],answer:[720,1100,.12,.025],error:[190,110,.18,.025],node:[880,1400,.15,.025]};
    tone(...(notes[kind]||notes.click));
  },tick(interior){inside=interior;if(!ctx||!enabled)return;const t=ctx.currentTime;nature.gain.setTargetAtTime(Math.cos(inside*Math.PI/2),t,.7);machines.gain.setTargetAtTime(Math.sin(inside*Math.PI/2),t,.7);
    if(t-lastChirp>4.5){lastChirp=t;tone(1800,2900,.19,.018,'sine',nature);}
  }};
}
