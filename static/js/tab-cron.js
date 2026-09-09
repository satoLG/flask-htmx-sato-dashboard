// Aba 7: cron jobs da VM (Hermes, crontab e systemd timers) + historico.
import { h, fmt, render, load, empty, table, notice, openSheet } from "./core.js";
import { stat } from "./charts.js";

let refs = {};

export function init(root) {
  refs = { body: root.querySelector("[data-role=cron]") };
  load(refs.body, "/api/cronjobs", renderCron);
}

const SOURCE_LABELS = { hermes: "Hermes", crontab: "crontab", systemd: "systemd" };

function renderCron(d) {
  const jobs = d.jobs || [];
  const runs = d.executions || [];
  const blocks = [];

  if (d.jobs_error) blocks.push(notice(d.jobs_error));
  if (d.executions_error) blocks.push(notice(d.executions_error));

  blocks.push(h("div", { class: "stat-grid" }, [
    stat("Jobs", fmt.num(jobs.length), d.sources.map((s) => SOURCE_LABELS[s] || s).join(" · ") || null),
    stat("Execucoes", fmt.num(d.total_runs), "historico recente"),
    stat("Com falha", fmt.num(d.failed_runs),
      d.total_runs ? fmt.pct(d.failed_runs / d.total_runs * 100) : null),
    stat("Ativos", fmt.num(jobs.filter((j) => j.enabled !== false).length)),
  ]));

  if (!jobs.length && !runs.length) {
    blocks.push(h("div", { class: "card" }, [
      empty("nenhum cron job encontrado"),
      h("p", { class: "muted", style: { fontSize: "0.75rem", textAlign: "center" },
               text: `procurei em ${d.cron_dir}, no crontab do usuario e nos timers do systemd` }),
    ]));
    return blocks;
  }

  if (jobs.length) {
    blocks.push(h("div", { class: "card" }, [
      h("header", {}, h("h2", { text: "Jobs configurados" })),
      table([
        { key: "name", label: "Job" },
        { key: "schedule", label: "Agenda", render: (r) => h("span", { class: "mono", text: r.schedule }) },
        { key: "source", label: "Origem", render: (r) => h("span", { class: "pill", text: SOURCE_LABELS[r.source] || r.source }) },
        { key: "enabled", label: "Estado", render: (r) => (r.enabled === false
            ? h("span", { class: "pill", text: "desligado" })
            : h("span", { class: "pill ok" }, [h("span", { class: "ico", text: "✓" }), "ativo"])) },
        { key: "runs", label: "Execucoes", num: true, render: (r) => fmt.num(r.history?.runs || 0) },
        { key: "last", label: "Ultima", render: (r) => (r.history?.last ? fmt.relative(r.history.last) : "-") },
      ], jobs, { onRow: (job) => showJob(job) }),
      h("p", { class: "muted", style: { fontSize: "0.72rem", marginTop: "var(--sp-3)" },
               text: "toque numa linha para ver o comando completo" }),
    ]));
  }

  if (runs.length) {
    blocks.push(h("div", { class: "card" }, [
      h("header", {}, h("h2", { text: "Historico de execucoes" })),
      table([
        { key: "job_id", label: "Job" },
        { key: "start_time", label: "Inicio", render: (r) => fmt.dateTime(r.start_time) },
        { key: "duration_s", label: "Duracao", num: true,
          render: (r) => (r.duration_s === null ? "-" : fmt.duration(r.duration_s)) },
        { key: "output_bytes", label: "Saida", num: true, render: (r) => fmt.bytes(r.output_bytes) },
        { key: "exit_code", label: "Exit", num: true, render: (r) => (r.ok
            ? h("span", { class: "pill ok" }, [h("span", { class: "ico", text: "✓" }), "0"])
            : h("span", { class: "pill err" }, [h("span", { class: "ico", text: "!" }), String(r.exit_code)])) },
      ], runs, { scroll: true }),
    ]));
  }
  return blocks;
}

function showJob(job) {
  openSheet(job.name, [
    h("div", { class: "tags", style: { marginBottom: "var(--sp-3)" } }, [
      h("span", { class: "pill", text: SOURCE_LABELS[job.source] || job.source }),
      h("span", { class: "pill mono", text: job.schedule }),
      job.enabled === false ? h("span", { class: "pill", text: "desligado" })
                            : h("span", { class: "pill ok", text: "ativo" }),
    ]),
    h("h3", { text: "Comando" }),
    h("pre", { class: "doc-content", text: job.command || "(vazio)" }),
    job.history?.runs
      ? h("p", { class: "muted", style: { marginTop: "var(--sp-3)", fontSize: "0.8rem" },
                 text: `${job.history.runs} execucoes registradas, ${job.history.failures} com falha` })
      : null,
  ]);
}
