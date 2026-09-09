// Componentes visuais reutilizados pelas abas.
import { h, fmt, statusClass } from "./core.js";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Nivel 0..4 por magnitude. Zero e sempre nivel 0 - "sem atividade" e um estado, nao um degrau. */
export function level(value, max) {
  if (!value) return 0;
  if (!max || max <= 1) return 4;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/**
 * Calendario estilo GitHub. `days` e denso (um item por dia, zeros inclusive),
 * entao so precisamos fatiar em semanas comecando no domingo.
 */
export function heatmap(days, max, { onSelect, selected } = {}) {
  const weeks = [];
  let current = [];
  days.forEach((day, index) => {
    const weekday = new Date(`${day.date}T12:00:00Z`).getUTCDay();
    if (index === 0) {
      // completa a primeira semana com espacos vazios ate o dia da semana certo
      for (let i = 0; i < weekday; i += 1) current.push(null);
    }
    current.push(day);
    if (weekday === 6) { weeks.push(current); current = []; }
  });
  if (current.length) {
    while (current.length < 7) current.push(null);
    weeks.push(current);
  }

  const weekEls = weeks.map((week) => {
    const first = week.find(Boolean);
    const date = first ? new Date(`${first.date}T12:00:00Z`) : null;
    // rotulo de mes so na semana que contem o dia 1..7
    const showMonth = date && date.getUTCDate() <= 7;
    return h("div", {}, [
      h("div", { class: "hm-month", text: showMonth ? MONTHS[date.getUTCMonth()] : "" }),
      h("div", { class: "hm-week" }, week.map((day) => {
        if (!day) return h("span", { class: "hm-cell empty-slot" });
        const label = `${fmt.day(day.date)}: ${day.total} evento(s)`;
        return h("button", {
          type: "button",
          class: "hm-cell",
          dataset: { level: String(level(day.total, max)), date: day.date },
          title: label,
          "aria-label": label,
          "aria-pressed": selected === day.date ? "true" : "false",
          onclick: () => onSelect && onSelect(day),
        });
      })),
    ]);
  });

  const legend = h("div", { class: "hm-legend" }, [
    h("span", { text: "menos" }),
    ...[0, 1, 2, 3, 4].map((lv) =>
      h("i", { style: { background: `var(--seq-${lv})` } })),
    h("span", { text: "mais" }),
    h("span", { class: "muted", style: { marginLeft: "auto" }, text: `pico ${max}/dia` }),
  ]);

  // a coluna dos dias da semana fica FORA do scroller: dentro dele, rolar ate
  // hoje empurrava os rotulos pra fora da tela
  const scroller = h("div", { class: "heatmap-scroll" },
    h("div", { class: "hm-weeks" }, weekEls));
  // o que interessa e o hoje, na ponta direita - abrir no inicio da janela
  // obrigaria a rolar um ano toda vez
  requestAnimationFrame(() => { scroller.scrollLeft = scroller.scrollWidth; });

  const board = h("div", { class: "heatmap" }, [
    h("div", { class: "hm-weekdays" },
      WEEKDAYS.map((d, i) => h("span", { text: i % 2 === 1 ? d : "" }))),
    scroller,
  ]);
  return h("div", {}, [board, legend]);
}

/** Barras horizontais. `color` recebe (item, indice) e devolve uma cor CSS. */
export function bars(items, { color, valueLabel, max } = {}) {
  if (!items.length) return h("p", { class: "empty", text: "sem dados" });
  const peak = max || Math.max(...items.map((i) => i.value)) || 1;
  return h("div", { class: "bars" }, items.map((item, index) => {
    const width = Math.max(1, (item.value / peak) * 100);
    return h("div", { class: "bar-row" }, [
      h("span", { class: "k", text: item.label }),
      h("span", { class: "v", text: valueLabel ? valueLabel(item) : fmt.num(item.value) }),
      h("div", { class: "bar-track" },
        h("div", {
          class: "bar-fill",
          style: { width: `${width}%`, background: color ? color(item, index) : "var(--s1)" },
          title: `${item.label}: ${valueLabel ? valueLabel(item) : item.value}`,
        })),
    ]);
  }));
}

/** Medidor com faixa de status (verde/ambar/vermelho pelo percentual). */
export function meter(label, percent, detail, { warnAt = 75, critAt = 90 } = {}) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  return h("div", { class: "meter-row" }, [
    h("span", { class: "k", text: label }),
    h("span", { class: "v", text: detail || fmt.pct(pct) }),
    h("div", { class: `meter ${statusClass(pct, warnAt, critAt)}` },
      h("span", { style: { width: `${pct}%` } })),
  ]);
}

/** Cartao de numero grande. */
export function stat(label, value, foot) {
  return h("div", { class: "stat" }, [
    h("div", { class: "label", text: label }),
    h("div", { class: "value" }, value instanceof Node ? value : String(value)),
    foot ? h("div", { class: "foot", text: foot }) : null,
  ]);
}

export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)",
                       "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];

/** Cor categorica por indice, na ordem fixa da paleta (nunca ciclada alem de 8). */
export function seriesColor(index) {
  return SERIES[index] || "var(--muted)";
}

/** Legenda para series categoricas - obrigatoria quando ha 2+ series. */
export function legend(items) {
  return h("div", { class: "tags", style: { marginTop: "var(--sp-3)" } },
    items.map((item) => h("span", { class: "pill" }, [
      h("i", {
        style: {
          width: "9px", height: "9px", borderRadius: "50%",
          background: item.color, display: "inline-block",
        },
      }),
      item.label,
    ])));
}
