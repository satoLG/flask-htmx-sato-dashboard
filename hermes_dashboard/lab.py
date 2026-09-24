"""Read-only digital twin. Every activity claim carries its evidence/source.

The robots answer telemetry questions locally; they do not run prompts on Hermes
or call a paid provider. Catalogs are cached for 30s, live observations are not.
"""
import hashlib
import threading
import time
import unicodedata
from datetime import datetime, timezone

from . import activity, config, cron, db, mcp, memory, rag, stats, vm, gateways

SECTORS = [
    ("gateway", "Recepção de gateways", "G-00", "Recebo as entradas do Hermes. Cada atendente representa um adaptador conectado ou o endpoint de prompts do dashboard; pacotes na esteira ilustram o fluxo da arquitetura.", "gateway_state.json · dashboard"),
    ("hermes", "Núcleo Hermes", "H-01", "Coordeno a leitura de agentes, subagentes e ferramentas. Cada robô de execução corresponde a um registro ou processo observado.", "events.db · agent_runs / subagent_runs / tool_calls"),
    ("models", "Providers", "P-02", "Represento o roteamento de modelos: provider principal e fallbacks configurados, incluindo OpenRouter e OpenCode quando presentes.", "config.yaml · model_usage"),
    ("mcp", "Conexões MCP", "M-03", "Represento a ponte entre o Hermes e os servidores MCP. Uma configuração não comprova que o servidor está conectado.", "config.yaml · tool_calls"),
    ("rag", "Arquivo RAG", "R-04", "Represento a base vetorial: documentos recuperados para dar contexto ao agente. Só sinalizo uso recente quando há uma ferramenta de RAG identificável no log.", "LanceDB · tool_calls"),
    ("memory", "Memória & skills", "S-05", "Represento memórias, contextos e skills persistidos em disco para orientar o Hermes.", "~/.hermes/memories · contexts · skills"),
    ("cron", "Agendamentos", "C-06", "Represento jobs do Hermes, crontab e timers. Estar agendado é diferente de estar em execução.", "jobs.json · executions.db · crontab · systemd"),
    ("vm", "Infraestrutura", "V-07", "Represento a máquina que sustenta o laboratório: CPU, RAM e disco, medidos no host do dashboard.", "/proc · filesystems"),
]
STATUS = {"recent": "Atividade recente", "process": "Processo detectado", "running": "Execução registrada",
          "idle": "Sem atividade recente", "unknown": "Sem telemetria", "configured": "Configurado",
          "disabled": "Desativado", "error": "Falha registrada", "completed": "Concluído",
          "stale": "Último estado sem confirmação", "observed": "Registro observado"}
_cache = {}
_lock = threading.Lock()


def _safe(producer):
    try:
        return producer()
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}


def _catalogs():
    key = tuple(str(p) for p in (config.DB_PATH, config.CONFIG_PATH, config.RAG_PATH,
                                config.HERMES_HOME, config.CRON_DIR))
    with _lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < 30:
            return hit[1]
        data = {"models": _safe(stats.models_config), "mcp": _safe(mcp.servers),
                "cron": _safe(cron.overview), "memory": _safe(memory.catalog),
                "rag": _safe(rag.catalog)}
        # Do not retain document bodies in the telemetry cache.
        data["rag"].pop("docs", None)
        data["sampled_at"] = datetime.now(timezone.utc).isoformat()
        _cache.clear()
        _cache[key] = (time.monotonic(), data)
        return data


def _id(prefix, value):
    return prefix + ":" + hashlib.sha256(str(value).encode()).hexdigest()[:16]


def _age(value):
    try:
        if isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(value / 1000 if value > 1e12 else value, timezone.utc)
        else:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds()
    except (ValueError, TypeError, OverflowError, OSError):
        return float("inf")


def event_sector(event):
    name = str(event.get("name") or "").lower()
    if event.get("kind") == "model":
        return "models"
    if name.startswith("mcp__"):
        return "mcp"
    if any(word in name for word in ("rag", "vector", "semantic_search")):
        return "rag"
    if any(word in name for word in ("memory", "skill", "context")):
        return "memory"
    if any(word in name for word in ("cron", "schedule")):
        return "cron"
    return "hermes"


