"""Hermes observability dashboard - rota publica + dashboard privado.

A coleta de dados mora no pacote hermes_dashboard/; aqui ficam so as rotas.
Rodar com: python3 app.py  (ou gunicorn app:app)
"""
import os
import traceback

from flask import Flask, jsonify, render_template, request

from hermes_dashboard import activity, cron, mcp, memory, rag, stats, tools, vm
from hermes_dashboard import db
from hermes_dashboard import config

app = Flask(__name__)

# SEM AUTENTICACAO por decisao explicita: o dashboard e as rotas /api/* estao
# abertas a quem alcancar a porta. Elas expoem processos, disco, memoria e o
# config (redigido) da VM - nao publique em interface externa sem por auth na
# frente (nginx com basic auth, tunel SSH, firewall).


@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "-1"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.errorhandler(Exception)
def handle_unexpected(error):
    """Rede de seguranca: um painel que quebra nao pode derrubar a pagina.

    Sem isso, qualquer excecao nao prevista num coletor virava uma tela de erro
    do Flask sem explicacao nenhuma pra quem esta olhando o dashboard.
    """
    from werkzeug.exceptions import HTTPException
    if isinstance(error, HTTPException):
        return error
    app.logger.exception("erro nao tratado em %s", request.path)
    detail = f"{type(error).__name__}: {error}"
    if request.path.startswith("/api/"):
        return jsonify({"error": detail}), 500
    if request.path.startswith("/fragments/"):
        return render_template("fragments/error.html", detail=detail), 200
    return render_template("error.html", detail=detail,
                           trace=traceback.format_exc()), 500


def json_guard(producer, empty):
    """Roda o coletor e devolve `empty` + mensagem quando o banco nao esta la."""
    try:
        return jsonify(producer())
    except db.DatabaseUnavailable as e:
        return jsonify(dict(empty, error=str(e)))


# --- publico ---

@app.route("/")
def public():
    return render_template("public.html", stats=stats.public_stats())


@app.route("/api/stats")
def api_stats():
    return jsonify(stats.public_stats())


# --- dashboard ---

@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html", stats=stats.public_stats(),
                           models=stats.models_config(),
                           paths={"db": str(config.DB_PATH), "rag": str(config.RAG_PATH)})


# --- aba: atividade ---

@app.route("/api/activity/heatmap")
def api_heatmap():
    days = max(30, min(731, request.args.get("days", 365, type=int)))
    kinds = [k for k in request.args.get("kinds", "").split(",") if k]
    return json_guard(lambda: activity.heatmap(days, kinds or None),
                      {"days": [], "max": 0, "total": 0, "series": []})


@app.route("/api/activity/day/<date>")
def api_activity_day(date):
    kinds = [k for k in request.args.get("kinds", "").split(",") if k]
    return json_guard(lambda: activity.day_activity(date, kinds or None),
                      {"date": date, "events": [], "count": 0, "by_kind": {}})


@app.route("/api/live")
def api_live():
    return jsonify(activity.live_snapshot())


@app.route("/fragments/live")
def fragment_live():
    """Fragmento HTML para o htmx trocar sozinho no topo da aba de atividade."""
    return render_template("fragments/live.html", live=activity.live_snapshot())


# --- aba: VM ---

@app.route("/api/vmstats")
def api_vmstats():
    breakdown = request.args.get("breakdown", "1") != "0"
    return jsonify(vm.snapshot(with_breakdown=breakdown))


# --- aba: tools ---

@app.route("/api/tools")
def api_tools():
    days = max(1, min(365, request.args.get("days", 30, type=int)))
    return jsonify(tools.catalog(days))


# --- aba: MCPs ---

@app.route("/api/mcps")
def api_mcps():
    days = max(1, min(365, request.args.get("days", 30, type=int)))
    return jsonify(mcp.servers(days))


# --- aba: memoria ---

@app.route("/api/memory")
def api_memory():
    return jsonify(memory.catalog())


@app.route("/api/memory/doc")
def api_memory_doc():
    path = request.args.get("path", "")
    if not path:
        return jsonify({"error": "parametro path obrigatorio"}), 400
    try:
        return jsonify(memory.read_document(path))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except OSError as e:
        return jsonify({"error": str(e)}), 500


# --- aba: RAG ---

@app.route("/api/rag/graph")
def api_rag_graph():
    return jsonify(rag.graph(request.args.get("parent") or None))


@app.route("/api/rag/list")
def api_rag_list():
    return jsonify(rag.catalog())


@app.route("/api/rag/search")
def api_rag_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"query": "", "hits": [], "graph": None,
                        "error": "informe um termo de busca"})
    limit = max(1, min(50, request.args.get("limit", 12, type=int)))
    return jsonify(rag.search_result(q, limit))


# --- aba: cron ---

@app.route("/api/cronjobs")
def api_cronjobs():
    return jsonify(cron.overview())


# --- compatibilidade com a versao anterior da API ---

@app.route("/api/models")
def api_models():
    return jsonify(stats.models_config())


@app.route("/api/status")
def api_status():
    live = activity.live_snapshot()
    return jsonify({
        "busy": live["busy"],
        "recent": live["events"],
        "processes": live["processes"],
        "uptime_seconds": vm.uptime_seconds(),
        "timestamp": live["now"],
    })


@app.route("/api/recent")
def api_recent():
    limit = max(1, min(500, request.args.get("limit", 50, type=int)))
    try:
        rows = db.query(
            """SELECT timestamp, tool_name, duration_ms, success, error
               FROM tool_calls ORDER BY id DESC LIMIT ?""", (limit,))
        models = db.query(
            """SELECT timestamp, provider, model, input_tokens, output_tokens,
                      cost_usd, latency_ms, fallback_reason
               FROM model_usage ORDER BY id DESC LIMIT ?""", (limit,))
    except db.DatabaseUnavailable as e:
        return jsonify({"tools": [], "models": [], "error": str(e)})
    return jsonify({"tools": rows, "models": models})


@app.route("/api/day/<date>")
def api_day(date):
    return json_guard(lambda: activity.day_activity(date),
                      {"date": date, "events": [], "count": 0})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 8080)))
