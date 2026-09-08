"""Hermes observability dashboard - public + private routes."""
from flask import Flask, jsonify, render_template, request
from pathlib import Path
import sqlite3, json, re, subprocess, os, time
from datetime import datetime, timedelta

app = Flask(__name__)
DB_PATH = Path.home() / "hermes-observability" / "events.db"
RAG_PATH = Path.home() / "rag-db"

PRICING = {
    "deepseek-v4-flash": (0.14, 0.42),
    "minimax-m3": (0.30, 0.50),
    "gpt-5.6-luna": (0.30, 0.50),
    "muse-spark-1.2-contributor": (0.10, 0.20),
    "minimax/minimax-m3:free": (0, 0),
    "deepseek/deepseek-v4-flash:free": (0, 0),
    "nvidia/nemotron-3-super-120b-a12b:free": (0, 0),
}


# Campos da linha de CPU do top, casados pelo rotulo (us, sy, id, ...).
CPU_FIELD_RE = re.compile(r"([\d.]+)\s*%?\s*(us|sy|ni|id|wa|hi|si|st)\b")
CPU_FIELD_NAMES = {
    "user": "us", "system": "sy", "nice": "ni", "idle": "id",
    "iowait": "wa", "irq": "hi", "softirq": "si", "steal": "st",
}


@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response

class DatabaseUnavailable(Exception):
    """O events.db nao existe ainda, ou nao tem as tabelas esperadas."""


def query(sql, params=()):
    """Roda um SELECT no events.db.

    Levanta DatabaseUnavailable (em vez de deixar o sqlite3 estourar 500) quando
    o banco ainda nao foi criado ou nao tem a tabela: numa instalacao nova isso e
    o estado normal, e quem chama transforma em "sem dados ainda" na tela.
    """
    if not DB_PATH.exists():
        raise DatabaseUnavailable(f"banco nao encontrado em {DB_PATH}")
    try:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    except sqlite3.OperationalError as e:
        raise DatabaseUnavailable(f"nao consegui abrir {DB_PATH}: {e}") from e
    try:
        c = conn.cursor()
        c.execute(sql, params)
        cols = [d[0] for d in c.description] if c.description else []
        return [dict(zip(cols, row)) for row in c.fetchall()]
    except sqlite3.OperationalError as e:
        raise DatabaseUnavailable(str(e)) from e
    finally:
        conn.close()


def empty_stats(error=None):
    """Mesmo formato de get_public_stats(), so que zerado."""
    stats = {
        "month": datetime.utcnow().strftime("%Y-%m"),
        "total_cost": 0, "total_calls": 0,
        "fallback_count": 0, "fallback_rate": 0,
        "models": [], "tools": [], "daily": [],
    }
    if error:
        stats["error"] = error
    return stats

def get_public_stats():
    try:
        return _collect_public_stats()
    except DatabaseUnavailable as e:
        return empty_stats(str(e))


def _collect_public_stats():
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    rows = query("""SELECT model, COUNT(*) as calls,
                           SUM(input_tokens) as inp, SUM(output_tokens) as out,
                           SUM(cost_usd) as cost
                    FROM model_usage WHERE timestamp > ?
                    GROUP BY model ORDER BY calls DESC""", (month_start,))
    total_cost = sum(r.get("cost") or 0 for r in rows)
    total_calls = sum(r["calls"] for r in rows)
    fb_rows = query("""SELECT COUNT(*) as fb FROM model_usage
                       WHERE timestamp > ? AND fallback_reason != ''""", (month_start,))
    fallback_count = fb_rows[0]["fb"] if fb_rows else 0
    tool_rows = query("""SELECT tool_name, COUNT(*) as calls FROM tool_calls
                         WHERE timestamp > ?
                         GROUP BY tool_name ORDER BY calls DESC""", (month_start,))
    daily = query("""SELECT date(timestamp) as day, COUNT(*) as calls
                     FROM model_usage
                     WHERE timestamp > datetime('now', '-30 days')
                     GROUP BY date(timestamp) ORDER BY day""", ())
    return {
        "month": datetime.utcnow().strftime("%Y-%m"),
        "total_cost": round(total_cost, 4),
        "total_calls": total_calls,
        "fallback_count": fallback_count,
        "fallback_rate": round(fallback_count / total_calls * 100, 2) if total_calls > 0 else 0,
        "models": [
            {"model": r["model"], "calls": r["calls"],
             "cost": round(r.get("cost") or 0, 4),
             "percentage": round(r["calls"] / total_calls * 100, 1) if total_calls > 0 else 0}
            for r in rows
        ],
        "tools": tool_rows[:10],
        "daily": [{"day": r["day"], "calls": r["calls"]} for r in daily]
    }