def _worker(key, name, sector, kind, state, detail, source, **extra):
    return dict(id=key, name=str(name)[:160], sector=sector, kind=kind, status=state,
                status_label=STATUS[state], detail=detail, source=source, **extra)


def _runs():
    workers, errors = [], []
    for table, kind in (("agent_runs", "agent"), ("subagent_runs", "subagent")):
        cols = db.columns(table)
        if not cols:
            continue
        ts = next((c for c in activity.TS_CANDIDATES if c in cols), None)
        identity = next((c for c in ("id", "run_id", "agent_id") if c in cols), None)
        if not identity:
            errors.append(f"{table}: falta id/run_id/agent_id; não é possível identificar robôs individuais")
            continue
        order = db.time_sql(table, ts) if ts else db._ident(identity)
        try:
            rows = db.query(f"SELECT * FROM {table} ORDER BY {order} DESC LIMIT 48")
        except db.DatabaseUnavailable as exc:
            errors.append(str(exc))
            continue
        seen = set()
        for row in rows:
            raw_id = row.get(identity)
            if raw_id is None or str(raw_id) in seen:
                continue
            seen.add(str(raw_id))
            status = str(row.get("status") or row.get("state") or "").lower()
            ended = row.get("ended_at") or row.get("completed_at") or row.get("end_time")
            state = "observed"
            if status in ("failed", "error", "cancelled", "canceled") or row.get("error"):
                state = "error"
            elif ended or status in ("completed", "done", "success", "finished"):
                state = "completed"
            elif status in ("running", "active", "started", "in_progress"):
                stamp = row.get("updated_at") or row.get(ts)
                state = "running" if 0 <= _age(stamp) <= 180 else "stale"
            task = str(row.get("task") or row.get("prompt") or row.get("title") or "Tarefa não informada no registro.")[:600]
            workers.append(_worker(_id(table, raw_id), row.get("name") or f"{'Subagente' if kind == 'subagent' else 'Agente'} {raw_id}",
                                   "hermes", kind, state, task, f"events.db · {table}",
                                   run_id=str(raw_id), parent_id=row.get("parent_id") or row.get("parent_run_id"),
                                   pid=str(row.get("pid") or ""), observed_at=row.get(ts)))
    return workers, errors


