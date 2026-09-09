// Helpers compartilhados pelas abas.
// Tudo que vira DOM passa por h(): construir nos em vez de concatenar HTML
// evita escapar string na mao (e evita esquecer de escapar).

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function render(target, ...children) {
  clear(target).append(...children.flat(Infinity).filter(Boolean));
  return target;
}

export const fmt = {
  num(v) {
    if (v === null || v === undefined) return "-";
    return new Intl.NumberFormat("pt-BR").format(v);
  },
  bytes(v) {
    const n = Number(v) || 0;
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let i = 0, value = n;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
    return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  },
  pct(v, digits = 1) {
    if (v === null || v === undefined) return "-";
    return `${Number(v).toFixed(digits)}%`;
  },
  ms(v) {
    if (v === null || v === undefined) return "-";
    const n = Number(v);
    if (n < 1000) return `${Math.round(n)} ms`;
    if (n < 60000) return `${(n / 1000).toFixed(1)} s`;
    return `${Math.floor(n / 60000)} min ${Math.round((n % 60000) / 1000)} s`;
  },
  usd(v) {
    if (v === null || v === undefined) return "-";
    return `$${Number(v).toFixed(4)}`;
  },
  duration(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    if (s < 60) return `${s}s`;
    const d = Math.floor(s / 86400), hrs = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d) return `${d}d ${hrs}h`;
    if (hrs) return `${hrs}h ${m}min`;
    return `${m}min`;
  },
  // Os timestamps do banco sao UTC sem sufixo; sem o "Z" o browser leria como local.
  time(iso) {
    const date = parseUTC(iso);
    return date ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
  },
  dateTime(iso) {
    const date = parseUTC(iso);
    return date ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-";
  },
  day(isoDate) {
    const date = new Date(`${isoDate}T12:00:00Z`);
    return isNaN(date) ? isoDate : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  },
  relative(iso) {
    const date = parseUTC(iso);
    if (!date) return "-";
    const secs = Math.round((Date.now() - date.getTime()) / 1000);
    if (secs < 60) return "agora";
    if (secs < 3600) return `ha ${Math.floor(secs / 60)} min`;
    if (secs < 86400) return `ha ${Math.floor(secs / 3600)} h`;
    return `ha ${Math.floor(secs / 86400)} d`;
  },
};

export function parseUTC(iso) {
  if (!iso) return null;
  const text = String(iso);
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`;
  const date = new Date(normalized);
  return isNaN(date) ? null : date;
}

export async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 401) throw new Error("sessao expirada - reentre com o token");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function skeleton(text = "carregando...") {
  return h("p", { class: "skeleton", text });
}

export function empty(text) {
  return h("p", { class: "empty", text });
}

export function notice(text) {
  return h("div", { class: "notice" }, "Sem dados: ", h("span", { class: "mono", text }));
}

/** Busca o JSON e entrega ao renderer, cuidando de carregando/erro/erro-do-payload. */
export async function load(target, url, renderer) {
  render(target, skeleton());
  try {
    const data = await getJSON(url);
    render(target, renderer(data));
    return data;
  } catch (err) {
    render(target, notice(err.message));
    return null;
  }
}

export function statusClass(pct, warnAt = 75, critAt = 90) {
  if (pct === null || pct === undefined) return "";
  if (pct >= critAt) return "critical";
  if (pct >= warnAt) return "warning";
  return "good";
}

/* ---------- gaveta de detalhe ---------- */
let sheetEls = null;

function ensureSheet() {
  if (sheetEls) return sheetEls;
  const title = h("h2", { text: "" });
  const body = h("div", { class: "body" });
  const close = h("button", { class: "close", type: "button", "aria-label": "Fechar" }, "×");
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" },
    h("header", {}, title, close), body);
  const backdrop = h("div", { class: "sheet-backdrop", hidden: true }, sheet);
  document.body.append(backdrop);
  close.addEventListener("click", closeSheet);
  backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeSheet(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeSheet(); });
  sheetEls = { backdrop, title, body, close };
  return sheetEls;
}

export function openSheet(titleText, ...content) {
  const { backdrop, title, body, close } = ensureSheet();
  title.textContent = titleText;
  render(body, ...content);
  backdrop.hidden = false;
  close.focus();
  return body;
}

export function closeSheet() {
  if (sheetEls) sheetEls.backdrop.hidden = true;
}

/** Tabela responsiva: no mobile o CSS vira cartao usando data-label. */
export function table(columns, rows, options = {}) {
  const head = h("tr", {}, columns.map((c) =>
    h("th", { class: c.num ? "num" : null, text: c.label })));
  const body = rows.map((row) => {
    const tr = h("tr", options.onRow ? { class: "clickable", onclick: () => options.onRow(row) } : {},
      columns.map((c) => {
        const value = c.render ? c.render(row) : row[c.key];
        return h("td", { class: c.num ? "num" : null, "data-label": c.label },
          value instanceof Node ? value : (value === null || value === undefined ? "-" : String(value)));
      }));
    return tr;
  });
  return h("div", { class: `table-wrap${options.scroll ? " scroll-y" : ""}` },
    h("table", { class: "stack" }, h("thead", {}, head), h("tbody", {}, body)));
}
