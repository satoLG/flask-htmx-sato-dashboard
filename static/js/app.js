// Roteador das abas. Cada aba so e inicializada na primeira vez que aparece -
// nao adianta montar o cytoscape ou pedir o du do disco antes de alguem olhar.
import * as activity from "./tab-activity.js";
import * as vm from "./tab-vm.js";
import * as tools from "./tab-tools.js";
import * as mcps from "./tab-mcps.js";
import * as memory from "./tab-memory.js";
import * as rag from "./tab-rag.js";
import * as cron from "./tab-cron.js";

const TABS = {
  atividade: activity,
  vm: vm,
  tools: tools,
  mcps: mcps,
  memoria: memory,
  rag: rag,
  cron: cron,
};

const started = new Set();

function panelOf(name) { return document.getElementById(`panel-${name}`); }

function show(name) {
  if (!TABS[name]) name = "atividade";
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.setAttribute("aria-selected", btn.dataset.tab === name ? "true" : "false");
  });
  Object.keys(TABS).forEach((key) => {
    const panel = panelOf(key);
    if (panel) panel.hidden = key !== name;
  });
  // pausa o refresh da VM quando ela sai de vista
  if (name !== "vm" && started.has("vm") && vm.stop) vm.stop();
  if (!started.has(name)) {
    started.add(name);
    TABS[name].init(panelOf(name));
  } else if (name === "vm") {
    TABS.vm.init(panelOf("vm"));
  }
  const active = document.querySelector(`[data-tab="${name}"]`);
  if (active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function currentTab() {
  return (location.hash || "").replace(/^#\/?/, "") || "atividade";
}

document.querySelectorAll("[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => { location.hash = `#/${btn.dataset.tab}`; });
});
window.addEventListener("hashchange", () => show(currentTab()));

// exposto para o filtro de trigger do htmx no painel ao vivo
window.hermesActivityVisible = () => {
  const panel = panelOf("atividade");
  return !!panel && !panel.hidden;
};

show(currentTab());
