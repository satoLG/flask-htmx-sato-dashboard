// Aba 2: VM - CPU (agregado e por core), memoria, swap, discos e o que ocupa espaco.
import { h, fmt, render, load, empty, table, notice, statusClass } from "./core.js";
import { bars, meter, stat, seriesColor } from "./charts.js";

let refs = {};
let timer = null;

export function init(root) {
  refs = { body: root.querySelector("[data-role=vm]") };
  refresh();
  clearInterval(timer);
  timer = setInterval(refresh, 15000);
}

export function stop() { clearInterval(timer); timer = null; }

function refresh() {
  return load(refs.body, "/api/vmstats", renderVm);
}

function renderVm(d) {
  if (d.error) return notice(d.error);
  const cpu = d.cpu || {};
  const mem = d.memory || {};
  const loadAvg = d.load || {};

  const cards = [
    h("div", { class: "stat-grid" }, [
      stat("CPU", fmt.pct(cpu.total ?? 0), `${cpu.count || 0} cores · livre ${fmt.pct(100 - (cpu.total ?? 0))}`),
      stat("Memoria", fmt.pct(mem.used_percent), `${fmt.bytes(mem.available)} disponiveis de ${fmt.bytes(mem.total)}`),
      stat("Load (1 min)", (loadAvg["1min"] ?? 0).toFixed(2), `${fmt.pct(loadAvg.per_core ?? 0)} por core`),
      stat("Uptime", fmt.duration(d.uptime_seconds), d.hostname),
    ]),

    h("div", { class: "grid cols-2" }, [
      card("CPU por core", cpu.cores?.length
        ? bars(cpu.cores.map((c) => ({ label: `core ${c.core}`, value: c.usage })), {
            max: 100,
            valueLabel: (i) => fmt.pct(i.value),
            color: (i) => coreColor(i.value),
          })
        : empty("sem leitura de /proc/stat")),

      card("Memoria", [
        meter("RAM em uso", mem.used_percent,
          `${fmt.bytes(mem.used)} / ${fmt.bytes(mem.total)}`),
        mem.swap_total
          ? meter("Swap", mem.swap_percent, `${fmt.bytes(mem.swap_used)} / ${fmt.bytes(mem.swap_total)}`)
          : h("p", { class: "muted", style: { fontSize: "0.8rem" }, text: "sem swap configurado" }),
        h("div", { class: "tags", style: { marginTop: "var(--sp-3)" } }, [
          h("span", { class: "pill", text: `cache ${fmt.bytes(mem.cached)}` }),
          h("span", { class: "pill", text: `buffers ${fmt.bytes(mem.buffers)}` }),
          h("span", { class: "pill", text: `livre ${fmt.bytes(mem.free)}` }),
        ]),
      ]),
    ]),

    card("Discos", (d.filesystems || []).length
      ? (d.filesystems || []).map((fs) =>
          meter(`${fs.mount} (${fs.fstype})`, fs.used_percent,
            `${fmt.bytes(fs.used)} de ${fmt.bytes(fs.total)} · ${fmt.bytes(fs.free)} livres`))
      : empty("nenhuma montagem encontrada")),

    diskBreakdown(d.disk_breakdown),

    card("Processos por CPU", (d.top_processes || []).length
      ? table([
          { key: "command", label: "Processo" },
          { key: "pid", label: "PID" },
          { key: "cpu", label: "CPU", num: true, render: (r) => fmt.pct(r.cpu) },
          { key: "mem", label: "MEM", num: true, render: (r) => fmt.pct(r.mem) },
        ], d.top_processes, { scroll: true })
      : empty("sem processos")),
  ];

  return [
    h("p", { class: "muted", style: { fontSize: "0.72rem", marginBottom: "var(--sp-3)" },
             text: `atualizado ${fmt.time(d.timestamp)} · atualiza a cada 15s` }),
    ...cards,
  ];
}

function coreColor(usage) {
  const status = statusClass(usage);
  return status === "critical" ? "var(--critical)"
       : status === "warning" ? "var(--warning)" : "var(--s1)";
}

function diskBreakdown(breakdown) {
  if (!breakdown) return null;
  if (breakdown.error) {
    return card("O que ocupa o disco", notice(breakdown.error));
  }
  // diretorio de 0 B so polui a leitura; corta abaixo de 1 MB
  const entries = (breakdown.entries || []).filter((e) => e.size >= 1024 * 1024);
  if (!entries.length) return card("O que ocupa o disco", empty("sem leitura de du"));
  return card(`O que ocupa ${breakdown.path}`, [
    bars(entries.map((e) => ({ label: e.name, value: e.size, path: e.path })), {
      valueLabel: (i) => fmt.bytes(i.value),
      color: (_i, index) => seriesColor(index),
    }),
    h("p", { class: "muted", style: { fontSize: "0.72rem", marginTop: "var(--sp-3)" },
             text: `total medido ${fmt.bytes(breakdown.total)} · leitura em cache por 10 min` }),
  ]);
}

function card(title, content) {
  return h("div", { class: "card" }, [
    h("header", {}, h("h2", { text: title })),
    ...(Array.isArray(content) ? content : [content]),
  ]);
}
