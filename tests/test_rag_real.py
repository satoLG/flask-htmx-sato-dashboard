"""RAG contra um lancedb de verdade - o caminho que so tinha rodado com mock."""
import random

import pytest

from conftest import ROUTES

lancedb = pytest.importorskip("lancedb")
pytest.importorskip("pandas")


def build_table(path, rows):
    db = lancedb.connect(str(path))
    db.create_table("github_docs", data=rows)
    return db


def base_rows(n=40, dim=8):
    random.seed(5)
    repos = ["satoLG/hermes", "satoLG/portfolio"]
    kinds = ["issue", "pr", "readme"]
    return [{
        "id": f"d{i}",
        "title": f"documento {i}",
        "repo": random.choice(repos),
        "type": random.choice(kinds),
        "state": random.choice(["open", "closed"]),
        "url": f"https://github.com/x/{i}",
        "content": f"conteudo do documento {i} " * 10,
        "vector": [random.random() for _ in range(dim)],
    } for i in range(n)]


def check_all(client, contexto):
    falhas = []
    for route in ROUTES:
        res = client.get(route)
        if res.status_code >= 500:
            falhas.append(f"{route} -> {res.status_code}\n{res.get_data(as_text=True)[:300]}")
    assert not falhas, f"[{contexto}]\n" + "\n\n".join(falhas)


def test_rag_completo(vm, client):
    build_table(vm.root / "rag-db", base_rows())
    check_all(client, "lancedb real")

    listagem = client.get("/api/rag/list").get_json()
    assert listagem.get("error") is None, listagem.get("error")
    assert listagem["total"] == 40
    assert listagem["by_repo"], "deveria agrupar por repositorio"

    raiz = client.get("/api/rag/graph").get_json()
    assert raiz.get("error") is None, raiz.get("error")
    kinds = {n["kind"] for n in raiz["nodes"]}
    assert kinds == {"root", "repo"}, kinds

    repo = raiz["nodes"][1]["id"]
    nivel2 = client.get(f"/api/rag/graph?parent={repo}").get_json()
    assert nivel2["nodes"], "repositorio deveria abrir em categorias"
    assert {n["kind"] for n in nivel2["nodes"]} == {"category"}

    cat = nivel2["nodes"][0]["id"]
    nivel3 = client.get(f"/api/rag/graph?parent={cat}").get_json()
    assert nivel3["nodes"], "categoria deveria abrir em documentos"
    assert {n["kind"] for n in nivel3["nodes"]} == {"doc"}
    assert nivel3["nodes"][0]["preview"], "documento deveria trazer previa"


def test_tabela_sem_colunas_opcionais(vm, client):
    """Base indexada sem state/url/title: nao pode quebrar nem sumir com os docs."""
    rows = [{"id": f"d{i}", "repo": "satoLG/hermes", "type": "issue",
             "content": f"texto {i}", "vector": [0.1, 0.2, 0.3]} for i in range(5)]
    build_table(vm.root / "rag-db", rows)
    check_all(client, "tabela sem colunas opcionais")
    data = client.get("/api/rag/list").get_json()
    assert data.get("error") is None, data.get("error")
    assert data["total"] == 5


def test_tabela_sem_content(vm, client):
    """Sem a coluna content o preview some, mas a lista tem que continuar vindo."""
    rows = [{"id": f"d{i}", "repo": "r", "type": "issue", "body": f"texto {i}",
             "vector": [0.1, 0.2]} for i in range(4)]
    build_table(vm.root / "rag-db", rows)
    check_all(client, "tabela sem content")
    data = client.get("/api/rag/list").get_json()
    assert data.get("error") is None, data.get("error")
    assert data["total"] == 4


def test_tabela_vazia(vm, client):
    db = lancedb.connect(str(vm.root / "rag-db"))
    import pyarrow as pa
    db.create_table("github_docs", schema=pa.schema([
        pa.field("id", pa.string()), pa.field("repo", pa.string()),
        pa.field("type", pa.string()), pa.field("content", pa.string()),
        pa.field("vector", pa.list_(pa.float32(), 3)),
    ]))
    check_all(client, "tabela vazia")
    assert client.get("/api/rag/list").get_json()["total"] == 0


def test_tabela_com_outro_nome(vm, client):
    build_table(vm.root / "rag-db", base_rows(5))
    db = lancedb.connect(str(vm.root / "rag-db"))
    db.drop_table("github_docs")
    db.create_table("outra_tabela", data=base_rows(5))
    check_all(client, "tabela com outro nome")
    data = client.get("/api/rag/list").get_json()
    assert "github_docs" in (data.get("error") or ""), data


def test_busca_semantica(vm, client, monkeypatch):
    """Busca real no lancedb, com o embedding trocado (fastembed nao esta aqui)."""
    build_table(vm.root / "rag-db", base_rows(30))
    from hermes_dashboard import rag

    class FakeModel:
        def embed(self, texts):
            random.seed(len(texts[0]))
            return iter([[random.random() for _ in range(8)]])

    monkeypatch.setattr(rag, "_get_embed_model", lambda: FakeModel())
    data = client.get("/api/rag/search?q=fallback%20de%20modelo&limit=6").get_json()
    assert data.get("error") is None, data.get("error")
    assert len(data["hits"]) == 6
    assert data["graph"]["nodes"], "a busca deveria montar o grafo"
    scores = [n["score"] for n in data["graph"]["nodes"] if n["kind"] == "doc"]
    assert scores and min(scores) >= 0 and max(scores) <= 1, scores
