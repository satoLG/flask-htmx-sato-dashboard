"""Fixtures que repontam o dashboard pra um HOME descartavel.

Cada teste monta a "VM" que quer (schema do banco, formato do config, permissoes)
e chama as rotas de verdade pelo test_client do Flask.
"""
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hermes_dashboard import config  # noqa: E402
import app as app_module  # noqa: E402


@pytest.fixture
def vm(tmp_path, monkeypatch):
    """Aponta todos os caminhos pra tmp_path e devolve um helper de montagem."""
    hermes = tmp_path / ".hermes"
    obs = tmp_path / "hermes-observability"
    hermes.mkdir()
    obs.mkdir()
    monkeypatch.setattr(config, "HERMES_HOME", hermes)
    monkeypatch.setattr(config, "DB_PATH", obs / "events.db")
    monkeypatch.setattr(config, "RAG_PATH", tmp_path / "rag-db")
    monkeypatch.setattr(config, "CONFIG_PATH", hermes / "config.yaml")
    monkeypatch.setattr(config, "CRON_DIR", hermes / "cron")
    monkeypatch.setattr(config, "LOG_PATH", None)
    return Fake(tmp_path, hermes, obs, monkeypatch)


class Fake:
    def __init__(self, root, hermes, obs, monkeypatch):
        self.root, self.hermes, self.obs = root, hermes, obs
        self.monkeypatch = monkeypatch

    def db(self, ddl, rows=()):
        """Cria o events.db com o DDL dado e insere as linhas pedidas."""
        conn = sqlite3.connect(self.obs / "events.db")
        for statement in ddl:
            conn.execute(statement)
        for sql, params in rows:
            conn.execute(sql, params)
        conn.commit()
        conn.close()

    def config_yaml(self, text):
        (self.hermes / "config.yaml").write_text(text)

    def cron(self, jobs_text=None, executions_ddl=None):
        cron_dir = self.hermes / "cron"
        cron_dir.mkdir(exist_ok=True)
        if jobs_text is not None:
            (cron_dir / "jobs.json").write_text(jobs_text)
        if executions_ddl:
            conn = sqlite3.connect(cron_dir / "executions.db")
            for statement in executions_ddl:
                conn.execute(statement)
            conn.commit()
            conn.close()

    def rag_raises(self, exc):
        """Faz a leitura da base vetorial explodir do jeito pedido."""
        from hermes_dashboard import rag

        def boom(*_a, **_k):
            raise exc
        self.monkeypatch.setattr(rag, "documents", boom)
        self.monkeypatch.setattr(rag, "search", boom)


@pytest.fixture
def client(vm):
    app_module.app.config.update(TESTING=True)
    return app_module.app.test_client()


# Toda rota que a interface chama. Se alguma responder 500, o teste falha.
ROUTES = [
    "/",
    "/dashboard",
    "/api/stats",
    "/api/activity/heatmap?days=365",
    "/api/activity/heatmap?days=90&kinds=tool",
    "/api/activity/day/2026-09-08",
    "/api/live",
    "/fragments/live",
    "/api/vmstats",
    "/api/vmstats?breakdown=0",
    "/api/tools",
    "/api/tools?days=7",
    "/api/mcps",
    "/api/memory",
    "/api/rag/graph",
    "/api/rag/graph?parent=repo:x/y",
    "/api/rag/list",
    "/api/rag/search?q=teste",
    "/api/cronjobs",
    "/api/models",
    "/api/status",
    "/api/recent",
    "/api/day/2026-09-08",
]
