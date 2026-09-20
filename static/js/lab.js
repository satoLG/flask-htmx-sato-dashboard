// The UI keeps working if WebGL fails. All telemetry text is inserted as text,
// never HTML; logs, task names and questions are untrusted input.
const $ = id => document.getElementById(id);
const SECTORS = [
  ['hermes', 'Núcleo Hermes', '◎', 'AGENTES & SUBAGENTES'],
  ['models', 'Providers', '⤨', 'ROTEAMENTO DE MODELOS'],
  ['mcp', 'Conexões MCP', '⌘', 'FERRAMENTAS CONECTADAS'],
  ['rag', 'Arquivo RAG', '▥', 'CONHECIMENTO VETORIAL'],
  ['memory', 'Memória & skills', '◈', 'CONTEXTO PERSISTENTE'],
  ['cron', 'Agendamentos', '◷', 'ROTINAS AUTOMÁTICAS'],
  ['vm', 'Infraestrutura', '▤', 'RECURSOS DA VM'],
];
const KINDS = {guide: 'Guia do setor', agent: 'Registro de agente', subagent: 'Registro de subagente', process: 'Processo da VM', service: 'Servidor MCP', job: 'Cron job'};
let state = null, selectedSector = 'hermes', selectedRobot = null, scene = null;
let inFlight = false, timer = null, lastSuccess = 0, chatBusy = false, opener = null;
const histories = new Map();
const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
const sectorName = id => SECTORS.find(s => s[0] === id)?.[1] || id;
const clock = value => { const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(String(value)) ? value : `${String(value).replace(' ', 'T')}Z`); return Number.isNaN(+date) ? '—' : date.toLocaleTimeString('pt-BR'); };

for (const [id, name, symbol, subtitle] of SECTORS) {
  const button = node('button', 'sector-button'); button.type = 'button'; button.dataset.sector = id;
  button.setAttribute('aria-pressed', String(id === selectedSector));
  const content = node('span'); content.append(node('strong', '', name), node('small', '', subtitle));
  const dot = node('i', 'sector-dot'); dot.dataset.dot = id;
  button.append(node('span', 'sector-symbol', symbol), content, dot);
  button.addEventListener('click', () => selectSector(id)); $('sectors').append(button);
  const label = node('button', 'station-label'); label.type = 'button'; label.dataset.label = id;
  label.setAttribute('aria-label', `Visitar ${name}`); label.setAttribute('aria-pressed', 'false');
  const labelDot = node('i', 'sector-dot'); labelDot.dataset.dot = id;
  label.append(labelDot, document.createTextNode(name.toUpperCase()));
  label.addEventListener('click', () => { selectSector(id); openChat(`guide:${id}`, label); });
  $('scene-labels').append(label);
}

