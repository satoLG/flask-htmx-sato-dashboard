// The canvas owns space and interaction. These overlays only present telemetry.
import {createRagUI} from './lab-rag-ui.js';
const $ = id => document.getElementById(id);
const SECTORS = [['hermes','NÚCLEO','◎'],['models','PROVIDERS','⤨'],['mcp','MCP','⌘'],['rag','RAG','▥'],['memory','SKILLS','◈'],['cron','CRON','◷'],['vm','VM','▤']];
const KINDS = {guide:'Responsável pela estação',agent:'Agente',subagent:'Subagente',process:'Processo da VM',service:'Servidor MCP',job:'Cron job',catalog:'Representação do catálogo'};
const name = id => SECTORS.find(s => s[0] === id)?.[1] || 'EXPLORANDO';
const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
const clock = value => { const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(String(value)) ? value : `${String(value).replace(' ','T')}Z`); return Number.isNaN(+d) ? '—' : d.toLocaleTimeString('pt-BR'); };
let scene = null, state = null, sector = 'hermes', selectedRobot = null, inFlight = false, timer = null, lastSuccess = 0, chatBusy = false, toastTimer;
let webChatMode='loading',webChatCsrf=null,chatPollTimer=null;
const histories = new Map();
const ragUI=createRagUI(()=>scene,fetchJSON);
function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
function closePanel(id) { $(id).hidden = true; $(id === 'map-panel' ? 'map-toggle' : 'telemetry-toggle').setAttribute('aria-expanded','false'); }
function closePanels() { closePanel('map-panel'); closePanel('telemetry-panel'); }
for (const [id, label, symbol] of SECTORS) {
  const button = node('button','sector-button'); button.type = 'button'; button.dataset.sector = id; button.setAttribute('aria-pressed',String(id === sector));
  button.append(node('span','',symbol),node('strong','',label));
  button.addEventListener('click', () => { sector = id; renderRoster(); visit(`guide:${id}`); }); $('sectors').append(button);
}
for (const id of ['map','telemetry']) $(id + '-toggle').addEventListener('click', () => {
  const opening = $(id + '-panel').hidden; closePanels(); $(id + '-panel').hidden = !opening; $(id + '-toggle').setAttribute('aria-expanded',String(opening)); scene?.stopWalking();
});
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closePanel(b.dataset.close)));
function visit(id) {
  if (!scene) { toast('A exploração precisa de WebGL 2.'); return; }
  closePanels(); scene.visitRobot(id); $('scene').focus({preventScroll:true});
}
function renderRoster() {
  document.querySelectorAll('[data-sector]').forEach(el => el.setAttribute('aria-pressed',String(el.dataset.sector === sector)));
  $('roster-title').textContent = name(sector);
  const workers = state?.workers.filter(w => w.sector === sector) || []; $('roster-count').textContent = workers.length;
  const focused = document.activeElement?.dataset.robot;
  const items = workers.map(w => {
    const b = node('button','robot-button',`${w.kind === 'guide' ? '◎' : '◉'} ${w.name}`); b.type = 'button'; b.dataset.robot = w.id;
    b.append(node('small','',`${KINDS[w.kind]} · ${w.status_label}`)); b.addEventListener('click', () => visit(w.id)); return b;
  }); $('roster').replaceChildren(...items); if (focused) items.find(b => b.dataset.robot === focused)?.focus({preventScroll:true});
}
function renderState(data) {
  state = data; lastSuccess = Date.now();
  $('connection').dataset.state = data.telemetry_available ? 'live' : 'partial'; $('connection').lastElementChild.textContent = data.telemetry_available ? 'Telemetria conectada' : 'Telemetria parcial';
  $('metric-processes').textContent = data.metrics.processes; $('metric-events').textContent = data.metrics.recent_events;
  $('metric-cpu').textContent = data.metrics.cpu === null ? '—' : `${data.metrics.cpu}%`;
  $('metric-memory').textContent = data.metrics.memory === null ? '—' : `${data.metrics.memory}%`;
  $('sync-note').textContent = `Leitura ${clock(data.now)} · a cada 5 s`;
  const events = data.events.map(e => { const row = node('div',`event-row${e.ok === false ? ' failed' : ''}`); row.append(node('i'),node('span','',e.name),node('time','',clock(e.when))); return row; });
  $('events').replaceChildren(...(events.length ? events : [node('p','empty',data.telemetry_available ? 'Nenhum evento nos últimos 3 minutos.' : 'Sem fonte de eventos conectada neste host.')]));
  $('warnings').replaceChildren(...data.warnings.map(w => node('li','',w)));
  $('source-summary').textContent = `Fontes e disponibilidade · ${data.warnings.length} observações`;
  scene?.update(data); renderRoster();
  if (selectedRobot) {
    const current = data.workers.find(w => w.id === selectedRobot);
    if (!current) { closeChat(); toast('Este robô não está mais na telemetria atual.'); }
    else $('chat-status').textContent = current.status_label;
  }
}
async function fetchJSON(url, options = {}) {
  const {timeout=25000,...init}=options;
  const response = await fetch(url,{...init,signal:AbortSignal.timeout(timeout)}); const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data;
}
async function poll() {
  if (inFlight || document.hidden) return; clearTimeout(timer); inFlight = true;
  try { renderState(await fetchJSON('/api/lab/state')); }
  catch { $('connection').dataset.state = 'offline'; $('connection').lastElementChild.textContent = 'Sem conexão'; $('sync-note').textContent = lastSuccess ? 'Dados desatualizados · tentando reconectar' : 'VM indisponível · tentando reconectar'; scene?.setStale(true); if (selectedRobot) $('chat-status').textContent = 'Dados desatualizados'; }
  finally { inFlight = false; if (!document.hidden) timer = setTimeout(poll,5000); }
}
document.addEventListener('visibilitychange', () => { clearTimeout(timer); scene?.stopWalking(); if (!document.hidden) { if (lastSuccess && Date.now() - lastSuccess > 15000) scene?.setStale(true); poll(); } });
function messages() {
  $('chat-messages').replaceChildren(...(histories.get(selectedRobot) || []).map(entry => {
    const el = node('div',`message ${entry.role}`,entry.text);
    if (entry.source) el.append(node('small','',`${entry.source} · ${clock(entry.when)}${entry.catalog ? ` · catálogo ${clock(entry.catalog)}` : ''}`)); return el;
  })); $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
}
function chatMode(mode){
  webChatMode=mode;
  $('chat-login').hidden=mode!=='locked';
  $('chat-form').hidden=mode==='locked'||mode==='loading';
  document.querySelector('.chat-suggestions').hidden=mode==='locked'||mode==='loading';
  $('chat-mode').textContent=mode==='private'?'Hermes · perguntas informativas · fila persistente':mode==='local'?'telemetria local':mode==='locked'?'acesso privado ao Hermes':'conectando ao Hermes';
  if(mode==='locked')$('chat-password').focus({preventScroll:true});
}
async function loadChatSession(id){
  chatMode('loading');
  try{
    const info=await fetchJSON('/api/lab/hermes-chat/session');
    if(selectedRobot!==id)return;
    if(!info.available){chatMode('local');return;}
    webChatCsrf=info.csrf;
    chatMode(info.authenticated?'private':'locked');
    if(info.authenticated)loadChatHistory(id);
  }catch{if(selectedRobot===id){chatMode('locked');$('chat-login-note').textContent='Sem conexão com o chat privado. Tente novamente.';}}
}
async function loadChatHistory(id){
  if(webChatMode!=='private')return;
  clearTimeout(chatPollTimer);
  try{
    const data=await fetchJSON(`/api/lab/hermes-chat/history?robot_id=${encodeURIComponent(id)}`);
    if(selectedRobot!==id)return;
    const intro=histories.get(id)?.[0];
    const history=intro?[intro]:[];
    for(const job of data.jobs){
      history.push({role:'user',text:job.question,when:new Date(job.created_at*1000).toISOString()});
      const text=job.status==='done'?job.answer:job.status==='failed'?job.error:job.status==='running'?'Hermes está respondendo…':'Pergunta guardada na fila. Aguardando Hermes…';
      history.push({role:'robot',text,source:job.status==='done'?'Hermes · sem ferramentas':null,when:new Date(job.updated_at*1000).toISOString()});
    }
    histories.set(id,history);messages();
    const pending=data.jobs.some(j=>j.status==='queued'||j.status==='running');
    $('chat-queue').hidden=!pending;$('chat-queue').textContent=pending?'Sua pergunta está salva. Você pode sair e voltar; a resposta aparecerá aqui.':'';
    if(pending)chatPollTimer=setTimeout(()=>loadChatHistory(id),3000);
  }catch(error){if(selectedRobot===id){$('chat-queue').hidden=false;$('chat-queue').textContent=`Não consegui ler a fila: ${error.message}`;chatPollTimer=setTimeout(()=>loadChatHistory(id),5000);}}
}
function openChat(id) {
  const robot = state?.workers.find(w => w.id === id);
  // There is no menu shortcut around proximity. The scene validates again here.
  if (!robot || !scene?.beginChat(id)) return;
  selectedRobot = id; sector = robot.sector; closePanels(); $('interaction').hidden = true;
  document.body.dataset.chat = 'true'; $('chat').hidden = false;
  document.querySelectorAll('.hud-top,.hud-bottom,.overlay').forEach(el => el.inert = true);
  $('chat-name').textContent = robot.name; $('chat-sector').textContent = name(robot.sector);
  $('chat-status').textContent = $('connection').dataset.state === 'offline' ? 'Dados desatualizados' : robot.status_label;
  $('chat-kind').textContent = KINDS[robot.kind];
  if (!histories.has(id)) histories.set(id,[{role:'robot',text:`Olá! Sou ${robot.name}. ${robot.description || robot.detail}${robot.parent_id ? `\nExecução pai: ${robot.parent_id}` : ''}`,source:robot.source,when:state.now}]);
  messages(); loadChatSession(id); $('chat-close').focus({preventScroll:true});
}
function closeChat() {
  if (!selectedRobot) return; clearTimeout(chatPollTimer);$('chat-queue').hidden=true;$('chat').hidden = true; selectedRobot = null; document.body.dataset.chat = 'false';
  document.querySelectorAll('.hud-top,.hud-bottom,.overlay').forEach(el => el.inert = false);
  scene?.endChat(); $('scene').focus({preventScroll:true});
}
$('chat-close').addEventListener('click',closeChat);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeChat(); closePanels(); }
  if (e.key === 'Tab' && selectedRobot) {
    const focusable = [...$('chat').querySelectorAll('button:not(:disabled),input:not(:disabled)')];
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
async function ask(question) {
  if (!selectedRobot || chatBusy || !question.trim() || webChatMode==='locked'||webChatMode==='loading') return;
  const id = selectedRobot, history = histories.get(id); history.push({role:'user',text:question.trim()}); messages(); $('chat-input').value = ''; chatBusy = true;
  scene?.emote('question'); document.querySelectorAll('#chat-form button,[data-question]').forEach(el => el.disabled = true);
  try {
    if(webChatMode==='private'){
      await fetchJSON('/api/lab/hermes-chat/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-Chat-CSRF':webChatCsrf},body:JSON.stringify({robot_id:id,question})});
      if(selectedRobot===id)await loadChatHistory(id);
    }else{
      const reply=await fetchJSON('/api/lab/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({robot_id:id,question})});
      history.push({role:'robot',text:reply.answer,source:reply.source,when:reply.observed_at,catalog:reply.catalog_sampled_at});
      if(selectedRobot===id)scene?.emote('answer');
    }
  }
  catch (error) { history.push({role:'robot',text:`Não consegui consultar a telemetria. ${error.message}`}); if (selectedRobot === id) scene?.emote('error'); }
  finally { if (history.length > 60) history.splice(0,history.length - 60); chatBusy = false; document.querySelectorAll('#chat-form button,[data-question]').forEach(el => el.disabled = false); if (selectedRobot === id) messages(); }
}
$('chat-login').addEventListener('submit',async e=>{
  e.preventDefault();const password=$('chat-password').value;
  try{const info=await fetchJSON('/api/lab/hermes-chat/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});$('chat-password').value='';webChatCsrf=info.csrf;chatMode('private');if(selectedRobot)loadChatHistory(selectedRobot);}
  catch(error){$('chat-login-note').textContent=error.message;}
});
$('chat-form').addEventListener('submit', e => { e.preventDefault(); ask($('chat-input').value); });
document.querySelectorAll('[data-question]').forEach(el => el.addEventListener('click', () => ask(el.dataset.question)));
$('interaction').addEventListener('click', () => scene?.interact());
for (const mode of ['follow','room']) $('camera-' + mode).addEventListener('click', () => scene?.setCameraMode(mode));
$('motion-toggle').addEventListener('click', () => { const paused = $('motion-toggle').getAttribute('aria-pressed') !== 'true'; $('motion-toggle').setAttribute('aria-pressed',String(paused)); $('motion-toggle').textContent = paused ? 'Retomar animações' : 'Pausar animações'; scene?.setPaused(paused); });
poll();
try {
  const {createLabScene} = await import('./lab-scene.js');
  scene = createLabScene($('scene'),{
    onInteract:openChat, onToast:toast,onRagNode:n=>ragUI.select(n),
    onCamera:mode => { for (const id of ['follow','room']) $('camera-' + id).setAttribute('aria-pressed',String(id === mode)); $('scene').dataset.camera = mode; },
    onLocation:id => { $('rag-action').hidden=id!=='rag';$('location-name').textContent = name(id); if (id && id !== sector) { sector = id; renderRoster(); } },
    onCandidate:robot => { $('interaction').hidden = !robot || !!selectedRobot; $('interaction').dataset.robot = robot?.id || ''; $('interaction-name').textContent = robot ? `${name(robot.sector)} / ${robot.name}` : ''; },
    onPosition:(x,z) => { $('scene').dataset.x = x.toFixed(3); $('scene').dataset.z = z.toFixed(3); },
    onLostContext:lost => { $('scene-fallback').hidden = !lost; if (lost) closeChat(); },
  });
  if (state) scene.update(state);
  ragUI.loadBase();
  let lastHeat=null,heatBusy=false;
  async function refreshInstruments(){
    if(document.hidden||heatBusy)return;heatBusy=true;
    try{const data=await fetchJSON('/api/activity/heatmap?days=365');if(data.error&&lastHeat)scene.updateHeatmap({...lastHeat,error:data.error});else{lastHeat=data;scene.updateHeatmap(data);}}catch{if(lastHeat)scene.updateHeatmap({...lastHeat,error:'Sem conexão'});}finally{heatBusy=false;}
  }
  refreshInstruments();setInterval(refreshInstruments,15000);setInterval(()=>{if(!document.hidden&&!ragUI.open)ragUI.loadBase();},60000);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) $('motion-toggle').click();
  $('scene').focus({preventScroll:true});
} catch (error) { console.warn('Laboratório 3D indisponível:',error); $('scene-fallback').hidden = false; }
finally { $('loading').hidden = true; }
