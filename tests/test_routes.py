"""Nenhuma rota pode responder 500, em nenhum estado de VM plausivel."""
import pytest

from conftest import ROUTES


def check_all(client, contexto):
    falhas = []
    for route in ROUTES:
        res = client.get(route)
        if res.status_code >= 500:
            body = res.get_data(as_text=True)[:400]
            falhas.append(f"{route} -> {res.status_code}\n{body}")
    assert not falhas, f"[{contexto}] rotas com erro:\n\n" + "\n\n".join(falhas)


def test_maquina_limpa(client):
    """Nada instalado: sem banco, sem ~/.hermes, sem RAG."""
    check_all(client, "maquina limpa")


def test_banco_vazio_sem_tabelas(vm, client):
    vm.db(["CREATE TABLE outra_coisa (id INTEGER)"])
    check_all(client, "banco sem as tabelas esperadas")


def test_schema_minimo(vm, client):
    """events.db so com o essencial: sem duration_ms, success, error, custo."""
    vm.db(
        ["CREATE TABLE tool_calls (timestamp TEXT, tool_name TEXT)",
         "CREATE TABLE model_usage (timestamp TEXT, model TEXT)"],
        [("INSERT INTO tool_calls VALUES (?,?)", ("2026-09-08T10:00:00", "read_file")),
         ("INSERT INTO model_usage VALUES (?,?)", ("2026-09-08T10:00:00", "gpt-5.6-luna"))],
    )
    check_all(client, "schema minimo")


def test_colunas_de_tempo_alternativas(vm, client):
    """Instalacao que chama a coluna de tempo de 'ts' em vez de 'timestamp'."""
    vm.db(
        ["CREATE TABLE tool_calls (ts TEXT, tool_name TEXT, duration_ms INT)",
         "CREATE TABLE prompts (created_at TEXT, prompt TEXT)"],
        [("INSERT INTO tool_calls VALUES (?,?,?)", ("2026-09-08T10:00:00", "patch", 12)),
         ("INSERT INTO prompts VALUES (?,?)", ("2026-09-08T11:00:00", "oi"))],
    )
    check_all(client, "coluna de tempo alternativa")
    data = client.get("/api/activity/heatmap?days=30").get_json()
    assert {s["kind"] for s in data["series"]} == {"tool", "prompt"}


def test_valores_nulos_e_sujos(vm, client):
    """NULL em toda coluna opcional, timestamp vazio, tool_name None."""
    vm.db(
        ["""CREATE TABLE tool_calls (timestamp TEXT, tool_name TEXT, duration_ms INT,
                                     success INT, error TEXT)""",
         """CREATE TABLE model_usage (timestamp TEXT, provider TEXT, model TEXT,
                                      input_tokens INT, output_tokens INT,
                                      cost_usd REAL, latency_ms INT, fallback_reason TEXT)"""],
        [("INSERT INTO tool_calls VALUES (?,?,?,?,?)", (None, None, None, None, None)),
         ("INSERT INTO tool_calls VALUES (?,?,?,?,?)", ("", "x", None, None, None)),
         ("INSERT INTO model_usage VALUES (?,?,?,?,?,?,?,?)",
          ("2026-09-08T10:00:00", None, None, None, None, None, None, None))],
    )
    check_all(client, "valores nulos")


@pytest.mark.parametrize("texto,rotulo", [
    ("- isso\n- e\n- uma lista\n", "yaml e lista no topo"),
    ("so uma string\n", "yaml e string"),
    ("", "yaml vazio"),
    ("model: nao-e-um-mapa\n", "model e string"),
    ("model:\n  provider: x\nfallback_providers: nao-e-lista\n", "fallbacks e string"),
    ("mcp_servers: [a, b, c]\n", "mcp_servers e lista de strings"),
    ("mcp_servers:\n  github: so-uma-string\n", "servidor e string"),
    ("mcp_servers:\n  github:\n    tools:\n      a: 1\n      b: 2\n", "tools e mapa"),
    ("chave: [sem, fechar\n", "yaml quebrado"),
])
def test_formatos_de_config(vm, client, texto, rotulo):
    vm.config_yaml(texto)
    check_all(client, rotulo)


@pytest.mark.parametrize("texto,rotulo", [
    ('{"a": {"schedule": "* * * * *"}}', "jobs.json e mapa de jobs"),
    ('[{"id": "x"}]', "job sem schedule nem command"),
    ('"so uma string"', "jobs.json e string"),
    ('[1, 2, 3]', "jobs.json e lista de numeros"),
    ('{ nao e json', "jobs.json quebrado"),
    ('null', "jobs.json null"),
])
def test_formatos_de_cron(vm, client, texto, rotulo):
    vm.cron(jobs_text=texto)
    check_all(client, rotulo)


def test_executions_com_schema_diferente(vm, client):
    vm.cron(jobs_text="[]", executions_ddl=["CREATE TABLE executions (job_id TEXT)"])
    check_all(client, "executions sem as colunas esperadas")


@pytest.mark.parametrize("exc", [
    RuntimeError("lancedb explodiu"),
    ImportError("No module named 'lancedb'"),
    OSError("disco cheio"),
    ValueError("schema incompativel"),
    KeyError("content"),
    MemoryError(),
])
def test_rag_explodindo(vm, client, exc):
    """A base vetorial pode falhar de N jeitos; nenhum deles pode virar 500."""
    vm.rag_raises(exc)
    check_all(client, f"rag levantando {type(exc).__name__}")


def test_diretorio_de_memoria_sem_permissao(vm, client):
    import os
    protegido = vm.hermes / "memories"
    protegido.mkdir()
    (protegido / "ok.md").write_text("conteudo")
    os.chmod(protegido, 0o000)
    try:
        check_all(client, "diretorio de memoria sem permissao")
    finally:
        os.chmod(protegido, 0o755)