def snapshot():
    live = _safe(activity.live_snapshot)
    catalogs = _catalogs()
    machine = _safe(lambda: vm.snapshot(with_breakdown=False))
    workers, warnings = _runs()
    entrances = gateways.snapshot()
    events = [dict(e, sector=event_sector(e)) for e in live.get("events", [])]
    # A clean host must not look like an idle, successfully connected Hermes.
    event_available = bool(activity.available_kinds()) and not live.get("error")
    for sector, label, code, description, source in SECTORS:
        matching = [e for e in events if e["sector"] == sector]
        state = "recent" if matching else "idle" if event_available else "unknown"
        data = catalogs.get(sector, {})
        errors = [str(v) for k, v in data.items() if k.endswith("error") and v]
        facts = []
        if sector == "gateway":
            facts = [f"{len(entrances)} entradas observadas"] + [e["name"] for e in entrances]
            state = "observed" if entrances else "unknown"
        elif sector == "hermes":
            facts = [f"{len(live.get('processes', []))} processos detectados", f"{len(workers)} registros de agentes/subagentes (até 48 por tabela)"]
        elif sector == "models":
            facts = [f"Principal: {data.get('primary', 'desconhecido')}"]
            facts += [f"Fallback: {f.get('provider')}/{f.get('model')}" for f in data.get("fallbacks", [])]
        elif sector == "mcp":
            facts = [f"{len(data.get('servers', []))} servidores", f"{data.get('total_calls', 0)} chamadas nos últimos 30 dias"]
        elif sector == "rag":
            facts = [f"{data.get('total', 0)} documentos catalogados"]
        elif sector == "memory":
            facts = [f"{data.get('count', 0)} documentos e skills", f"{len(data.get('skills', []))} skills"]
            if not data.get("exists"):
                errors.append("Diretório Hermes não encontrado")
        elif sector == "cron":
            facts = [f"{len(data.get('jobs', []))} agendamentos", f"{data.get('failed_runs', 0)} falhas no histórico (até 60 execuções)"]
        elif sector == "vm":
            cpu = machine.get("cpu", {}).get("total")
            mem = machine.get("memory", {})
            facts = [f"Host: {machine.get('hostname', '?')}", f"CPU: {cpu}%" if cpu is not None else "CPU: indisponível",
                     f"RAM: {mem.get('used_percent')}%" if mem.get("total") else "RAM: indisponível"]
            state = "observed" if cpu is not None else "unknown"
        if errors and not matching:
            state = "unknown"
        workers.append(_worker(f"guide:{sector}", code, sector, "guide", state,
                               f"Último evento: {matching[0]['name']}" if matching else "Nenhuma execução recente comprovada neste setor.",
                               source, description=description, facts=facts, errors=errors))

    # Fixed catalog attendants are explicit visual roles, never invented agent runs.
    for entrance in entrances:
        workers.append(_worker(f"gateway:{entrance['id']}", entrance["name"], "gateway", "gateway",
                               entrance["status"], entrance["detail"], entrance["source"],
                               description="Sou o atendente visual desta entrada, não uma execução de agente."))
    archives = catalogs["memory"]
    for archive_id, name, entries in (
        ("skills", "Arquivista de skills", archives.get("skills", [])),
        ("memory", "Arquivista de memórias", [e for e in archives.get("documents", [])
                                               if e.get("category") in ("memoria", "contexto")]),
    ):
        if entries:
            workers.append(_worker(f"catalog:{archive_id}", name, "memory", "catalog", "observed",
                                   f"{len(entries)} itens catalogados em disco.", "~/.hermes · catálogo de arquivos",
                                   description="Sou uma representação visual do catálogo de arquivos, não um agente ou subagente em execução.",
                                   facts=[f"{len(entries)} itens"] + [str(e.get("name", "")) for e in entries[:4]]))

    known_pids = {w.get("pid") for w in workers if w.get("pid")}
    for proc in live.get("processes", []):
        if str(proc.get("pid")) in known_pids:
            continue
        workers.append(_worker(f"process:{proc['pid']}", f"{'Subagente' if proc.get('role') == 'subagente' else 'Hermes'} · PID {proc['pid']}",
                               "hermes", "process", "process", "Processo vivo. A existência do processo não confirma uma tarefa em execução.",
                               "ps · processo do agente", facts=[f"CPU: {proc.get('cpu', 0)}%", f"Tempo de processo: {proc.get('elapsed_s', 0)}s"]))
    for server in catalogs["mcp"].get("servers", []):
        name = str(server["server"])
        matching = [e for e in events if str(e.get("name", "")).startswith(f"mcp__{name}__")]
        state = "disabled" if server.get("enabled") is False else "recent" if matching else "configured" if server.get("configured") else "observed"
        workers.append(_worker(_id("mcp", name), name, "mcp", "service", state,
                               f"Última chamada: {matching[0]['name']}" if matching else "Sem chamada recente observada; conexão não verificada.",
                               "config.yaml · tool_calls", facts=[f"{server.get('action_count', 0)} ações", f"{server.get('calls', 0)} chamadas / 30 dias", f"{server.get('failures', 0)} falhas / 30 dias"]))
    for job in catalogs["cron"].get("jobs", []):
        runs = [r for r in catalogs["cron"].get("executions", []) if str(r.get("job_id")) == str(job["id"])]
        latest = runs[0] if runs else {}
        state = "configured" if job.get("enabled") else "disabled"
        if latest:
            ended = latest.get("end_time")
            if ended:
                state = "completed" if latest.get("exit_code") == 0 else "error"
            elif latest.get("exit_code") is None:
                state = "running" if 0 <= _age(latest.get("start_time")) <= 180 else "stale"
        workers.append(_worker(_id("cron", f"{job.get('source')}:{job['id']}"), job.get("name") or job["id"], "cron", "job", state,
                               f"Agenda: {job.get('schedule', '?')}", f"{job.get('source')} · jobs / executions",
                               facts=[f"Próxima execução: {job.get('next_run') or 'não informada'}", f"Última execução: {latest.get('start_time') or job.get('last_run') or 'não informada'}"]))
    for sector in SECTORS:
        guide = next(w for w in workers if w["id"] == f"guide:{sector[0]}")
        warnings.extend(f"{sector[1]}: {e}" for e in guide.get("errors", []))
    if not event_available:
        warnings.append("Sem fonte de eventos disponível. O laboratório não pode confirmar atividade do Hermes.")
    if live.get("error"):
        warnings.append(str(live["error"]))
    memory_entries = sorted(catalogs["memory"].get("skills", []) +
                            catalogs["memory"].get("documents", []),
                            key=lambda entry: entry.get("modified") or 0, reverse=True)[:48]
    return {"now": live.get("now") or datetime.now(timezone.utc).isoformat(),
            "catalog_sampled_at": catalogs["sampled_at"], "poll_seconds": 5, "window_seconds": 180,
            "sectors": [dict(id=s[0], name=s[1], code=s[2], description=s[3]) for s in SECTORS],
            "workers": workers, "events": events, "warnings": warnings,
            "connections": [{"from": "gateway", "to": "vm", "kind": "conceptual"}] + [{"from": "hermes", "to": s[0], "kind": "conceptual"} for s in SECTORS if s[0] not in ("hermes", "gateway")],
            "telemetry_available": event_available,
            "visuals": {
                "providers": {"primary": catalogs["models"].get("primary"),
                              "fallbacks": catalogs["models"].get("fallbacks", [])},
                "memory": {"count": catalogs["memory"].get("count", 0),
                           "available": bool(catalogs["memory"].get("exists")),
                           "items": [{k: entry.get(k) for k in ("name", "category", "modified")}
                                     for entry in memory_entries]}},
            "metrics": {"processes": len(live.get("processes", [])), "recent_events": len(events),
                        "cpu": machine.get("cpu", {}).get("total"),
                        "memory": machine.get("memory", {}).get("used_percent") if machine.get("memory", {}).get("total") else None}}


