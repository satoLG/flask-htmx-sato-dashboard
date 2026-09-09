// Aba 6: RAG. Tres sub-abas - mapa mental interativo, lista e busca semantica.
// O mapa carrega por nivel (root -> repo -> categoria -> documento): jogar
// milhares de nos no cytoscape de uma vez trava no celular.
import { h, fmt, render, load, empty, table, notice, getJSON, openSheet, skeleton } from "./core.js";
import { stat, bars, seriesColor } from "./charts.js";

const KIND_COLORS = {
  root: "#3987e5", repo: "#d95926", category: "#199e70",
  doc: "#c98500", query: "#9085e9",
};
const KIND_SIZES = { root: 46, repo: 34, category: 26, doc: 18, query: 50 };

const state = { view: "mapa", expanded: new Set(), term: "" };
let refs = {};
let cy = null;
let searchCy = null;

export function init(root) {
  refs = {
    views: root.querySelector("[data-role=rag-views]"),
    mapa: root.querySelector("[data-view=mapa]"),
    lista: root.querySelector("[data-view=lista]"),
    busca: root.querySelector("[data-view=busca]"),
    graph: root.querySelector("[data-role=rag-graph]"),
    graphInfo: root.querySelector("[data-role=rag-graph-info]"),
    list: root.querySelector("[data-role=rag-list]"),
    searchForm: root.querySelector("[data-role=rag-search-form]"),
    searchInput: root.querySelector("[data-role=rag-search-input]"),
    searchResult: root.querySelector("[data-role=rag-search-result]"),
    searchGraph: root.querySelector("[data-role=rag-search-graph]"),
  };
  bindViews(root);
  bindGraphToolbar(root);
  refs.searchForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    runSearch(refs.searchInput.value.trim());
  });
  showView("mapa");
}

function bindViews(root) {
  root.querySelectorAll("[data-rag-view]").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.ragView));
  });
}

function showView(view) {
  state.view = view;
  refs.views.querySelectorAll("[data-rag-view]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.ragView === view ? "true" : "false");
  });
  for (const name of ["mapa", "lista", "busca"]) refs[name].hidden = name !== view;
  if (view === "mapa" && !cy) loadGraph();
  if (view === "lista" && !refs.list.dataset.loaded) loadList();
  // o cytoscape precisa remedir quando o container sai de display:none
  if (view === "mapa" && cy) requestAnimationFrame(() => { cy.resize(); cy.fit(undefined, 40); });
  if (view === "busca" && searchCy) requestAnimationFrame(() => { searchCy.resize(); searchCy.fit(undefined, 40); });
}

/* ---------- mapa mental ---------- */

function styleSheet() {
  return [
    {
      selector: "node",
      style: {
        "background-color": (el) => KIND_COLORS[el.data("kind")] || "#898781",
        width: (el) => KIND_SIZES[el.data("kind")] || 18,
        height: (el) => KIND_SIZES[el.data("kind")] || 18,
        label: "data(label)",
        color: "#c3c2b7",
        "font-size": 10,
        "font-family": "system-ui, sans-serif",
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-wrap": "ellipsis",
        "text-max-width": 110,
        "border-width": 2,
        "border-color": "#0d0d0d",
        "transition-property": "background-color, border-color",
      },
    },
    { selector: "node[?expandable]", style: { "border-color": "#ffffff", "border-width": 2 } },
    { selector: "node:selected", style: { "border-color": "#ffffff", "border-width": 3, color: "#ffffff" } },
    {
      selector: "edge",
      style: {
        width: 1.5, "line-color": "#383835",
        "curve-style": "bezier", "target-arrow-shape": "none", opacity: 0.8,
      },
    },
    { selector: "edge[score]", style: { width: (el) => 1 + el.data("score") * 4 } },
    { selector: "node.hide-label", style: { "text-opacity": 0 } },
  ];
}

function newGraph(container, elements) {
  const instance = window.cytoscape({
    container,
    elements,
    style: styleSheet(),
    minZoom: 0.2,
    maxZoom: 3,
    wheelSensitivity: 0.25,
    layout: layoutFor(elements.length),
  });
  const applyLabelDensity = () => {
    const dense = instance.nodes('[kind = "doc"]').length > 8;
    const hide = dense && instance.zoom() < 0.85;
    instance.batch(() => {
      instance.nodes('[kind = "doc"]').toggleClass("hide-label", hide);
    });
  };
  instance.on("zoom", applyLabelDensity);
  instance.on("add remove", applyLabelDensity);
  instance.ready(applyLabelDensity);
  return instance;
}