function selectSector(id) {
  selectedSector = id;
  document.querySelectorAll('[data-sector]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.sector === id)));
  document.querySelectorAll('[data-label]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.label === id)));
  $('welcome-note').hidden = true; scene?.focusSector(id); renderRoster();
}

function renderRoster() {
  $('roster-title').textContent = `ROBÔS / ${sectorName(selectedSector).toUpperCase()}`;
  const workers = state?.workers.filter(w => w.sector === selectedSector) || [];
  $('roster-count').textContent = String(workers.length);
  const items = workers.map(w => {
    const button = node('button', 'robot-button', `${w.kind === 'guide' ? '◎' : '◉'} ${w.name}`);
    button.type = 'button'; button.dataset.robot = w.id;
    button.append(node('small', '', `${KINDS[w.kind]} · ${w.status_label}`));
    button.addEventListener('click', () => openChat(w.id, button)); return button;
  });
  // Preserve keyboard focus across polling updates.
  const focused = document.activeElement?.dataset.robot;
  $('roster').replaceChildren(...items);
  if (focused) items.find(b => b.dataset.robot === focused)?.focus();
}

function renderState(data) {
  state = data; lastSuccess = Date.now();
  $('connection').dataset.state = data.telemetry_available ? 'live' : 'partial';
  $('connection').lastElementChild.textContent = data.telemetry_available ? 'Telemetria conectada' : 'Telemetria parcial';
  $('metric-processes').textContent = data.metrics.processes;
  $('metric-events').textContent = data.metrics.recent_events;
  $('metric-cpu').textContent = data.metrics.cpu === null ? '—' : `${data.metrics.cpu}%`;
  $('metric-memory').textContent = data.metrics.memory === null ? '—' : `${data.metrics.memory}%`;
  $('sync-note').textContent = `Leitura ${clock(data.now)} · a cada 5 s`;
  for (const w of data.workers.filter(w => w.kind === 'guide')) {
    document.querySelectorAll('[data-dot]').forEach(el => { if (el.dataset.dot === w.sector) el.dataset.status = w.status; });
  }
  $('event-count').textContent = `${data.events.length} EVENTOS`;
  const events = data.events.map(e => {
    const row = node('div', `event-row${e.ok === false ? ' failed' : ''}`);
    row.append(node('i'), node('span', '', e.name), node('time', '', clock(e.when))); return row;
  });
  $('events').replaceChildren(...(events.length ? events : [node('p', 'empty', data.telemetry_available ? 'Nenhum evento nos últimos 3 minutos. O laboratório está aguardando atividade.' : 'Sem fonte de eventos conectada neste host. Os setores continuam disponíveis para exploração.')]));
  $('warnings').replaceChildren(...data.warnings.map(w => node('li', '', w)));
  $('source-summary').textContent = data.warnings.length ? `Fontes e disponibilidade · ${data.warnings.length} observações` : 'Fontes e disponibilidade · leituras disponíveis';
  renderRoster(); scene?.update(data);
  if (selectedRobot) {
    const current = data.workers.find(w => w.id === selectedRobot);
    $('chat-status').textContent = current ? current.status_label : 'Não está mais no snapshot';
  }
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(25000)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function poll() {
  if (inFlight || document.hidden) return;
  clearTimeout(timer); inFlight = true;
  try { renderState(await fetchJSON('/api/lab/state')); }
  catch {
    $('connection').dataset.state = 'offline'; $('connection').lastElementChild.textContent = 'Sem conexão';
    $('sync-note').textContent = lastSuccess ? 'Dados desatualizados · tentando reconectar' : 'VM indisponível · tentando reconectar';
    scene?.setStale(true);
    document.querySelectorAll('[data-dot]').forEach(el => el.dataset.status = 'unknown');
    if (selectedRobot) $('chat-status').textContent = 'Dados desatualizados';
  } finally { inFlight = false; if (!document.hidden) timer = setTimeout(poll, 5000); }
}
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer); scene?.clearKeys();
  if (!document.hidden) { if (lastSuccess && Date.now() - lastSuccess > 15000) scene?.setStale(true); poll(); }
});

function renderMessages() {
  const entries = histories.get(selectedRobot) || [];
  $('chat-messages').replaceChildren(...entries.map(entry => {
    const el = node('div', `message ${entry.role}`, entry.text);
    if (entry.source) el.append(node('small', '', `${entry.source}\nLeitura: ${clock(entry.when)}${entry.catalog ? ` · catálogo: ${clock(entry.catalog)}` : ''}`));
    return el;
  }));
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
}