def get_rag_data():
    """List all docs in RAG with metadata + count by repo and category."""
    if not RAG_PATH.exists():
        return {"docs": [], "by_repo": {}, "categories": [], "total": 0}
    try:
        import lancedb
        db = lancedb.connect(str(RAG_PATH))
        tables = db.list_tables()
        table_list = tables.tables if hasattr(tables, 'tables') else tables
        if "github_docs" not in table_list:
            return {"docs": [], "by_repo": {}, "categories": [], "total": 0}
        tbl = db.open_table("github_docs")
        df = tbl.to_pandas()
        if len(df) == 0:
            return {"docs": [], "by_repo": {}, "categories": [], "total": 0}
        df["preview"] = df["content"].str[:200]
        df["size"] = df["content"].str.len()
        docs = df[["id", "title", "repo", "type", "state", "url", "preview", "size"]].to_dict("records")
        by_repo = {}
        for _, row in df.iterrows():
            repo = row["repo"]
            by_repo.setdefault(repo, {"count": 0, "issues": 0, "readmes": 0})
            by_repo[repo]["count"] += 1
            if row["type"] == "issue":
                by_repo[repo]["issues"] += 1
            else:
                by_repo[repo]["readmes"] += 1
        if "category" in df.columns:
            categories = sorted(set(df["category"].dropna().unique().tolist()))
        else:
            categories = []
        if "GitHub" not in categories:
            categories.append("GitHub")
        return {"docs": docs, "by_repo": by_repo, "categories": categories, "total": len(df)}
    except Exception as e:
        return {"docs": [], "by_repo": {}, "categories": [], "total": 0, "error": str(e)}

# Cache do modelo de embedding (carrega uma vez e reusa)
_EMBED_MODEL = None

def _get_embed_model():
    global _EMBED_MODEL
    if _EMBED_MODEL is None:
        from fastembed import TextEmbedding
        _EMBED_MODEL = TextEmbedding(model_name="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", max_length=512)
    return _EMBED_MODEL

def search_rag(query_text, limit=5):
    """Search RAG with semantic similarity."""
    if not query_text or not RAG_PATH.exists():
        return []
    try:
        import lancedb
        db = lancedb.connect(str(RAG_PATH))
        tables = db.list_tables()
        table_list = tables.tables if hasattr(tables, 'tables') else tables
        if "github_docs" not in table_list:
            return []
        tbl = db.open_table("github_docs")
        model = _get_embed_model()
        vec = list(model.embed([query_text[:4000]]))[0].tolist()
        results = tbl.search(vec).limit(limit).to_pandas()
        results["preview"] = results["content"].str[:500]
        return results[["id", "title", "repo", "type", "state", "url", "preview"]].to_dict("records")
    except Exception as e:
        return [{"error": str(e)}]

def get_memory_context():
    """Inspect MEMORY.md, USER.md, skills, AGENTS.md."""
    hermes_home = Path.home() / ".hermes"
    info = {
        "memory_files": [],
        "skills": [],
        "config_path": str(Path.home() / ".hermes" / "config.yaml"),
        "total_chars": 0
    }
    # Memory files
    mem_dir = hermes_home / "memories"
    if mem_dir.exists():
        for f in mem_dir.glob("*.md"):
            content = f.read_text()
            info["memory_files"].append({
                "name": f.name,
                "path": str(f),
                "size": len(content),
                "lines": content.count("\n") + 1,
                "preview": content[:300]
            })
            info["total_chars"] += len(content)
    # Skills
    skills_dir = hermes_home / "skills"
    if skills_dir.exists():
        for cat in skills_dir.iterdir():
            if cat.is_dir():
                for skill in cat.iterdir():
                    if skill.is_dir():
                        skill_md = skill / "SKILL.md"
                        if skill_md.exists():
                            content = skill_md.read_text()
                            info["skills"].append({
                                "name": skill.name,
                                "category": cat.name,
                                "size": len(content),
                                "path": str(skill)
                            })
    # AGENTS.md and .hermes.md from cwd
    cwd = Path.cwd()
    for fname in ["AGENTS.md", ".hermes.md"]:
        f = cwd / fname
        if f.exists():
            content = f.read_text()
            info["memory_files"].append({
                "name": f"cwd/{fname}",
                "path": str(f),
                "size": len(content),
                "lines": content.count("\n") + 1,
                "preview": content[:300]
            })
            info["total_chars"] += len(content)
    return info

