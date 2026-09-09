"""Atividade do agente: heatmap tipo GitHub, detalhe do dia e o que roda agora.

As fontes sao as tabelas do events.db. Quais existem varia de instalacao, entao
KIND_SOURCES e so um catalogo de candidatas: available_kinds() devolve as que
realmente estao no banco. Numa VM cujo log tenha, por exemplo, uma tabela
`prompts`, a aba de atividades passa a mostrar essa serie sozinha.
"""
import re
import subprocess
from datetime import datetime, timedelta, date as date_cls

from . import db
from .config import find_log_file

TS_CANDIDATES = ["timestamp", "ts", "created_at", "started_at", "start_time", "time"]

# (kind, tabela, rotulo). A ordem define a ordem das series no grafico.
KIND_SOURCES = [
    ("prompt", "prompts", "Prompts"),
    ("model", "model_usage", "Chamadas de modelo"),
    ("tool", "tool_calls", "Tool calls"),
    ("agent", "agent_runs", "Agentes"),
    ("subagent", "subagent_runs", "Subagentes"),
]


def available_kinds():
    """[(kind, tabela, coluna_de_tempo, rotulo)] para o que existe no banco."""
    present = set(db.tables())
    found = []
    for kind, table, label in KIND_SOURCES:
        if table not in present:
            continue
        ts = db.pick_column(table, TS_CANDIDATES)
        if ts:
            found.append((kind, table, ts, label))
    return found


def heatmap(days=365, kinds=None):
    """Contagem por dia, por tipo, cobrindo TODO o intervalo (inclusive zeros).

    O calendario precisa dos dias vazios para desenhar a grade, entao a lista
    volta densa: um item por dia entre start e end.
    """
    sources = [s for s in available_kinds() if not kinds or s[0] in kinds]
    missing = None
    if not sources:
        from .config import DB_PATH
        missing = (f"nenhuma tabela de eventos em {DB_PATH}"
                   if not DB_PATH.exists() else
                   f"{DB_PATH} nao tem as tabelas de atividade esperadas")
    end = datetime.utcnow().date()
    start = end - timedelta(days=days - 1)
    counts = {}
    totals_by_kind = {}
    for kind, table, ts, _label in sources:
        rows = db.query(
            f"SELECT date({ts}) AS d, COUNT(*) AS n FROM {db._ident(table)} "
            f"WHERE date({ts}) >= ? GROUP BY d",
            (start.isoformat(),),
        )
        for r in rows:
            if not r["d"]:
                continue
            counts.setdefault(r["d"], {})[kind] = r["n"]
            totals_by_kind[kind] = totals_by_kind.get(kind, 0) + r["n"]

    out = []
    peak = 0
    total = 0
    for i in range((end - start).days + 1):
        day = (start + timedelta(days=i)).isoformat()
        by_kind = counts.get(day, {})
        day_total = sum(by_kind.values())
        peak = max(peak, day_total)
        total += day_total
        out.append({"date": day, "total": day_total, "kinds": by_kind})
    result = {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days": out,
        "max": peak,
        "total": total,
        "by_kind": totals_by_kind,
        "series": [{"kind": k, "label": lb} for k, _t, _ts, lb in sources],
    }
    if missing:
        result["error"] = missing
    return result


def _row_label(kind, row):
    for key in ("tool_name", "name", "model", "prompt", "title", "action"):
        if row.get(key):
            return str(row[key])
    return kind


def _normalize(kind, row, ts_col):
    """Achata a linha de qualquer tabela num formato unico para a timeline."""
    ok = row.get("success")
    error = row.get("error") or row.get("fallback_reason") or ""
    return {
        "kind": kind,
        "when": row.get(ts_col),
        "name": _row_label(kind, row),
        "model": row.get("model"),
        "provider": row.get("provider"),
        "duration_ms": row.get("duration_ms") or row.get("latency_ms"),
        "input_tokens": row.get("input_tokens"),
        "output_tokens": row.get("output_tokens"),
        "cost_usd": row.get("cost_usd"),
        "ok": (bool(ok) if ok is not None else not error),
        "error": error,
    }


