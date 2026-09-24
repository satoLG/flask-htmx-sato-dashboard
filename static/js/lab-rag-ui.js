export function createRagUI(getScene,fetchJSON){
  const $=id=>document.getElementById(id),catalog=new Map();let open=false,generation=0,loaded=false;
  const message=text=>$('rag-summary').textContent=text;
  function showNode(n){
    getScene()?.selectRagNode(n.id);document.querySelectorAll('.rag-node').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.node===n.id))); $('rag-node-title').textContent=n.label||n.id;
    $('rag-node-detail').textContent=[n.repo,n.doc_type,n.count!==undefined?`${n.count} documentos`:null,n.distance!==undefined?`Distância vetorial: ${Number(n.distance).toFixed(4)}`:null,n.preview].filter(Boolean).join('\n\n')||'Selecione um ramo para ver seus documentos.';
  }
  function render(nodes){
    catalog.clear();nodes.forEach(n=>catalog.set(n.id,n));
    $('rag-node-list').replaceChildren(...nodes.map(n=>{const b=document.createElement('button');b.type='button';b.dataset.node=n.id;b.className='rag-node';b.textContent=`${n.kind==='doc'?'·':n.expandable?'+':'◎'} ${n.label}`;b.addEventListener('click',()=>select(n));return b;}));
    $('rag-node-count').textContent=`${nodes.length} nós`;
  }
  function accept(payload,options){const nodes=getScene()?.setRagGraph(payload,options)||[];render(nodes);return nodes;}
  async function select(n){
    showNode(n);if(!n.expandable||n.kind==='root')return;
    getScene()?.setRagBusy(false);$('rag-search-submit').disabled=false;
    const turn=++generation;message('Abrindo ramo…');
    try{const data=await fetchJSON(`/api/rag/graph?parent=${encodeURIComponent(n.id)}`);if(turn!==generation)return;if(data.error)throw Error(data.error);accept(data);message(data.truncated?`${data.truncated} documentos adicionais neste ramo; até 180 nós visíveis.`:'Ramo aberto. Selecione um documento para ler o trecho.');}
    catch(e){if(turn===generation)message(e.message);}
  }
  async function loadBase(){
    const scene=getScene();if(!scene)return;const turn=++generation;message('Lendo a base vetorial…');
    scene.setRagBusy(false);$('rag-search-submit').disabled=false;
    try{
      const root=await fetchJSON('/api/rag/graph');if(turn!==generation)return;if(root.error)throw Error(root.error);
      accept(root,{replace:true});loaded=true;
      const repos=root.nodes.filter(n=>n.kind==='repo').slice(0,3);
      const branches=await Promise.all(repos.map(n=>fetchJSON(`/api/rag/graph?parent=${encodeURIComponent(n.id)}`)));
      if(turn!==generation)return;for(const b of branches)if(!b.error)accept(b);
      const category=branches.flatMap(b=>b.nodes||[]).find(n=>n.kind==='category');
      if(category){const documents=await fetchJSON(`/api/rag/graph?parent=${encodeURIComponent(category.id)}`);if(turn!==generation)return;if(!documents.error)accept(documents);}
      message('Mapa do catálogo. Toque nos pontos ou escolha um nó abaixo.');
    }catch(e){if(turn===generation)message((loaded?'Última leitura preservada. ':'')+e.message);}
  }
  async function search(term){
    if(!term.trim())return;const turn=++generation;getScene()?.setRagBusy(true);$('rag-search-submit').disabled=true;message('Calculando embedding e consultando a base…');
    try{
      const data=await fetchJSON(`/api/rag/search?q=${encodeURIComponent(term.trim())}&limit=12`,{timeout:90000});
      if(turn!==generation)return;if(data.error)throw Error(data.error);
      accept(data.graph||{nodes:[],edges:[]},{replace:true,search:true});
      message(`${data.hits?.length||0} resultados reais. Os pulsos ilustram consulta → repositório → documento.`);
      const first=data.graph?.nodes.find(n=>n.kind==='doc');if(first)showNode(first);else{$('rag-node-title').textContent='Nenhum resultado';$('rag-node-detail').textContent='Tente outra pergunta.';}
    }catch(e){if(turn===generation)message('Não foi possível buscar. '+e.message);}
    finally{if(turn===generation){getScene()?.setRagBusy(false);$('rag-search-submit').disabled=false;}}
  }
  function setOpen(value){
    if(value&&!getScene()?.setRagOpen(true))return;
    if(!value)getScene()?.setRagOpen(false);open=value;$('rag-panel').hidden=!value;document.body.dataset.rag=String(value);
    document.querySelectorAll('.hud-top,.hud-bottom,#map-panel,#telemetry-panel').forEach(el=>el.inert=value);
    if(value){$('map-panel').hidden=true;$('telemetry-panel').hidden=true;$('rag-query').focus({preventScroll:true});if(!loaded)loadBase();}else $('scene').focus({preventScroll:true});
  }
  $('rag-action').addEventListener('click',()=>setOpen(true));$('rag-close').addEventListener('click',()=>setOpen(false));
  $('rag-reset').addEventListener('click',()=>{getScene()?.setRagBusy(false);$('rag-search-submit').disabled=false;loadBase();});
  $('rag-search').addEventListener('submit',e=>{e.preventDefault();search($('rag-query').value);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open)setOpen(false);});
  return {select,loadBase,get open(){return open;}};
}
