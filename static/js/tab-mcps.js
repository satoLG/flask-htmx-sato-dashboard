// Aba 4: servidores MCP - o que esta configurado e o que foi realmente chamado.
import { h, fmt, render, load, empty, table, notice } from "./core.js";
import { bars, stat, seriesColor } from "./charts.js";

const state = { days: 30 };
let refs = {};

export function init(root) {
  refs = {
    controls: root.querySelector("[data-role=mcp-controls]"),
    body: root.querySelector("[data-role=mcps]"),
  };
  renderControls();
  reload();
}

function renderControls() {
  const periods = [[7, "7 dias"], [30, "30 dias"], [90, "90 dias"]];
  render(refs.controls,
    h("div", { class: "seg", role: "group", "aria-label": "Periodo" },
      periods.map(([value, label]) => h("button", {
        type: "button",
        "aria-pressed": state.days === value ? "true" : "false",
        onclick: () => { state.days = value; renderControls(); reload(); },
      }, label))));
}

function reload() {
  return load(refs.body, `/api/mcps?days=${state.days}`, renderMcps);
}

function renderMcps(d) {
  const servers = d.servers || [];
  const blocks = [];

  if (d.config_error) {
    blocks.push(h("div", { class: "notice" }, [
      "Nao consegui ler os servidores do config: ",
      h("span", { class: "mono", text: d.config_error }),
      h("p", { style: { marginTop: "var(--sp-2)" },
               text: "Os servidores abaixo, se houver, foram deduzidos das chamadas mcp__servidor__acao no log." }),
    ]));
  }

  blocks.push(h("div", { class: "stat-grid" }, [
    stat("Servidores", fmt.num(servers.length)),
    stat("Chamadas MCP", fmt.num(d.total_calls), `ultimos ${d.days} dias`),
    stat("Acoes distintas", fmt.num(servers.reduce((sum, s) => sum + s.action_count, 0))),
    stat("Com falha", fmt.num(servers.reduce((sum, s) => sum + (s.failures || 0), 0))),
  ]));

  if (!servers.length) {
    blocks.push(h("div", { class: "card" },
      empty("nenhum servidor MCP configurado nem chamado no periodo")));
    return blocks;
  }

  if (servers.some((s) => s.calls > 0)) {
    blocks.push(h("div", { class: "card" }, [
      h("header", {}, h("h2", { text: "Uso por servidor" })),
      bars(servers.filter((s) => s.calls > 0).map((s) => ({ label: s.server, value: s.calls })), {
        valueLabel: (i) => `${fmt.num(i.value)} calls`,
        color: (_i, index) => seriesColor(index),
      }),
    ]));
  }

  servers.forEach((server) => blocks.push(serverCard(server)));
  return blocks;
}

function serverCard(s) {
  const meta = [
    s.configured ? h("span", { class: "pill ok" }, [h("span", { class: "ico", text: "✓" }), "no config"])
                 : h("span", { class: "pill warn" }, [h("span", { class: "ico", text: "!" }), "so no log"]),
    s.transport ? h("span", { class: "pill", text: s.transport }) : null,
    s.enabled === false ? h("span", { class: "pill err", text: "desabilitado" }) : null,
    h("span", { class: "pill", text: `${fmt.num(s.calls)} calls` }),
  ].filter(Boolean);

  return h("div", { class: "card" }, [
    h("header", {}, [h("h2", { text: s.server }), h("span", { class: "when", text: `${s.action_count} acoes` })]),
    h("div", { class: "tags", style: { marginBottom: "var(--sp-3)" } }, meta),
    s.command || s.url
      ? h("p", { class: "mono muted", style: { marginBottom: "var(--sp-3)", overflowWrap: "anywhere" },
                 text: s.url || s.command })
      : null,
    s.actions?.length
      ? table([
          { key: "action", label: "Acao" },
          { key: "calls", label: "Calls", num: true, render: (r) => fmt.num(r.calls) },
          { key: "failures", label: "Falhas", num: true, render: (r) => fmt.num(r.failures) },
          { key: "avg_ms", label: "Media", num: true, render: (r) => fmt.ms(r.avg_ms) },
          { key: "last", label: "Ultimo uso", render: (r) => (r.last ? fmt.relative(r.last) : "nunca") },
        ], s.actions)
      : empty("nenhuma acao registrada"),
  ]);
}