def day_activity(day, kinds=None, limit=500):
    """Todos os eventos de um dia, de todas as fontes, em ordem cronologica."""
    sources = [s for s in available_kinds() if not kinds or s[0] in kinds]
    events = []
    for kind, table, ts, _label in sources:
        rows = db.query(
            f"SELECT * FROM {db._ident(table)} WHERE date({ts}) = ? "
            f"ORDER BY {ts} LIMIT ?",
            (day, limit),
        )
        events += [_normalize(kind, r, ts) for r in rows]
    events.sort(key=lambda e: str(e["when"]))
    summary = {}
    for e in events:
        summary[e["kind"]] = summary.get(e["kind"], 0) + 1
    cost = sum(e["cost_usd"] or 0 for e in events)
    return {
        "date": day,
        "events": events,
        "count": len(events),
        "by_kind": summary,
        "cost_usd": round(cost, 4),
        "errors": sum(1 for e in events if not e["ok"]),
    }


PROC_RE = re.compile(r"hermes|subagent|delegate_task", re.I)

# Interpretadores: pra eles o que identifica o processo e o script/modulo, nao o
# executavel ("python3" nao diz nada; "python3 -m hermes.subagent" diz tudo).
INTERPRETERS = {
    "python", "python3", "node", "nodejs", "ruby", "perl",
    "uv", "uvx", "poetry", "pipenv", "deno", "bun",
}


def _command_target(args):
    """(executavel, script) de uma linha de comando."""
    tokens = args.split()
    if not tokens:
        return None, None
    exe = tokens[0].rsplit("/", 1)[-1]
    if exe.startswith("python3."):
        exe = "python3"
    if exe not in INTERPRETERS:
        return exe, None
    for token in tokens[1:]:
        if token == "-m" or token.startswith("-"):
            continue
        return exe, token
    return exe, None


def _looks_like_agent(args):
    """True so quando o Hermes esta NO comando, nao apenas citado nos argumentos.

    Casar em qualquer lugar da linha pegava o terminal de quem olha o dashboard:
    um `tail ~/.hermes/logs/hermes.log`, um `grep hermes`, ate o curl com o
    header do token acendiam "processando agora".
    """
    exe, target = _command_target(args)
    if not exe:
        return False
    if exe == "gunicorn" or "app.py" in (target or ""):
        return False  # o proprio dashboard
    return bool(PROC_RE.search(exe) or (target and PROC_RE.search(target)))


def _running_processes():
    """Processos do agente. Nao levanta: sem ps, devolve lista vazia."""
    try:
        out = subprocess.run(
            ["ps", "-eo", "pid,etimes,pcpu,pmem,args"],
            text=True, capture_output=True, timeout=5,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    procs = []
    for line in out.splitlines()[1:]:
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        pid, etimes, pcpu, pmem, args = parts
        if not _looks_like_agent(args):
            continue
        exe, target = _command_target(args)
        role = ("subagente"
                if re.search(r"subagent|delegate", f"{exe} {target or ''}", re.I)
                else "agente")
        procs.append({
            "pid": pid, "role": role,
            "elapsed_s": int(etimes) if etimes.isdigit() else 0,
            "cpu": float(pcpu) if _isnum(pcpu) else 0.0,
            "mem": float(pmem) if _isnum(pmem) else 0.0,
            "command": args[:160],
        })
    return procs


def _isnum(v):
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def _log_tail(lines=25):
    path = find_log_file()
    if not path:
        return {"path": None, "lines": []}
    try:
        # tail sem carregar o arquivo inteiro
        out = subprocess.run(["tail", "-n", str(lines), str(path)],
                             text=True, capture_output=True, timeout=5).stdout
        return {"path": str(path), "lines": out.splitlines()}
    except (OSError, subprocess.SubprocessError):
        return {"path": str(path), "lines": []}


def live_snapshot(window_seconds=180):
    """O que esta acontecendo agora: eventos recentes, processos e log."""
    cutoff = (datetime.utcnow() - timedelta(seconds=window_seconds)).isoformat()
    recent = []
    db_error = None
    try:
        for kind, table, ts, _label in available_kinds():
            rows = db.query(
                f"SELECT * FROM {db._ident(table)} WHERE {ts} >= ? "
                f"ORDER BY {ts} DESC LIMIT 15",
                (cutoff,),
            )
            recent += [_normalize(kind, r, ts) for r in rows]
    except db.DatabaseUnavailable as e:
        db_error = str(e)
    recent.sort(key=lambda e: str(e["when"]), reverse=True)
    recent = recent[:15]

    procs = _running_processes()
    models = []
    for e in recent:
        if e["model"] and e["model"] not in models:
            models.append(e["model"])
    return {
        "now": datetime.utcnow().isoformat() + "Z",
        "window_seconds": window_seconds,
        "busy": bool(procs or recent),
        "events": recent,
        "processes": procs,
        "models": models,
        "log": _log_tail(),
        "error": db_error,
    }
