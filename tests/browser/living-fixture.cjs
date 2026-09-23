// Explicitly synthetic data, confined to browser tests and visual QA.
async function livingFixture(page,request){
  const state=await(await request.get('/api/lab/state')).json();
  state.telemetry_available=true;state.metrics.cpu=38;state.metrics.memory=72;
  state.workers.push(...['skills','memory'].map(id=>({id:`catalog:${id}`,name:`Arquivista ${id}`,sector:'memory',kind:'catalog',status:'observed',status_label:'Catálogo observado',detail:'Catálogo de teste',source:'fixture'})));
  state.visuals={providers:{primary:'OpenRouter / modelo de teste'},memory:{available:true,count:12,items:['pesquisa-rag','github-tools','memoria-projeto','revisao'].map(name=>({name,category:'skill',modified:Date.now()/1000}))}};
  state.events=[{kind:'model',sector:'models',name:'Consulta de teste',when:new Date().toISOString(),ok:true,input_tokens:200,output_tokens:90},{kind:'tool',sector:'memory',name:'Registrar skill de teste',when:new Date().toISOString(),ok:true}];
  const docs=Array.from({length:30},(_,i)=>({id:`doc:${i}`,kind:'doc',label:['Conexões MCP','Memória do Hermes','Busca por similaridade','Roteamento de modelos'][i%4]+` / ${i+1}`,expandable:false,repo:'ensaio/hermes',preview:`Trecho de teste ${i+1}: contexto e ferramentas.`}));
  const root={nodes:[{id:'root',kind:'root',label:'Catálogo de teste',count:30,expandable:true},{id:'repo:ensaio/hermes',kind:'repo',label:'ensaio/hermes',count:30,expandable:true}],edges:[{source:'root',target:'repo:ensaio/hermes'}]};
  const category={nodes:[{id:'cat:ensaio/hermes:doc',kind:'category',label:'Documentação',count:30,expandable:true}],edges:[{source:'repo:ensaio/hermes',target:'cat:ensaio/hermes:doc'}]};
  const heat={days:Array.from({length:365},(_,i)=>({date:new Date(Date.UTC(2025,8,23+i)).toISOString().slice(0,10),total:i%8===0?0:(i*13)%33})),max:32,total:5460};
  const queries=[];
  await page.route('**/api/lab/state',route=>route.fulfill({json:state}));
  await page.route('**/api/activity/heatmap?**',route=>route.fulfill({json:heat}));
  await page.route('**/api/rag/graph*',route=>{const parent=new URL(route.request().url()).searchParams.get('parent');return route.fulfill({json:!parent?root:parent.startsWith('repo:')?category:{nodes:docs,edges:docs.map(d=>({source:category.nodes[0].id,target:d.id}))}});});
  await page.route('**/api/rag/search?**',route=>{
    const q=new URL(route.request().url()).searchParams.get('q');queries.push(q);
    const hits=docs.slice(0,3).map((d,i)=>({...d,title:d.label,distance:.12+i*.2,score:1-i*.5}));
    return route.fulfill({json:{hits,graph:{nodes:[{id:'query',kind:'query',label:q},...hits],edges:hits.map(d=>({source:'query',target:d.id,score:d.score}))}}});
  });
  return {state,queries};
}
module.exports={livingFixture};
