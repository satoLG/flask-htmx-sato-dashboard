"""Numeros do mes usados na pagina publica e no topo do dashboard."""
from datetime import datetime

from . import db


def empty(error=None):
    data = {
        "month": datetime.utcnow().strftime("%Y-%m"),
        "total_cost": 0, "total_calls": 0,
        "fallback_count": 0, "fallback_rate": 0,
        "models": [], "tools": [], "daily": [],
    }
    if error:
        data["error"] = error
    return data


def public_stats():
    try:
        return _collect()
    except db.DatabaseUnavailable as e:
        return empty(str(e))


def _collect():
    month_start = datetime.utcnow().replace(
        day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    # so agregamos as colunas que existem: um events.db sem cost_usd nao deve
    # zerar a pagina publica inteira
    mu = db.columns("model_usage")
    cost_expr = "SUM(cost_usd)" if "cost_usd" in mu else "0"
    mts = db.time_sql("model_usage", "timestamp")
    tts = db.time_sql("tool_calls", "timestamp")
    rows = db.query(
        f"""SELECT model, COUNT(*) AS calls, {cost_expr} AS cost
            FROM model_usage WHERE {mts} > ?
            GROUP BY model ORDER BY calls DESC""", (month_start,))
    total_cost = sum(r.get("cost") or 0 for r in rows)
    total_calls = sum(r["calls"] for r in rows)
    # COALESCE porque fallback_reason NULL nao satisfaz "!= ''" no sqlite e a
    # contagem de fallback saia menor do que a real.
    if "fallback_reason" in mu:
        fb = db.query(
            """SELECT COUNT(*) AS fb FROM model_usage
               WHERE """ + mts + """ > ? AND COALESCE(fallback_reason, '') != ''""",
            (month_start,))
        fallback_count = fb[0]["fb"] if fb else 0
    else:
        fallback_count = 0
    tool_rows = db.query(
        f"""SELECT tool_name, COUNT(*) AS calls FROM tool_calls
            WHERE {tts} > ? GROUP BY tool_name ORDER BY calls DESC""",
        (month_start,))
    daily = db.query(
        f"""SELECT date({mts}) AS day, COUNT(*) AS calls FROM model_usage
            WHERE {mts} > datetime('now', '-30 days')
            GROUP BY date({mts}) ORDER BY day""")
    return {
        "month": datetime.utcnow().strftime("%Y-%m"),
        "total_cost": round(total_cost, 4),
        "total_calls": total_calls,
        "fallback_count": fallback_count,
        "fallback_rate": round(fallback_count / total_calls * 100, 2) if total_calls else 0,
        "models": [
            {"model": r["model"], "calls": r["calls"],
             "cost": round(r.get("cost") or 0, 4),
             "percentage": round(r["calls"] / total_calls * 100, 1) if total_calls else 0}
            for r in rows
        ],
        "tools": tool_rows[:10],
        "daily": [{"day": r["day"], "calls": r["calls"]} for r in daily],
    }


def models_config():
    """Modelo primario e cadeia de fallback, do config.yaml."""
    from . import config
    data, error = config.load_config()
    info = {"primary": "unknown", "fallbacks": []}
    if error:
        info["error"] = error
        return info
    model = config.as_dict(data.get("model"))
    info["primary"] = f"{model.get('provider', '?')}/{model.get('default', '?')}"
    fallbacks = config.as_list(data.get("fallback_providers")
                               or model.get("fallback_providers"))
    for fb in fallbacks:
        if isinstance(fb, dict):
            info["fallbacks"].append({
                "provider": fb.get("provider", "?"),
                "model": fb.get("model", "?"),
                "cost": config.PRICING.get(fb.get("model", ""), (0, 0)),
            })
    return info
