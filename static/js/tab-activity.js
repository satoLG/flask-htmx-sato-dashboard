// Aba 1: atividade do agente (heatmap tipo GitHub + detalhe do dia).
// O painel "ao vivo" acima do heatmap e servido pelo htmx (fragments/live.html);
// aqui cuidamos so do calendario e da lista do dia selecionado.
import { h, fmt, render, load, empty, getJSON, notice } from "./core.js";
import { heatmap, stat } from "./charts.js";

const KIND_LABELS = {
  prompt: "Prompts", model: "Modelos", tool: "Tool calls",
  agent: "Agentes", subagent: "Subagentes",
};

const state = { days: 365, kinds: new Set(), selected: null, data: null };

let refs = {};

export function init(root) {
  refs = {
    controls: root.querySelector("[data-role=controls]"),
    summary: root.querySelector("[data-role=summary]"),
    calendar: root.querySelector("[data-role=calendar]"),
    detail: root.querySelector("[data-role=detail]"),
  };
  reload();
}

function periodControls() {
  const options = [[90, "90 dias"], [180, "6 meses"], [365, "1 ano"], [730, "2 anos"]];
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Periodo" },
    options.map(([value, label]) =>
      h("button", {
        type: "button",
        "aria-pressed": state.days === value ? "true" : "false",
        onclick: () => { state.days = value; reload(); },
      }, label)));

  const series = (state.data?.series || []);
  const kindSeg = series.length > 1
    ? h("div", { class: "seg", role: "group", "aria-label": "Tipos de evento" },
        series.map((s) =>
          h("button", {
            type: "button",
            "aria-pressed": (state.kinds.size === 0 || state.kinds.has(s.kind)) ? "true" : "false",
            onclick: () => toggleKind(s.kind, series),
          }, KIND_LABELS[s.kind] || s.label)))
    : null;

  return [seg, kindSeg];
}

function toggleKind(kind, series) {
  if (state.kinds.size === 0) series.forEach((s) => state.kinds.add(s.kind));
  if (state.kinds.has(kind)) state.kinds.delete(kind); else state.kinds.add(kind);
  if (state.kinds.size === series.length || state.kinds.size === 0) state.kinds.clear();
  reload();
}

function kindParam() {
  return state.kinds.size ? `&kinds=${[...state.kinds].join(",")}` : "";
}

async function reload() {
  render(refs.controls, ...periodControls().filter(Boolean));
  const data = await load(refs.calendar, `/api/activity/heatmap?days=${state.days}${kindParam()}`,
    (payload) => {
      state.data = payload;
      if (payload.error) return notice(payload.error);
      if (!payload.days?.length) return empty("nenhuma atividade registrada");
      return heatmap(payload.days, payload.max, {
        selected: state.selected,
        onSelect: (day) => selectDay(day.date),
      });
    });
  if (data) {
    render(refs.controls, ...periodControls().filter(Boolean));
    renderSummary(data);
  }
}

function renderSummary(data) {
  const active = data.days.filter((d) => d.total > 0).length;
  const byKind = Object.entries(data.by_kind || {})
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => `${KIND_LABELS[kind] || kind}: ${fmt.num(n)}`)
    .join(" · ");
  render(refs.summary,
    stat("Eventos no periodo", fmt.num(data.total), byKind || null),
    stat("Dias com atividade", fmt.num(active), `de ${data.days.length} dias`),
    stat("Pico em um dia", fmt.num(data.max)),
    stat("Media por dia ativo", active ? fmt.num(Math.round(data.total / active)) : "0"));
}

async function selectDay(date) {
  state.selected = date;
  // repinta o calendario so pra mover o anel de selecao
  refs.calendar.querySelectorAll(".hm-cell").forEach((cell) => {
    cell.setAttribute("aria-pressed", cell.dataset.date === date ? "true" : "false");
  });
  render(refs.detail, h("p", { class: "skeleton", text: `carregando ${fmt.day(date)}...` }));
  try {
    const data = await getJSON(`/api/activity/day/${date}?${kindParam().slice(1)}`);
    render(refs.detail, dayDetail(data));
    refs.detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    render(refs.detail, notice(err.message));
  }
}

function dayDetail(data) {
  const header = h("header", {}, [
    h("h2", { text: fmt.day(data.date) }),
    h("span", { class: "when", text: `${fmt.num(data.count)} eventos` }),
  ]);
  if (!data.count) {
    return h("div", { class: "card" }, [header, empty("nenhuma atividade neste dia")]);
  }
  const chips = h("div", { class: "tags", style: { marginBottom: "var(--sp-3)" } }, [
    ...Object.entries(data.by_kind).map(([kind, n]) =>
      h("span", { class: "pill", text: `${KIND_LABELS[kind] || kind}: ${n}` })),
    data.cost_usd ? h("span", { class: "pill", text: `custo ${fmt.usd(data.cost_usd)}` }) : null,
    data.errors
      ? h("span", { class: "pill err" }, [h("span", { class: "ico", text: "!" }), `${data.errors} com erro`])
      : h("span", { class: "pill ok" }, [h("span", { class: "ico", text: "✓" }), "sem erros"]),
  ].filter(Boolean));

  const rows = data.events.map((e) => h("div", {
    class: `event kind-${e.kind}${e.ok ? "" : " failed"}`,
  }, [
    h("span", { class: "time", text: fmt.time(e.when) }),
    h("span", { class: "name" }, [
      e.name,
      " ",
      h("span", { class: "pill", text: KIND_LABELS[e.kind] || e.kind }),
    ]),
    h("span", { class: "detail", text: eventDetail(e) }),
  ]));

  return h("div", { class: "card" },
    [header, chips, h("div", { class: "timeline scroll-y" }, rows)]);
}

function eventDetail(e) {
  const parts = [];
  if (e.model) parts.push(e.model);
  if (e.duration_ms !== null && e.duration_ms !== undefined) parts.push(fmt.ms(e.duration_ms));
  if (e.input_tokens || e.output_tokens) {
    parts.push(`${fmt.num(e.input_tokens || 0)} in / ${fmt.num(e.output_tokens || 0)} out`);
  }
  if (e.cost_usd) parts.push(fmt.usd(e.cost_usd));
  if (e.error) parts.push(`erro: ${e.error}`);
  return parts.join(" · ");
}