def answer(robot_id, question):
    state = snapshot()
    robot = next((w for w in state["workers"] if w["id"] == robot_id), None)
    if robot is None:
        return None
    guide = next(w for w in state["workers"] if w["id"] == f"guide:{robot['sector']}")
    q = "".join(c for c in unicodedata.normalize("NFD", question.lower()) if not unicodedata.combining(c))
    if any(term in q for term in ("represent", "quem", "funcao", "serve", "setor", "explic")):
        reply = guide["description"]
        if robot["kind"] != "guide":
            reply += f" Sou {robot['name']}, associado a {robot['source']}."
    elif any(term in q for term in ("erro", "falha", "problema")):
        if robot["kind"] == "guide":
            failures = [e for e in state["events"] if e["sector"] == robot["sector"] and not e.get("ok", True)]
            reply = "\n".join(guide.get("errors", []) + [f"Falha em {e['name']} ({e.get('when')})" for e in failures])
            reply = reply or "Não há falhas nos eventos recentes disponíveis. Isso não confirma a saúde de fontes sem telemetria."
        else:
            reply = f"Estado deste robô: {robot['status_label']}. {robot['detail']}"
            reply += "\n" + "\n".join(robot.get("facts", []))
    elif any(term in q for term in ("faz", "fazendo", "tarefa", "status", "agora", "atividade", "rodando")):
        reply = f"{robot['status_label']}. {robot['detail']}"
    elif any(term in q for term in ("fonte", "dado", "modelo", "provider", "document", "quant", "agenda", "proxim", "cpu", "memoria", "ram", "skill")):
        reply = "\n".join(robot.get("facts") or guide.get("facts") or [robot["detail"]])
    else:
        reply = "Posso explicar meu setor, a tarefa registrada, os dados disponíveis e as falhas recentes. Minha conversa usa a telemetria do dashboard, sem um modelo de linguagem. Não consigo executar comandos nem responder fora desses dados."
    if not state["telemetry_available"]:
        reply += "\nA fonte de eventos está indisponível; não posso confirmar atividade atual."
    return {"robot_id": robot_id, "answer": reply, "source": robot["source"], "observed_at": state["now"],
            "catalog_sampled_at": state["catalog_sampled_at"], "mode": "telemetry"}
