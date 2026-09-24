import * as T from '../vendor/three.module.min.js';
import {CSS3DRenderer,CSS3DSprite} from '../vendor/CSS3DRenderer.js';

export function createDialogue(container){
  const renderer=new CSS3DRenderer(),scene=new T.Scene();
  renderer.domElement.className='dialogue-layer';container.append(renderer.domElement);
  const panels={};let history=[],name='',active=false;
  for(const role of ['user','robot']){
    const el=document.createElement('section');el.className=`speech-anchor ${role}`;el.setAttribute('aria-label',role==='user'?'Sua fala':'Resposta do robô');
    const card=document.createElement('div');card.className='speech-card';
    const title=document.createElement('strong'),body=document.createElement('div');body.className='speech-text';body.tabIndex=0;
    card.append(title,body);el.append(card);const sprite=new CSS3DSprite(el);scene.add(sprite);panels[role]={sprite,el,card,title,body,key:''};
  }
  function setMessages(entries,robotName){history=entries;name=robotName;
    for(const role of ['user','robot']){
      const p=panels[role],entry=entries.findLast(e=>e.role===role),text=entry?.text||(role==='user'?'Sua vez! Escolha uma pergunta abaixo.':'Olá!');
      p.title.textContent=role==='user'?'SATO / VOCÊ':name;
      if(text!==p.key){p.key=text;p.body.textContent=text;p.body.scrollTop=0;p.card.getAnimations().forEach(a=>a.cancel());
        if(!matchMedia('(prefers-reduced-motion: reduce)').matches)p.card.animate([{transform:'scale(.65) rotate(-4deg)',opacity:0},{transform:'scale(1.045) rotate(1deg)',opacity:1},{transform:'scale(1) rotate(0)'}],{duration:320,easing:'ease-out'});
      }
    }
  }
  return {setMessages,setOpen(value){active=value;renderer.domElement.hidden=!value;},resize(w,h){renderer.setSize(w,h);},render(camera,avatar,robot){
    if(!active||!robot)return;
    const right=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,0),width=container.clientWidth,mobile=width<700;
    for(const [role,actor]of [['user',avatar],['robot',robot]]){
      const p=panels[role],distance=camera.position.distanceTo(actor.position),scale=distance*2*Math.tan(T.MathUtils.degToRad(camera.fov/2))/container.clientHeight;
      p.el.style.width=`${mobile?Math.min(225,width*.46):320}px`;
      p.sprite.position.copy(actor.position).add(new T.Vector3(0,role==='robot'?4.8:4.15,0));
      p.sprite.position.addScaledVector(right,(role==='user'?-1:1)*(mobile?width*.19:170)*scale);
      p.sprite.scale.setScalar(scale*(mobile?.85:1));
    }
    renderer.render(scene,camera);
  }};
}
