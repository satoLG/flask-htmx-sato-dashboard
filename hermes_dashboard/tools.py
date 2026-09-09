"""Catalogo de tools e estatisticas de tool calling."""
from datetime import datetime, timedelta

from . import db

CORE_TOOLS = [
    "web_search", "web_extract", "read_file", "write_file", "patch", "search_files",
    "terminal", "execute_code", "memory", "tool_search", "tool_describe", "tool_call",
    "browser_exec", "clarify", "computer_use", "cronjob", "delegate_task",
    "text_to_speech", "todo", "vision_analyze", "session_search", "skill_manage",
    "skill_view", "skills_list", "process",
]

# Agrupamento so para dar cor/ordem na tela.
GROUPS = {
    "arquivos": {"read_file", "write_file", "patch", "search_files"},
    "execucao": {"terminal", "execute_code", "process", "browser_exec", "computer_use"},
    "web": {"web_search", "web_extract"},
    "memoria": {"memory", "session_search", "skill_manage", "skill_view", "skills_list"},
    "agente": {"delegate_task", "clarify", "todo", "cronjob", "tool_search",
               "tool_describe", "tool_call"},
    "midia": {"text_to_speech", "vision_analyze"},
}


def group_of(name):
    for group, members in GROUPS.items():
        if name in members:
            return group
    return "mcp" if name.startswith("mcp__") else "outros"


def stats(days=30):
    """Uso por tool: chamadas, falhas, duracao media e p95, ultimo uso."""
    if "tool_calls" not in db.tables():
        return {"tools": [], "total_calls": 0, "days": days,
                "error": "tabela tool_calls nao existe no events.db"}
    ts = db.pick_column("tool_calls", ["timestamp", "ts", "created_at", "time"])
    if not ts:
        return {"tools": [], "total_calls": 0, "days": days,
                "error": "tool_calls nao tem coluna de tempo reconhecivel"}
    wanted = db.select_list(
        "tool_calls", ["tool_name", "duration_ms", "success", "error", ts],
        required=("tool_name",))
    if not wanted:
        return {"tools": [], "total_calls": 0, "days": days,
                "error": "tool_calls nao tem a coluna tool_name"}
    expr = db.time_sql("tool_calls", ts)
    since = (datetime.utcnow() - timedelta(days=days)).isoformat()
    cols = [c for c in wanted if c != ts]
    rows = db.query(
        f"SELECT {', '.join(cols + [f'{expr} AS timestamp'])} FROM tool_calls "
        f"WHERE {expr} >= ?", (since,))

    per = {}
    for r in rows:
        name = r.get("tool_name") or "?"
        entry = per.setdefault(name, {"tool": name, "calls": 0, "failures": 0,
                                      "durations": [], "last": None})
        entry["calls"] += 1
        success = r.get("success")
        if (success is not None and not success) or r.get("error"):
            entry["failures"] += 1
        if r.get("duration_ms") is not None:
            entry["durations"].append(r["duration_ms"])
        ts = r.get("timestamp")
        if ts and (entry["last"] is None or ts > entry["last"]):
            entry["last"] = ts

    out = []
    for entry in per.values():
        durations = sorted(entry.pop("durations"))
        entry["avg_ms"] = round(sum(durations) / len(durations)) if durations else None
        entry["p95_ms"] = durations[min(len(durations) - 1, int(len(durations) * 0.95))] if durations else None
        entry["max_ms"] = durations[-1] if durations else None
        entry["success_rate"] = round((entry["calls"] - entry["failures"]) / entry["calls"] * 100, 1)
        entry["group"] = group_of(entry["tool"])
        out.append(entry)
    out.sort(key=lambda e: e["calls"], reverse=True)
    return {"tools": out, "total_calls": sum(e["calls"] for e in out), "days": days}


def catalog(days=30):
    """Tools conhecidas + as que aparecem no log, com uso anexado."""
    try:
        usage = stats(days)
    except db.DatabaseUnavailable as e:
        usage = {"tools": [], "total_calls": 0, "days": days, "error": str(e)}
    by_name = {t["tool"]: t for t in usage["tools"]}
    names = sorted(set(CORE_TOOLS) | set(by_name))
    catalogue = []
    for name in names:
        used = by_name.get(name)
        catalogue.append({
            "tool": name,
            "group": group_of(name),
            "known": name in CORE_TOOLS,
            "calls": used["calls"] if used else 0,
            "failures": used["failures"] if used else 0,
            "avg_ms": used["avg_ms"] if used else None,
            "success_rate": used["success_rate"] if used else None,
            "last": used["last"] if used else None,
        })
    catalogue.sort(key=lambda t: (-t["calls"], t["tool"]))
    return {
        "tools": catalogue,
        "total_calls": usage["total_calls"],
        "days": days,
        "groups": sorted({t["group"] for t in catalogue}),
        "error": usage.get("error"),
    }
