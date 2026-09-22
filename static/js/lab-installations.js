import * as T from '../vendor/three.module.min.js';
import {instrumentData,heatLevel} from './lab-telemetry.js';

export function createInstallations(world,zones,art){
  const {box,mesh,mat,glow,rod,ring,textPlane}=art;
  const dynamic=o=>{o.traverse(n=>n.userData.dynamic=true);return o;};
  function surface(parent,w,h,x,y,z,width=1024,height=512){
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
    const plane=mesh(parent,new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map:texture}),x,y,z,false);plane.userData.dynamic=true;
    return {canvas,texture,plane,ctx:canvas.getContext('2d'),paint(fn){fn(this.ctx,width,height);texture.needsUpdate=true;}};
  }
  const instruments=new T.Group();world.add(instruments);
  const gauges=[];
  for(const [i,label,color] of [[-1,'CPU','#63e5ff'],[1,'RAM','#a6f08a']]){
    const g=new T.Group();g.position.set(i*1.65,.4,6.1);instruments.add(g);
    box(g,1.25,3.95,.38,'#26474b',0,1.85,0);box(g,1.04,3.7,.06,'#10272e',0,1.9,.22);
    const segments=[];for(let j=0;j<14;j++)segments.push(box(g,.8,.135,.085,'#2e494c',0,.35+j*.165,.27));
    textPlane(g,label,1.05,.38,0,3.51,.261,{color:'#e0fffb',background:'#10272e',size:157});
    const display=surface(g,1.08,.58,0,2.97,.262,512,256);
    gauges.push({segments,display,color,value:undefined});
  }
  function gauge(item,value,stale=false){
    const key=`${value}/${stale}`;if(item.key===key)return;item.key=key;item.value=value;
    item.segments.forEach((segment,i)=>{segment.material=value!==null&&i<Math.ceil(value/100*14)?glow(value>90?'#ffae67':item.color):mat('#2e494c');});
    item.display.paint((ctx,w,h)=>{ctx.fillStyle='#10272e';ctx.fillRect(0,0,w,h);ctx.textAlign='center';ctx.fillStyle=value===null?'#8ba6aa':item.color;ctx.font='bold 135px system-ui';ctx.fillText(value===null?'—':Math.round(value)+'%',w/2,150);ctx.fillStyle='#a3bbc0';ctx.font='27px monospace';ctx.fillText(value===null?'SEM LEITURA':stale?'ÚLTIMA LEITURA':'USO DO HOST',w/2,218);});
  }
  gauges.forEach(g=>gauge(g,null));

  // Two transparent conduits cross the exterior wall. Packets replay observed calls.
  const pipes=[],packets=[],providers=zones.get('models').group;
  for(const [side,color] of [[-1,'#5bdcff'],[1,'#ffb06c']]){
    const path=new T.CatmullRomCurve3([new T.Vector3(side*1.35,1.7,-1.3),new T.Vector3(side*1.35,3.3,-2.3),new T.Vector3(-3+side*.4,4.2,-3.7),new T.Vector3(-9,4.2,-3.7+side*.55)]);
    mesh(providers,new T.TubeGeometry(path,48,.145,8,false),new T.MeshStandardMaterial({color,transparent:true,opacity:.18,roughness:.18,depthWrite:false}));
    mesh(providers,new T.TubeGeometry(path,48,.025,5,false),glow(color));
    for(let j=0;j<6;j++){const cuff=ring(providers,.16,.035,'#799b9c');cuff.position.copy(path.getPoint(j/5));cuff.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),path.getTangent(j/5));}
    for(let j=0;j<6;j++){const packet=box(providers,.14,.14,.27,glow(color));packet.visible=false;packet.userData.dynamic=true;packets.push({object:packet,path,side,index:j});}
    pipes.push(path);
  }
  const pipeStatus=surface(providers,3.4,.77,0,3.38,-1.3,1024,230);

  const skills=zones.get('memory').group;
  box(skills,4.8,2.8,.18,'#8d7660',0,2.92,-2.15);
  const chalk=surface(skills,4.53,2.54,0,2.92,-2.049);
  const chalkTip=box(skills,.075,.05,.13,'#eeeedd',-1.7,3.43,-1.95);chalkTip.userData.dynamic=true;
  const pages=[];
  for(const side of [-1,1]){
    const book=new T.Group();book.position.set(side*2.85,.89,-.32);skills.add(book);
    box(book,.8,.07,.52,side<0?'#c2a069':'#788eaa',0,0,0);box(book,.75,.07,.48,'#ede5cc',0,.055,0);
    const leaf=new T.Group();leaf.position.set(0,.1,0);book.add(leaf);box(leaf,.36,.012,.46,'#fff2d4',.18,0,0);dynamic(leaf);pages.push(leaf);
    // Tiny mechanical archivists: fixed equipment arms that turn the book pages.
    box(book,.14,.3,.14,'#5b7377',-.49,.15,0);const arm=new T.Group();arm.position.set(-.49,.32,0);book.add(arm);
    rod(arm,[0,0,0],[.28,.12,0],.035,mat('#e6ecdf'));rod(arm,[.28,.12,0],[.45,-.1,.1],.026,mat('#92c1bd'));dynamic(arm);pages.push(arm);
  }
  let lastMemoryKey=null,writingUntil=0,writingElapsed=0,memoryLines=[],data=null;
  function paintChalk(progress=1){chalk.paint((ctx,w,h)=>{
    ctx.fillStyle='#193c38';ctx.fillRect(0,0,w,h);ctx.fillStyle='#c6e4d2';ctx.font='bold 48px monospace';ctx.fillText('OFICINA DE SKILLS',42,70);
    ctx.strokeStyle='#72988b';ctx.beginPath();ctx.moveTo(42,92);ctx.lineTo(w-42,92);ctx.stroke();
    ctx.font='31px monospace';ctx.fillStyle='#f0ead2';memoryLines.forEach((line,i)=>ctx.fillText(line.slice(0,Math.floor(progress*line.length)),44,153+i*64));
    ctx.fillStyle='#90b4a4';ctx.font='23px monospace';ctx.fillText('Aprender. Anotar. Não perder o giz.',42,h-26);
  });}
  memoryLines=['Aguardando catálogo…'];paintChalk();

  box(world,25,3.95,.25,'#244347',0,6.4,-12.88);
  const activity=surface(world,24.55,3.57,0,6.4,-12.735,2048,360);
  function updateHeatmap(payload){
    activity.paint((ctx,w,h)=>{
      ctx.fillStyle='#102e32';ctx.fillRect(0,0,w,h);ctx.fillStyle='#d9f8df';ctx.font='bold 49px monospace';ctx.fillText('ATIVIDADE DO HERMES',42,59);
      ctx.font='26px monospace';ctx.fillStyle='#9bbdb1';ctx.fillText(payload.error?'FONTE INDISPONÍVEL':`${payload.total||0} eventos · últimos 365 dias · UTC`,990,57);
      const days=payload.days||[],offset=days.length?new Date(days[0].date+'T00:00:00Z').getUTCDay():0,colors=['#23484a','#326c60','#42927a','#76c996','#b8f2ac'];
      const step=34,size=26;for(let i=0;i<371;i++){const col=Math.floor(i/7),row=i%7;ctx.fillStyle='#1b3d40';ctx.fillRect(119+col*step,89+row*step,size,size);}
      days.forEach((day,i)=>{const pos=i+offset;ctx.fillStyle=colors[heatLevel(day.total,payload.max)];ctx.fillRect(119+Math.floor(pos/7)*step,89+(pos%7)*step,size,size);});
      ctx.font='19px monospace';ctx.fillStyle='#93b3a7';['D','S','T','Q','Q','S','S'].forEach((v,i)=>ctx.fillText(v,70,109+i*step));
    });
  }
  updateHeatmap({error:'aguardando',days:[]});
  dynamic(instruments); // preserve all gauge segments for live material updates
  function update(snapshot){
    data=instrumentData(snapshot);for(const [i,value]of [data.cpu,data.ram].entries()){const previous=gauges[i].value;gauge(gauges[i],value??previous??null,value===null&&previous!==null);}
    pipeStatus.paint((ctx,w,h)=>{ctx.fillStyle='#183a3f';ctx.fillRect(0,0,w,h);ctx.fillStyle='#d6f6ed';ctx.font='bold 41px monospace';ctx.fillText(data.primary.slice(0,37),30,57);ctx.font='32px monospace';ctx.fillStyle='#70dfff';ctx.fillText(data.eventAvailable?`→ ${data.outgoing} chamadas    ← ${data.incoming} respostas`:'SEM FONTE DE EVENTOS',30,115);ctx.fillStyle='#a2bbb5';ctx.font='24px monospace';ctx.fillText('REPLAY DA ÚLTIMA AMOSTRA / 3 MIN',30,174);});
    const key=JSON.stringify(data.memoryItems.map(d=>[d.name,d.modified]));
    if(lastMemoryKey!==null&&key!==lastMemoryKey||data.memoryEvents.length){writingUntil=performance.now()+6500;writingElapsed=0;}
    lastMemoryKey=key;
    memoryLines=data.memoryAvailable?[`${data.memoryCount} itens no catálogo`,...data.memoryItems.slice(0,3).map(d=>`${d.category==='skill'?'✧':'▤'} ${d.name}`.slice(0,43))]:['Catálogo indisponível','Conecte a pasta do Hermes.'];paintChalk();
  }
  let lastChalk=0;
  function tick(t,dt,paused){
    if(!data)return;
    for(const packet of packets){const count=packet.side<0?data.outgoing:data.incoming;packet.object.visible=packet.index<Math.min(6,count);if(packet.object.visible){let progress=(t*.13+packet.index/6)%1;if(packet.side>0)progress=1-progress;packet.object.position.copy(packet.path.getPoint(progress));packet.object.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),packet.path.getTangent(progress));}}
    const writing=!paused&&performance.now()<writingUntil;chalkTip.visible=writing;
    if(writing){writingElapsed+=dt;chalkTip.position.set(-1.9+(writingElapsed%2)*1.8,3.66-Math.floor(writingElapsed/2)%3*.33,-1.94);pages.forEach((p,i)=>{p.rotation.z=Math.sin(t*2+i)*.65;});if(t-lastChalk>.12){paintChalk(Math.min(1,writingElapsed/4));lastChalk=t;}}
  }
  return {update,tick,updateHeatmap,setStale(value){if(data)for(const g of gauges)gauge(g,g.value,value);},memoryActive:()=>performance.now()<writingUntil};
}