function layoutFor(count) {
  // quanto mais no, mais empurrao: com o valor fixo os rotulos se sobrepunham
  const scale = Math.min(3, 1 + count / 60);
  return {
    name: "cose",
    animate: count < 250,
    animationDuration: 400,
    nodeRepulsion: 9000 * scale,
    idealEdgeLength: 90 * scale,
    nodeOverlap: 24,
    randomize: false,
    fit: true,
    padding: 40,
  };
}

function toElements(payload) {
  const nodes = (payload.nodes || []).map((n) => ({ data: { ...n } }));
  const edges = (payload.edges || []).map((e) => ({ data: { ...e } }));
  return [...nodes, ...edges];
}

async function loadGraph() {
  render(refs.graphInfo, skeleton("montando o mapa..."));
  try {
    const payload = await getJSON("/api/rag/graph");
    if (payload.error) {
      render(refs.graphInfo, notice(payload.error));
      return;
    }
    if (!payload.nodes?.length) {
      render(refs.graphInfo, empty("base vetorial vazia"));
      return;
    }
    cy = newGraph(refs.graph, toElements(payload));
    cy.on("tap", "node", (ev) => onNodeTap(ev.target));
    state.expanded.add("root");
    render(refs.graphInfo, graphHint(payload));
  } catch (err) {
    render(refs.graphInfo, notice(err.message));
  }
}

function graphHint(payload) {
  const root = (payload.nodes || []).find((n) => n.kind === "root");
  return h("p", { class: "graph-hint" },
    `${root ? fmt.num(root.count) + " documentos · " : ""}`,
    "toque num no com borda branca para abrir os filhos · arraste para mover · pinca ou roda para zoom");
}

async function onNodeTap(node) {
  const data = node.data();
  if (data.kind === "doc") { showDoc(data); return; }
  if (!data.expandable) return;
  if (state.expanded.has(data.id)) {
    collapse(node);
    return;
  }
  node.style("opacity", 0.5);
  try {
    const payload = await getJSON(`/api/rag/graph?parent=${encodeURIComponent(data.id)}`);
    node.style("opacity", 1);
    if (payload.error) { render(refs.graphInfo, notice(payload.error)); return; }
    const fresh = toElements(payload).filter((el) => cy.getElementById(el.data.id).empty());
    if (!fresh.length) { state.expanded.add(data.id); return; }
    const added = cy.add(fresh);
    // nasce na posicao do pai e o layout empurra pra fora: menos salto visual
    added.nodes().forEach((n) => n.position({ ...node.position() }));
    state.expanded.add(data.id);
    cy.layout(layoutFor(cy.nodes().length)).run();
    if (payload.truncated) {
      render(refs.graphInfo, h("p", { class: "graph-hint" },
        `mostrando os primeiros documentos; ${fmt.num(payload.truncated)} nao couberam neste ramo`));
    }
  } catch (err) {
    node.style("opacity", 1);
    render(refs.graphInfo, notice(err.message));
  }
}

function collapse(node) {
  const removable = node.successors().nodes();
  if (!removable.length) return;
  removable.forEach((n) => state.expanded.delete(n.id()));
  state.expanded.delete(node.id());
  cy.remove(removable);
  cy.layout(layoutFor(cy.nodes().length)).run();
}

function showDoc(data) {
  openSheet(data.label, [
    h("div", { class: "tags", style: { marginBottom: "var(--sp-3)" } }, [
      data.repo ? h("span", { class: "pill", text: data.repo }) : null,
      data.doc_type ? h("span", { class: "pill", text: data.doc_type }) : null,
      data.state ? h("span", { class: "pill", text: data.state }) : null,
      data.size ? h("span", { class: "pill", text: fmt.bytes(data.size) }) : null,
      data.score !== undefined ? h("span", { class: "pill", text: `similaridade ${data.score}` }) : null,
    ].filter(Boolean)),
    data.url ? h("p", { style: { marginBottom: "var(--sp-3)" } },
      h("a", { href: data.url, target: "_blank", rel: "noopener", text: data.url })) : null,
    h("h3", { text: "Trecho indexado" }),
    h("pre", { class: "doc-content", text: data.preview || "(sem previa)" }),
  ].filter(Boolean));
}

