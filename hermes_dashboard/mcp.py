"""Servidores MCP: o que esta configurado e o que realmente foi chamado.

A forma do config.yaml varia, entao procuramos a secao de MCP sob varias chaves
conhecidas. Independente do config, as acoes efetivamente usadas sao derivadas
do log: tool_name no formato mcp__<servidor>__<acao>.
"""
import re
from datetime import datetime, timedelta

from . import db
from .config import load_config

CONFIG_KEYS = ["mcp_servers", "mcpServers", "mcp", "servers"]
TOOL_RE = re.compile(r"^mcp__([^_]+(?:_[^_]+)*?)__(.+)$")


def _servers_from_config():
    data, error = load_config()
    section = None
    for key in CONFIG_KEYS:
        if isinstance(data.get(key), (dict, list)):
            section = data[key]
            break
    servers = {}
    if isinstance(section, dict):
        for name, cfg in section.items():
            servers[name] = _describe(name, cfg)
    elif isinstance(section, list):
        for cfg in section:
            if isinstance(cfg, dict):
                name = cfg.get("name") or cfg.get("server") or "?"
                servers[name] = _describe(name, cfg)
    return servers, error


def _describe(name, cfg):
    if not isinstance(cfg, dict):
        return {"server": name, "configured": True}
    declared = cfg.get("tools") or cfg.get("actions") or []
    if isinstance(declared, dict):
        declared = list(declared)
    return {
        "server": name,
        "configured": True,
        "transport": cfg.get("transport") or ("http" if cfg.get("url") else "stdio"),
        "command": cfg.get("command"),
        "url": cfg.get("url"),
        "enabled": cfg.get("enabled", True),
        "declared_actions": [str(a) for a in declared],
    }


def _usage(days=30):
    """{servidor: {acao: {calls, failures, avg_ms, last}}} vindo do tool_calls."""
    if "tool_calls" not in db.tables():
        return {}
    since = (datetime.utcnow() - timedelta(days=days)).isoformat()
    rows = db.query(
        "SELECT tool_name, duration_ms, success, error, timestamp FROM tool_calls "
        "WHERE tool_name LIKE 'mcp\\_\\_%' ESCAPE '\\' AND timestamp >= ?", (since,)
    )
    per = {}
    for r in rows:
        match = TOOL_RE.match(r.get("tool_name") or "")
        if not match:
            continue
        server, action = match.group(1), match.group(2)
        entry = per.setdefault(server, {}).setdefault(
            action, {"action": action, "calls": 0, "failures": 0,
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
    for actions in per.values():
        for entry in actions.values():
            durations = entry.pop("durations")
            entry["avg_ms"] = round(sum(durations) / len(durations)) if durations else None
    return per


def servers(days=30):
    configured, config_error = _servers_from_config()
    try:
        usage = _usage(days)
        usage_error = None
    except db.DatabaseUnavailable as e:
        usage, usage_error = {}, str(e)

    names = sorted(set(configured) | set(usage))
    out = []
    for name in names:
        info = dict(configured.get(name) or {"server": name, "configured": False})
        actions = sorted(usage.get(name, {}).values(), key=lambda a: -a["calls"])
        # acao declarada no config que nunca foi chamada tambem aparece, zerada
        seen = {a["action"] for a in actions}
        for declared in info.get("declared_actions", []):
            if declared not in seen:
                actions.append({"action": declared, "calls": 0, "failures": 0,
                                "avg_ms": None, "last": None})
        info["actions"] = actions
        info["calls"] = sum(a["calls"] for a in actions)
        info["failures"] = sum(a["failures"] for a in actions)
        info["action_count"] = len(actions)
        out.append(info)
    out.sort(key=lambda s: (-s["calls"], s["server"]))
    return {
        "servers": out,
        "total_calls": sum(s["calls"] for s in out),
        "days": days,
        "config_error": config_error,
        "usage_error": usage_error,
    }