def test_symlink_quebrado_na_memoria(vm, client):
    memories = vm.hermes / "memories"
    memories.mkdir()
    (memories / "morto.md").symlink_to(vm.root / "nao-existe.md")
    check_all(client, "symlink quebrado")


def test_model_usage_sem_custo_nem_fallback(vm, client):
    """events.db enxuto: sem cost_usd e sem fallback_reason."""
    vm.db(
        ["CREATE TABLE model_usage (timestamp TEXT, model TEXT)",
         "CREATE TABLE tool_calls (timestamp TEXT, tool_name TEXT)"],
        [("INSERT INTO model_usage VALUES (?,?)", ("2026-09-09T10:00:00", "gpt-5.6-luna")),
         ("INSERT INTO tool_calls VALUES (?,?)", ("2026-09-09T10:00:00", "read_file"))],
    )
    check_all(client, "sem custo nem fallback")
    stats = client.get("/api/stats").get_json()
    assert stats.get("error") is None, stats.get("error")
    assert stats["total_calls"] == 1, stats
    assert stats["total_cost"] == 0
    ferramentas = client.get("/api/tools").get_json()
    assert ferramentas.get("error") is None, ferramentas.get("error")
    assert ferramentas["total_calls"] == 1, ferramentas


def test_tool_calls_sem_success_nem_error(vm, client):
    vm.db(
        ["CREATE TABLE tool_calls (timestamp TEXT, tool_name TEXT, duration_ms INT)"],
        [("INSERT INTO tool_calls VALUES (?,?,?)", ("2026-09-09T10:00:00", "mcp__github__x", 30))],
    )
    check_all(client, "tool_calls sem success/error")
    t = client.get("/api/tools").get_json()
    assert t["total_calls"] == 1 and t["tools"][0]["avg_ms"] == 30, t
    m = client.get("/api/mcps").get_json()
    assert m["total_calls"] == 1, m


def test_paginas_html_renderizam(vm, client):
    """As duas paginas tem que voltar 200 com o esqueleto certo, nao so nao-500."""
    vm.db(["CREATE TABLE model_usage (timestamp TEXT, model TEXT, cost_usd REAL)",
           "CREATE TABLE tool_calls (timestamp TEXT, tool_name TEXT)"])
    home = client.get("/")
    assert home.status_code == 200
    assert b"Estatisticas publicas" in home.data

    dash = client.get("/dashboard")
    assert dash.status_code == 200, dash.get_data(as_text=True)[:500]
    corpo = dash.get_data(as_text=True)
    for aba in ["panel-atividade", "panel-vm", "panel-tools", "panel-mcps",
                "panel-memoria", "panel-rag", "panel-cron"]:
        assert aba in corpo, f"faltou {aba} no HTML do dashboard"
    assert "js/app.js" in corpo and "vendor/htmx.min.js" in corpo
    assert "url_for" not in corpo, "sobrou url_for nao resolvido no HTML"


def test_memory_doc_casos_ruins(vm, client):
    memories = vm.hermes / "memories"
    memories.mkdir()
    (memories / "ok.md").write_text("# titulo\nconteudo")
    (memories / "binario.md").write_bytes(b"\xff\xfe\x00 lixo binario \x00")

    assert client.get("/api/memory/doc").status_code == 400
    assert client.get("/api/memory/doc?path=/etc/passwd").status_code == 400
    assert client.get(f"/api/memory/doc?path={memories}").status_code == 400  # diretorio
    assert client.get(f"/api/memory/doc?path={memories / 'nao-existe.md'}").status_code == 400

    ok = client.get(f"/api/memory/doc?path={memories / 'ok.md'}")
    assert ok.status_code == 200 and "conteudo" in ok.get_json()["content"]

    binario = client.get(f"/api/memory/doc?path={memories / 'binario.md'}")
    assert binario.status_code == 200, "binario deve ser lido com replace, nao explodir"


def test_config_yaml_redigido(vm, client):
    vm.config_yaml("model:\n  provider: x\n  api_key: sk-SEGREDO\ntoken: ghp_SEGREDO\n")
    doc = client.get(f"/api/memory/doc?path={vm.hermes / 'config.yaml'}").get_json()
    assert doc["redacted"] is True
    assert "SEGREDO" not in doc["content"], doc["content"]
    assert "provider: x" in doc["content"]


def test_timestamp_em_epoch(vm, client):
    """Muita instalacao grava timestamp como inteiro unix, nao como ISO."""
    import time
    agora = int(time.time())
    vm.db(
        ["""CREATE TABLE tool_calls (timestamp INTEGER, tool_name TEXT,
                                     duration_ms INT, success INT, error TEXT)""",
         """CREATE TABLE model_usage (timestamp INTEGER, model TEXT, cost_usd REAL)"""],
        [("INSERT INTO tool_calls VALUES (?,?,?,?,?)", (agora - 30, "read_file", 12, 1, "")),
         ("INSERT INTO tool_calls VALUES (?,?,?,?,?)", (agora - 86400, "patch", 20, 1, "")),
         ("INSERT INTO model_usage VALUES (?,?,?)", (agora - 30, "gpt-5.6-luna", 0.01))],
    )
    check_all(client, "timestamp em epoch")
    heat = client.get("/api/activity/heatmap?days=30").get_json()
    assert heat["total"] == 3, f"epoch deveria contar no heatmap: {heat['total']}"
    ao_vivo = client.get("/fragments/live")
    assert ao_vivo.status_code == 200, ao_vivo.get_data(as_text=True)[:300]
