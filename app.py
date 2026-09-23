"""Hermes observability dashboard - rota publica + dashboard privado.

A coleta de dados mora no pacote hermes_dashboard/; aqui ficam so as rotas.
Rodar com: python3 app.py  (ou gunicorn app:app)
"""
import hashlib
import os
import traceback
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request

from hermes_dashboard import activity, cron, lab, mcp, memory, rag, stats, tools, vm, web_chat
from hermes_dashboard import db
from hermes_dashboard import config

app = Flask(__name__)
web_chat.configure(app)

# A version in the path also versions relative ES-module imports and GLB URLs.
# Reusing /static/js/lab.js can pair cached pre-immersive JS with today's HTML.
_static_root = Path(app.static_folder)
_lab_files = sorted(path for path in _static_root.rglob('*') if path.is_file())
_lab_digest = hashlib.sha256()
for _path in [Path(app.root_path) / 'templates/lab.html', *_lab_files]:
    _lab_digest.update(str(_path.relative_to(app.root_path)).replace('\\', '/').encode())
    _lab_digest.update(b'\0')
    _lab_digest.update(_path.read_bytes())
LAB_ASSET_VERSION = _lab_digest.hexdigest()[:16]

# O dashboard de observabilidade existente continua público. O novo chat Hermes
# tem autenticação própria; não confundir essa proteção com a das demais rotas.


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
    if request.path.startswith("/api/lab/hermes-chat"):
        return jsonify({"error": "Chat indisponível. Tente novamente."}), 500
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

@app.route("/lab")
def laboratory():
    return render_template("lab.html", lab_asset_version=LAB_ASSET_VERSION)


@app.route("/lab-assets/<version>/<path:filename>")
def lab_asset(version, filename):
    if version != LAB_ASSET_VERSION:
        abort(404)
    return app.send_static_file(filename)


@app.route("/api/lab/state")
def api_lab_state():
    return jsonify(lab.snapshot())


@app.post("/api/lab/chat")
def api_lab_chat():
    if request.content_length and request.content_length > 4096:
        return jsonify({"error": "mensagem muito grande"}), 413
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "envie robot_id e question em JSON"}), 400
    robot_id, question = data.get("robot_id"), data.get("question")
    if not isinstance(robot_id, str) or not isinstance(question, str) or not question.strip() or len(question) > 500 or len(robot_id) > 100:
        return jsonify({"error": "robô e pergunta obrigatórios; máximo de 500 caracteres"}), 400
    response = lab.answer(robot_id, question.strip())
    return (jsonify(response), 200) if response else (jsonify({"error": "Este robô não está mais no snapshot. Atualize o laboratório."}), 404)


@app.get("/api/lab/hermes-chat/session")
def api_hermes_chat_session():
    return web_chat.session_status()


@app.post("/api/lab/hermes-chat/login")
def api_hermes_chat_login():
    return web_chat.login()


@app.post("/api/lab/hermes-chat/jobs")
def api_hermes_chat_submit():
    return web_chat.submit()


@app.get("/api/lab/hermes-chat/jobs/<job_id>")
def api_hermes_chat_job(job_id):
    return web_chat.job(job_id)


@app.get("/api/lab/hermes-chat/history")
def api_hermes_chat_history():
    return web_chat.history()

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


web_chat.start_worker()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 8080)))