def get_models_config():
    """Parse config.yaml to extract model + fallback chain."""
    import yaml
    config_path = Path.home() / ".hermes" / "config.yaml"
    info = {"primary": "unknown", "fallbacks": [], "raw_excerpt": ""}
    try:
        with open(config_path) as f:
            data = yaml.safe_load(f)
        model = data.get("model", {})
        info["primary"] = f"{model.get('provider', '?')}/{model.get('default', '?')}"
        fallbacks = data.get("fallback_providers", [])
        if not fallbacks:
            fallbacks = model.get("fallback_providers", []) or []
        for fb in fallbacks:
            if isinstance(fb, dict):
                info["fallbacks"].append({
                    "provider": fb.get("provider", "?"),
                    "model": fb.get("model", "?"),
                    "cost": PRICING.get(fb.get("model", ""), (0, 0))
                })
    except Exception as e:
        info["error"] = str(e)
    return info

def get_vm_stats():
    """Return VM stats: CPU, memory, disk, top processes."""
    stats = {}
    try:
        # Load average
        load1, load5, load15 = map(float, subprocess.check_output("cat /proc/loadavg", shell=True, text=True).split()[:3])
        stats["load_avg"] = {"1min": load1, "5min": load5, "15min": load15}
        # CPU usage: le a linha do top pelo rotulo, nao pela posicao.
        # O procps novo imprime "%Cpu(s):  2.3 us,  1.0 sy, ..." (valor e rotulo
        # separados) e o antigo "Cpu(s):  2.3%us,  1.0%sy, ...". Pior: quando um
        # campo chega a 100 o top cola tudo ("ni,100.0 id"), entao indexar a lista
        # por posicao lia o campo errado - era isso que deixava idle em 0.0 e
        # fazia a tela mostrar 100% de CPU numa VM ociosa.
        top = subprocess.check_output("top -bn1 | grep 'Cpu(s)'", shell=True, text=True)
        if top:
            fields = {label: value for value, label in CPU_FIELD_RE.findall(top)}
            if fields:
                stats["cpu_usage"] = {
                    name: float(fields.get(key, 0.0))
                    for name, key in CPU_FIELD_NAMES.items()
                }
        # Memory
        mem = subprocess.check_output("free -b", shell=True, text=True)
        lines = mem.strip().split('\n')
        if len(lines) >= 2:
            parts = lines[1].split()
            # total, used, free, shared, buff/cache, available
            stats["memory"] = {
                "total": int(parts[1]),
                "used": int(parts[2]),
                "free": int(parts[3]),
                "shared": int(parts[4]),
                "buff_cache": int(parts[5]),
                "available": int(parts[6])
            }
        # Disk usage for root
        df = subprocess.check_output("df -h /", shell=True, text=True)
        lines = df.strip().split('\n')
        if len(lines) >= 2:
            parts = lines[1].split()
            stats["disk"] = {
                "filesystem": parts[0],
                "size": parts[1],
                "used": parts[2],
                "avail": parts[3],
                "use_percent": parts[4],
                "mounted_on": parts[5]
            }
        # Top 5 processes by CPU
        ps_cpu = subprocess.check_output("ps -eo pcpu,pmem,pid,comm --sort=-pcpu | head -6", shell=True, text=True)
        lines = ps_cpu.strip().split('\n')[1:]  # skip header
        top_cpu = []
        for line in lines:
            if line.strip():
                p = line.split()
                if len(p) >= 4:
                    top_cpu.append({
                        "cpu": p[0],
                        "mem": p[1],
                        "pid": p[2],
                        "command": p[3]
                    })
        stats["top_cpu"] = top_cpu
        # Top 5 by memory
        ps_mem = subprocess.check_output("ps -eo pmem,pcpu,pid,comm --sort=-pmem | head -6", shell=True, text=True)
        lines = ps_mem.strip().split('\n')[1:]
        top_mem = []
        for line in lines:
            if line.strip():
                p = line.split()
                if len(p) >= 4:
                    top_mem.append({
                        "mem": p[0],
                        "cpu": p[1],
                        "pid": p[2],
                        "command": p[3]
                    })
        stats["top_mem"] = top_mem
        stats["timestamp"] = datetime.utcnow().isoformat() + "Z"
    except Exception as e:
        stats["error"] = str(e)
    return stats

