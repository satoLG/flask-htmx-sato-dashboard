// Aba 5: memoria, skills e contextos - catalogo com leitura do conteudo.
import { h, fmt, render, load, empty, table, notice, getJSON, openSheet } from "./core.js";
import { stat, seriesColor } from "./charts.js";

const state = { filter: "todos", term: "", data: null };
let refs = {};

const CATEGORY_LABELS = {
  memoria: "Memoria", contexto: "Contexto", skill: "Skill",
  projeto: "Projeto", config: "Config",
};

export function init(root) {
  refs = {
    controls: root.querySelector("[data-role=mem-controls]"),
    body: root.querySelector("[data-role=memory]"),
  };
  load(refs.body, "/api/memory", (d) => { state.data = d; renderControls(); return renderMemory(d); });
}

function renderControls() {
  const cats = ["todos", ...Object.keys(state.data?.by_category || {})];
  const search = h("input", {
    type: "search", placeholder: "filtrar por nome...", value: state.term,
    "aria-label": "Filtrar documentos",
    oninput: (ev) => { state.term = ev.target.value; repaint(); },
  });
  render(refs.controls,
    cats.length > 1
      ? h("div", { class: "seg", role: "group", "aria-label": "Categoria" },
          cats.map((c) => h("button", {
            type: "button",
            "aria-pressed": state.filter === c ? "true" : "false",
            onclick: () => { state.filter = c; repaint(); },
          }, CATEGORY_LABELS[c] || c)))
      : null,
    h("div", { style: { flex: "1 1 220px", minWidth: "0" } }, search));
}

function repaint() {
  renderControls();
  render(refs.body, renderMemory(state.data));
}

function items(d) {
  const all = [...(d.documents || []), ...(d.skills || [])];
  const term = state.term.trim().toLowerCase();
  return all.filter((item) =>
    (state.filter === "todos" || item.category === state.filter) &&
    (!term || item.name.toLowerCase().includes(term) || item.path.toLowerCase().includes(term)));
}

function renderMemory(d) {
  if (!d) return empty("sem dados");
  const filtered = items(d);
  const cats = Object.keys(d.by_category || {});

  const blocks = [
    h("div", { class: "stat-grid" }, [
      stat("Documentos", fmt.num(d.count)),
      stat("Skills", fmt.num((d.skills || []).length)),
      stat("Contexto total", fmt.bytes(d.total_bytes)),
      stat("Categorias", fmt.num(cats.length)),
    ]),
  ];

  if (!d.exists) {
    blocks.push(h("div", { class: "notice" }, [
      "Diretorio do Hermes nao encontrado em ",
      h("span", { class: "mono", text: d.hermes_home }),
      h("p", { style: { marginTop: "var(--sp-2)" },
               text: "Memorias e skills aparecem aqui quando o dashboard roda na mesma VM do agente." }),
    ]));
  }

  blocks.push(h("div", { class: "card" }, [
    h("header", {}, [
      h("h2", { text: "Catalogo" }),
      h("span", { class: "when", text: `${filtered.length} de ${d.count}` }),
    ]),
    filtered.length
      ? table([
          { key: "name", label: "Documento" },
          { key: "category", label: "Tipo", render: (r) => h("span", {
              class: "pill",
              style: { borderColor: seriesColor(cats.indexOf(r.category)) },
              text: CATEGORY_LABELS[r.category] || r.category,
            }) },
          { key: "size", label: "Tamanho", num: true, render: (r) => fmt.bytes(r.size) },
          { key: "modified", label: "Modificado", render: (r) =>
              new Date(r.modified * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) },
        ], filtered, { onRow: (row) => openDocument(row), scroll: true })
      : empty("nenhum documento com esse filtro"),
    h("p", { class: "muted", style: { fontSize: "0.72rem", marginTop: "var(--sp-3)" },
             text: "toque num documento para ler o conteudo" }),
  ]));

  return blocks;
}

async function openDocument(row) {
  const body = openSheet(row.name, h("p", { class: "skeleton", text: "carregando..." }));
  try {
    const doc = await getJSON(`/api/memory/doc?path=${encodeURIComponent(row.path)}`);
    if (doc.error) { render(body, notice(doc.error)); return; }
    render(body,
      h("div", { class: "tags", style: { marginBottom: "var(--sp-3)" } }, [
        h("span", { class: "pill", text: CATEGORY_LABELS[row.category] || row.category }),
        h("span", { class: "pill", text: fmt.bytes(doc.size) }),
        h("span", { class: "pill", text: `${fmt.num(doc.lines)} linhas` }),
        doc.redacted ? h("span", { class: "pill warn" },
          [h("span", { class: "ico", text: "!" }), "segredos redigidos"]) : null,
        doc.truncated ? h("span", { class: "pill warn" },
          [h("span", { class: "ico", text: "!" }), "truncado"]) : null,
      ].filter(Boolean)),
      h("p", { class: "mono muted", style: { marginBottom: "var(--sp-3)", overflowWrap: "anywhere" },
               text: doc.path }),
      h("pre", { class: "doc-content", text: doc.content }));
  } catch (err) {
    render(body, notice(err.message));
  }
}