function openChat(id, source = document.activeElement) {
  const robot = state?.workers.find(w => w.id === id);
  if (!robot) return;
  opener = source; selectedRobot = id; selectedSector = robot.sector;
  selectSector(robot.sector); scene?.selectRobot(id);
  $('chat').hidden = false; $('chat-name').textContent = robot.name;
  $('chat-sector').textContent = sectorName(robot.sector).toUpperCase();
  $('chat-status').textContent = $('connection').dataset.state === 'offline' ? 'Dados desatualizados' : robot.status_label;
  $('chat-kind').textContent = KINDS[robot.kind];
  if (!histories.has(id)) histories.set(id, [{role: 'robot', text: `Olá! Sou ${robot.name}. ${robot.description || robot.detail}${robot.parent_id ? `\nExecução pai: ${robot.parent_id}` : ''}\n\nPode me perguntar sobre minha função, atividade, dados ou falhas.`, source: robot.source, when: state.now}]);
  renderMessages(); scene?.clearKeys(); $('chat-close').focus();
}

function closeChat() { $('chat').hidden = true; selectedRobot = null; if (opener?.isConnected) opener.focus(); else $('scene').focus(); }
$('chat-close').addEventListener('click', closeChat);
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeChat(); $('help-panel').hidden = true; $('help-toggle').setAttribute('aria-expanded', 'false'); } });

async function ask(question) {
  if (!selectedRobot || chatBusy || !question.trim()) return;
  const id = selectedRobot; const history = histories.get(id);
  history.push({role: 'user', text: question.trim()}); renderMessages();
  $('chat-input').value = ''; chatBusy = true;
  document.querySelectorAll('#chat-form button, [data-question]').forEach(el => el.disabled = true);
  try {
    const result = await fetchJSON('/api/lab/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({robot_id: id, question})});
    history.push({role: 'robot', text: result.answer, source: result.source, when: result.observed_at, catalog: result.catalog_sampled_at});
  } catch (error) { history.push({role: 'robot', text: `Não consegui consultar a telemetria. ${error.message}. Tente novamente.`}); }
  finally {
    if (history.length > 60) history.splice(0, history.length - 60);
    chatBusy = false; document.querySelectorAll('#chat-form button, [data-question]').forEach(el => el.disabled = false);
    if (selectedRobot === id) renderMessages();
  }
}
$('chat-form').addEventListener('submit', event => { event.preventDefault(); ask($('chat-input').value); });
document.querySelectorAll('[data-question]').forEach(el => el.addEventListener('click', () => ask(el.dataset.question)));
$('help-toggle').addEventListener('click', () => { $('help-panel').hidden = !$('help-panel').hidden; $('help-toggle').setAttribute('aria-expanded', String(!$('help-panel').hidden)); });
$('start-explore').addEventListener('click', () => { selectSector('hermes'); $('scene').focus(); });
$('zoom-in').addEventListener('click', () => scene?.zoom(-1));
$('zoom-out').addEventListener('click', () => scene?.zoom(1));
$('reset-view').addEventListener('click', () => scene?.reset());
$('motion-toggle').addEventListener('click', () => {
  const paused = $('motion-toggle').getAttribute('aria-pressed') !== 'true';
  $('motion-toggle').setAttribute('aria-pressed', String(paused));
  $('motion-toggle').setAttribute('aria-label', paused ? 'Retomar animações' : 'Pausar animações');
  $('motion-toggle').textContent = paused ? '▷' : 'Ⅱ'; scene?.setPaused(paused);
});

poll();
try {
  const {createLabScene} = await import('./lab-scene.js');
  scene = createLabScene($('scene'), {onRobot: id => openChat(id), onPosition: (x, z) => $('coordinates').textContent = `X ${x.toFixed(1)} · Z ${z.toFixed(1)}`});
  if (state) scene.update(state);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) $('motion-toggle').click();
  document.querySelectorAll('[data-move]').forEach(button => {
    button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); scene.setKey(button.dataset.move, true); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => scene.setKey(button.dataset.move, false));
  });
  $('interact').addEventListener('click', () => scene.interact());
} catch (error) { console.warn('Laboratório 3D indisponível:', error); $('scene-fallback').hidden = false; $('scene-labels').hidden = true; $('welcome-note').hidden = true; }
finally { $('loading').hidden = true; }
