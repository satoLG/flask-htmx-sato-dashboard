// Aba 3: catalogo de tools e estatisticas de tool calling.
import { h, fmt, render, load, empty, table, notice } from "./core.js";
import { bars, stat, seriesColor, legend } from "./charts.js";

const state = { days: 30, group: "todos", data: null };
let refs = {};

export function init(root) {
  refs = {
    controls: root.querySelector("[data-role=tools-controls]"),
    body: root.querySelector("[data-role=tools]"),
  };
  reload();
}

async function reload() {
  renderControls();
  const data = await load(refs.body, `/api/tools?days=${state.days}`, renderTools);
  if (data) { state.data = data; renderControls(); }
}

function renderControls() {
  const periods = [[7, "7 dias"], [30, "30 dias"], [90, "90 dias"], [365, "1 ano"]];
  const groups = ["todos", ...(state.data?.groups || [])];
  render(refs.controls,
    h("div", { class: "seg", role: "group", "aria-label": "Periodo" },
      periods.map(([value, label]) => h("button", {
        type: "button",
        "aria-pressed": state.days === value ? "true" : "false",
        onclick: () => { state.days = value; reload(); },
      }, label))),
    groups.length > 1
      ? h("div", { class: "seg", role: "group", "aria-label": "Grupo" },
          groups.map((g) => h("button", {
            type: "button",
            "aria-pressed": state.group === g ? "true" : "false",
            onclick: () => { state.group = g; render(refs.body, renderTools(state.data)); },
          }, g)))
      : null);
}

function renderTools(d) {
  if (!d) return empty("sem dados");
  if (d.error) return notice(d.error);
  const all = d.tools || [];
  const filtered = state.group === "todos" ? all : all.filter((t) => t.group === state.group);
  const used = filtered.filter((t) => t.calls > 0);
  const unused = filtered.filter((t) => t.calls === 0);
  const failedCalls = used.reduce((sum, t) => sum + t.failures, 0);
  const groupNames = d.groups || [];

  return [
    h("div", { class: "stat-grid" }, [
      stat("Tool calls", fmt.num(d.total_calls), `ultimos ${d.days} dias`),
      stat("Tools usadas", fmt.num(used.length), `de ${fmt.num(all.length)} disponiveis`),
      stat("Chamadas com falha", fmt.num(failedCalls),
        d.total_calls ? fmt.pct(failedCalls / d.total_calls * 100) + " do total" : null),
      stat("Nunca chamadas", fmt.num(unused.length)),
    ]),

    h("div", { class: "card" }, [
      h("header", {}, h("h2", { text: "Mais chamadas" })),
      used.length
        ? bars(used.slice(0, 12).map((t) => ({ label: t.tool, value: t.calls, group: t.group })), {
            valueLabel: (i) => `${fmt.num(i.value)} calls`,
            color: (item) => seriesColor(groupNames.indexOf(item.group)),
          })
        : empty("nenhuma chamada no periodo"),
      groupNames.length > 1
        ? legend(groupNames.map((g, i) => ({ label: g, color: seriesColor(i) })))
        : null,
    ]),

    h("div", { class: "card" }, [
      h("header", {}, h("h2", { text: "Detalhe por tool" })),
      used.length
        ? table([
            { key: "tool", label: "Tool" },
            { key: "group", label: "Grupo" },
            { key: "calls", label: "Calls", num: true, render: (r) => fmt.num(r.calls) },
            { key: "success_rate", label: "Sucesso", num: true, render: (r) => successPill(r) },
            { key: "avg_ms", label: "Media", num: true, render: (r) => fmt.ms(r.avg_ms) },
            { key: "last", label: "Ultimo uso", render: (r) => fmt.relative(r.last) },
          ], used, { scroll: true })
        : empty("nenhuma chamada no periodo"),
    ]),

    unused.length
      ? h("div", { class: "card" }, [
          h("header", {}, h("h2", { text: "Disponiveis, nunca chamadas" })),
          h("div", { class: "tags" }, unused.map((t) => h("span", { class: "pill", text: t.tool }))),
        ])
      : null,
  ];
}

function successPill(row) {
  if (row.success_rate === null || row.success_rate === undefined) return h("span", { text: "-" });
  const rate = row.success_rate;
  const [cls, icon] = rate >= 98 ? ["ok", "✓"] : rate >= 90 ? ["warn", "!"] : ["err", "×"];
  return h("span", { class: `pill ${cls}`, title: `${row.failures} de ${row.calls} falharam` },
    [h("span", { class: "ico", text: icon }), fmt.pct(rate)]);
}