def get_status():
    """Return current status: recent logs, running processes, etc."""
    status = {}
    try:
        # Recently executed background processes from cron? Not stored. We'll get from observability: recent tool calls and model usage.
        recent_tools = query("""SELECT timestamp, tool_name, duration_ms, success, error
                                FROM tool_calls ORDER BY id DESC LIMIT 10""")
        recent_models = query("""SELECT timestamp, provider, model, input_tokens,
                                 output_tokens, cost_usd, latency_ms, fallback_reason
                              FROM model_usage ORDER BY id DESC LIMIT 10""")
        status["recent_tools"] = recent_tools
        status["recent_models"] = recent_models
        # Check if indexer is running (by looking for index_prs_commits.py in processes).
        # grep sai com codigo 1 quando nao acha nada - que e o caso normal, o indexer
        # quase sempre esta parado. Com check_output isso virava CalledProcessError e
        # derrubava o get_status() inteiro, entao aqui usamos run(check=False).
        ps = subprocess.run("ps -eo pid,comm,args | grep index_prs_commits | grep -v grep",
                            shell=True, text=True, capture_output=True)
        status["indexer_running"] = bool(ps.stdout.strip())
        # Get system uptime
        uptime = subprocess.check_output("cat /proc/uptime", shell=True, text=True).split()[0]
        status["uptime_seconds"] = float(uptime)
        status["timestamp"] = datetime.utcnow().isoformat() + "Z"
    except Exception as e:
        status["error"] = str(e)
    return status

def get_cronjobs():
    """List cron jobs and recent executions."""
    cron_dir = Path.home() / ".hermes" / "cron"
    jobs_path = cron_dir / "jobs.json"
    exec_db = cron_dir / "executions.db"
    result = {"jobs": [], "recent_executions": []}
    try:
        if jobs_path.exists():
            import json
            with open(jobs_path) as f:
                data = json.load(f)
                # data is a dict mapping job_id to job dict? Actually it's a list? Let's see.
                # We'll just load and return as is.
                result["jobs"] = data if isinstance(data, list) else [data]
        if exec_db.exists():
            conn = sqlite3.connect(str(exec_db))
            c = conn.cursor()
            c.execute("""SELECT job_id, start_time, end_time, exit_code, output_bytes
                         FROM executions ORDER BY start_time DESC LIMIT 20""")
            cols = [d[0] for d in c.description]
            rows = [dict(zip(cols, row)) for row in c.fetchall()]
            result["recent_executions"] = rows
            conn.close()
    except Exception as e:
        result["error"] = str(e)
    return result

def get_available_tools():
    """Return list of available tools (core + GitHub MCP if configured)."""
    core = [
        "web_search", "web_extract", "read_file", "write_file", "patch", "search_files",
        "terminal", "execute_code", "memory", "tool_search", "tool_describe", "tool_call",
        "browser_exec", "clarify", "computer_use", "cronjob", "delegate_task",
        "text_to_speech", "todo", "vision_analyze", "session_search", "skill_manage",
        "skill_view", "skills_list", "process"
    ]
    # Check if GitHub MCP is configured (token exists)
    github_tools = []
    token_path = Path.home() / ".hermes" / "config.yaml"
    if token_path.exists():
        import yaml
        try:
            with open(token_path) as f:
                cfg = yaml.safe_load(f)
            # We cannot easily know if github MCP is configured without checking config for github section.
            # For simplicity, we'll add a placeholder.
            github_tools = ["mcp__github__*", "mcp__vault__*"]  # indicate MCP tools available
        except:
            pass
    return {
        "core_tools": core,
        "github_mcp_tools": github_tools if github_tools else ["GitHub MCP tools available if token configured"],
        "note": "The full list of tools is defined in the system prompt; this endpoint returns the core tools always available."
    }