function bindGraphToolbar(root) {
  root.querySelectorAll("[data-graph-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.graphTarget === "search" ? searchCy : cy;
      if (!target) return;
      const action = btn.dataset.graphAction;
      if (action === "in") target.zoom({ level: target.zoom() * 1.3, renderedPosition: center(target) });
      if (action === "out") target.zoom({ level: target.zoom() / 1.3, renderedPosition: center(target) });
      if (action === "fit") target.fit(undefined, 40);
    });
  });
}

function center(instance) {
  const box = instance.container().getBoundingClientRect();
  return { x: box.width / 2, y: box.height / 2 };
}

/* ---------- lista ---------- */

function loadList() {
  refs.list.dataset.loaded = "1";
  load(refs.list, "/api/rag/list", (d) => {
    if (d.error) return notice(d.error);
    if (!d.total) return empty("base vetorial vazia");
    return [
      h("div", { class: "stat-grid" }, [
        stat("Documentos", fmt.num(d.total)),
        stat("Repositorios", fmt.num((d.by_repo || []).length)),
        stat("Tipos", fmt.num(Object.keys(d.by_type || {}).length)),
        stat("Maior repo", d.by_repo?.[0]?.repo || "-", d.by_repo?.[0] ? `${d.by_repo[0].count} docs` : null),
      ]),
      h("div", { class: "card" }, [
        h("header", {}, h("h2", { text: "Documentos por repositorio" })),
        bars((d.by_repo || []).map((r) => ({ label: r.repo, value: r.count })), {
          valueLabel: (i) => `${fmt.num(i.value)} docs`,
          color: (_i, index) => seriesColor(index),
        }),
      ]),
      h("div", { class: "card" }, [
        h("header", {}, h("h2", { text: "Todos os documentos" })),
        table([
          { key: "title", label: "Titulo", render: (r) => r.title || r.id },
          { key: "repo", label: "Repo" },
          { key: "type", label: "Tipo", render: (r) => h("span", { class: "pill", text: r.type || "doc" }) },
          { key: "state", label: "Estado" },
          { key: "size", label: "Tamanho", num: true, render: (r) => fmt.bytes(r.size) },
        ], d.docs || [], { scroll: true,
            onRow: (row) => showDoc({ ...row, label: row.title || row.id, doc_type: row.type }) }),
      ]),
    ];
  });
}

/* ---------- busca ---------- */

async function runSearch(term) {
  if (!term) return;
  state.term = term;
  render(refs.searchResult, skeleton(`buscando "${term}"...`));
  if (searchCy) { searchCy.destroy(); searchCy = null; }
  refs.searchGraph.hidden = true;
  try {
    const data = await getJSON(`/api/rag/search?q=${encodeURIComponent(term)}&limit=10`);
    if (data.error) { render(refs.searchResult, notice(data.error)); return; }
    if (!data.hits?.length) { render(refs.searchResult, empty(`nada encontrado para "${term}"`)); return; }
    refs.searchGraph.hidden = false;
    searchCy = newGraph(refs.searchGraph.querySelector("[data-role=rag-search-canvas]"),
                        toElements(data.graph));
    searchCy.on("tap", "node", (ev) => {
      const node = ev.target.data();
      if (node.kind === "doc") showDoc(node);
    });
    render(refs.searchResult, [
      h("p", { class: "graph-hint", style: { marginBottom: "var(--sp-3)" } },
        `${data.hits.length} resultados · o tamanho da aresta acompanha a similaridade · toque num no para ver o trecho`),
      h("div", { class: "timeline" }, data.hits.map((hit, index) => h("div", {
        class: "event",
        style: { borderLeftColor: seriesColor(0), cursor: "pointer" },
        onclick: () => showDoc({ ...hit, label: hit.title || hit.id, doc_type: hit.type }),
      }, [
        h("span", { class: "time", text: `#${index + 1}` }),
        h("span", { class: "name", text: hit.title || hit.id }),
        h("span", { class: "detail", text: `${hit.repo || "?"} · ${hit.type || "doc"} · ${(hit.preview || "").slice(0, 160)}` }),
      ]))),
    ]);
  } catch (err) {
    render(refs.searchResult, notice(err.message));
  }
}