# --- Routes ---
@app.route("/")
def public():
    stats = get_public_stats()
    return render_template("public.html", stats=stats)

@app.route("/api/stats")
def api_stats():
    return jsonify(get_public_stats())

@app.route("/api/rag/children")
def api_rag_children():
    """Return direct children of a node (lazy expansion)."""
    parent = request.args.get("parent", "")
    if not parent or not RAG_PATH.exists():
        return jsonify({"children": [], "parent": parent})
    try:
        import lancedb
        db = lancedb.connect(str(RAG_PATH))
        tables = db.list_tables()
        table_list = tables.tables if hasattr(tables, 'tables') else tables
        if "github_docs" not in table_list:
            return jsonify({"children": [], "parent": parent})
        tbl = db.open_table("github_docs")
        df = tbl.to_pandas()
        if "parent_id" not in df.columns:
            return jsonify({"children": [], "parent": parent})
        children = df[df["parent_id"] == parent]
        result = []
        for _, row in children.iterrows():
            result.append({
                "id": row["id"],
                "title": row.get("title", row["id"]),
                "type": row.get("type", "?"),
                "state": row.get("state", ""),
                "url": row.get("url", ""),
                "repo": row.get("repo", ""),
                "size": len(str(row.get("content", "")))
            })
        return jsonify({"parent": parent, "children": result, "count": len(result)})
    except Exception as e:
        return jsonify({"error": str(e), "children": []})

@app.route("/api/rag/list")
def api_rag_list():
    return jsonify(get_rag_data())

@app.route("/api/rag/search")
def api_rag_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "query required", "results": []})
    limit = int(request.args.get("limit", 5))
    return jsonify({"query": q, "results": search_rag(q, limit)})

@app.route("/api/memory")
def api_memory():
    return jsonify(get_memory_context())

@app.route("/api/models")
def api_models():
    return jsonify(get_models_config())

@app.route("/api/vmstats")
def api_vmstats():
    return jsonify(get_vm_stats())

@app.route("/api/status")
def api_status():
    return jsonify(get_status())

@app.route("/api/cronjobs")
def api_cronjobs():
    return jsonify(get_cronjobs())

@app.route("/api/tools")
def api_tools():
    return jsonify(get_available_tools())

@app.route("/dashboard")
def dashboard():
    token = request.args.get("token", "")
    expected = "hermes-2026"
    if token != expected:
        return render_template("login.html"), 401
    models_cfg = get_models_config()
    stats = get_public_stats()
    return render_template("dashboard.html", models=models_cfg, stats=stats)

@app.route("/api/day/<date>")
def api_day(date):
    try:
        events = query("""SELECT timestamp, tool_name, duration_ms, success
                          FROM tool_calls WHERE date(timestamp) = ?
                          ORDER BY timestamp""", (date,))
        models = query("""SELECT timestamp, model, latency_ms
                          FROM model_usage WHERE date(timestamp) = ?
                          ORDER BY timestamp""", (date,))
    except DatabaseUnavailable as e:
        return jsonify({"date": date, "events": [], "error": str(e)})
    return jsonify({"date": date, "events": events + models})

@app.route("/api/recent")
def api_recent():
    limit = request.args.get("limit", 50, type=int)
    try:
        tools = query("""SELECT timestamp, tool_name, duration_ms, success, error
                         FROM tool_calls ORDER BY id DESC LIMIT ?""", (limit,))
        models = query("""SELECT timestamp, provider, model, input_tokens,
                                 output_tokens, cost_usd, latency_ms, fallback_reason
                          FROM model_usage ORDER BY id DESC LIMIT ?""", (limit,))
    except DatabaseUnavailable as e:
        return jsonify({"tools": [], "models": [], "error": str(e)})
    return jsonify({"tools": tools, "models": models})

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8080)