"""Base vetorial: catalogo, grafo navegavel e busca semantica.

A leitura do lancedb (documents(), search()) fica separada da montagem do grafo
(build_graph, build_search_graph): assim o formato do mapa mental e testavel sem
banco vetorial nenhum, e a tela degrada pra "RAG nao configurado" sem quebrar.
"""
from . import config

TABLE = "github_docs"
ROOT_ID = "root"

# Rotulo e ordem das categorias dentro de um repositorio.
CATEGORY_LABELS = {
    "issue": "Issues",
    "pr": "Pull requests",
    "pull_request": "Pull requests",
    "commit": "Commits",
    "readme": "READMEs",
    "doc": "Docs",
}

_EMBED_MODEL = None


def _get_embed_model():
    global _EMBED_MODEL
    if _EMBED_MODEL is None:
        from fastembed import TextEmbedding
        _EMBED_MODEL = TextEmbedding(
            model_name="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
            max_length=512,
        )
    return _EMBED_MODEL


def _open_table():
    """Abre a tabela do lancedb. Levanta RuntimeError com motivo legivel."""
    if not config.RAG_PATH.exists():
        raise RuntimeError(f"base vetorial nao encontrada em {config.RAG_PATH}")
    try:
        import lancedb
    except ImportError as e:
        raise RuntimeError("lancedb nao instalado") from e
    db = lancedb.connect(str(config.RAG_PATH))
    tables = db.list_tables()
    table_list = tables.tables if hasattr(tables, "tables") else tables
    if TABLE not in table_list:
        raise RuntimeError(f"tabela {TABLE} nao existe na base vetorial")
    return db.open_table(TABLE)


def _records(df, preview=200):
    """DataFrame do lancedb -> lista de dicts, sem o vetor (que e enorme)."""
    keep = [c for c in ("id", "title", "repo", "type", "state", "url", "category",
                        "parent_id", "number", "author", "created_at")
            if c in df.columns]
    out = []
    for _, row in df.iterrows():
        item = {k: (None if _isnan(row[k]) else row[k]) for k in keep}
        content = row["content"] if "content" in df.columns else ""
        content = "" if _isnan(content) else str(content)
        item["size"] = len(content)
        item["preview"] = content[:preview]
        if "_distance" in df.columns and not _isnan(row["_distance"]):
            item["distance"] = float(row["_distance"])
        out.append(item)
    return out


def _isnan(v):
    try:
        return v != v  # NaN e o unico valor diferente de si mesmo
    except Exception:
        return False


def documents(preview=200):
    tbl = _open_table()
    df = tbl.to_pandas()
    return _records(df, preview)


def _describe_failure(e):
    """Mensagem legivel para qualquer falha da base vetorial.

    lancedb/pyarrow/pandas levantam de tudo (ImportError, OSError, KeyError,
    ValueError, ate MemoryError numa tabela grande). Nenhuma dessas pode virar
    500: a aba mostra o motivo e as outras seis seguem funcionando.
    """
    if isinstance(e, RuntimeError):
        return str(e)
    return f"falha ao ler a base vetorial ({type(e).__name__}): {e}"


def catalog():
    """Lista completa + contagens por repo e por tipo."""
    try:
        docs = documents()
    except Exception as e:
        return {"docs": [], "by_repo": {}, "by_type": {}, "total": 0,
                "error": _describe_failure(e)}
    by_repo, by_type = {}, {}
    for d in docs:
        repo = d.get("repo") or "sem repo"
        kind = d.get("type") or "doc"
        entry = by_repo.setdefault(repo, {"repo": repo, "count": 0, "types": {}})
        entry["count"] += 1
        entry["types"][kind] = entry["types"].get(kind, 0) + 1
        by_type[kind] = by_type.get(kind, 0) + 1
    return {
        "docs": docs,
        "by_repo": sorted(by_repo.values(), key=lambda r: -r["count"]),
        "by_type": by_type,
        "total": len(docs),
    }


def _node(node_id, label, kind, **extra):
    node = {"id": node_id, "label": label, "kind": kind}
    node.update(extra)
    return node


def build_graph(docs, parent=None, doc_limit=60):
    """Nos e arestas de um nivel do mapa mental.

    Niveis: root (GitHub) -> repo -> categoria (issues/prs/...) -> documento.
    O grafo e carregado por nivel para o cytoscape nao receber milhares de nos
    de uma vez; cada no diz em `expandable` se vale pedir os filhos dele.
    """
    nodes, edges = [], []

    def link(source, target):
        edges.append({"id": f"{source}->{target}", "source": source, "target": target})

    if not parent or parent == ROOT_ID:
        repos = {}
        for d in docs:
            repo = d.get("repo") or "sem repo"
            repos[repo] = repos.get(repo, 0) + 1
        nodes.append(_node(ROOT_ID, "GitHub", "root", count=len(docs), expandable=True))
        for repo, count in sorted(repos.items(), key=lambda kv: -kv[1]):
            node_id = f"repo:{repo}"
            nodes.append(_node(node_id, repo, "repo", count=count, expandable=True))
            link(ROOT_ID, node_id)
        return {"parent": ROOT_ID, "nodes": nodes, "edges": edges}

    if parent.startswith("repo:"):
        repo = parent[len("repo:"):]
        cats = {}
        for d in docs:
            if (d.get("repo") or "sem repo") != repo:
                continue
            kind = d.get("type") or "doc"
            cats[kind] = cats.get(kind, 0) + 1
        for kind, count in sorted(cats.items(), key=lambda kv: -kv[1]):
            node_id = f"cat:{repo}:{kind}"
            label = CATEGORY_LABELS.get(kind, kind.title())
            nodes.append(_node(node_id, f"{label} ({count})", "category",
                               count=count, repo=repo, doc_type=kind, expandable=True))
            link(parent, node_id)
        return {"parent": parent, "nodes": nodes, "edges": edges}

    if parent.startswith("cat:"):
        _, repo, kind = parent.split(":", 2)
        matching = [d for d in docs
                    if (d.get("repo") or "sem repo") == repo
                    and (d.get("type") or "doc") == kind]
        for d in matching[:doc_limit]:
            node_id = f"doc:{d.get('id')}"
            label = d.get("title") or d.get("id") or "(sem titulo)"
            nodes.append(_node(node_id, label, "doc", expandable=False,
                               repo=repo, doc_type=kind, state=d.get("state"),
                               url=d.get("url"), size=d.get("size"),
                               preview=d.get("preview")))
            link(parent, node_id)
        truncated = max(0, len(matching) - doc_limit)
        return {"parent": parent, "nodes": nodes, "edges": edges,
                "truncated": truncated}

    return {"parent": parent, "nodes": [], "edges": []}


def graph(parent=None):
    try:
        docs = documents(preview=160)
    except Exception as e:
        return {"parent": parent or ROOT_ID, "nodes": [], "edges": [],
                "error": _describe_failure(e)}
    return build_graph(docs, parent)


def build_search_graph(query_text, hits):
    """Grafo da busca: a consulta no centro, resultados ao redor por similaridade.

    A distancia do lancedb e menor-e-melhor; convertemos para uma similaridade
    0..1 relativa ao pior resultado da propria busca, que e o que importa pra
    dimensionar os nos entre si.
    """
    nodes = [_node("query", query_text, "query", expandable=False)]
    edges = []
    distances = [h["distance"] for h in hits if h.get("distance") is not None]
    worst = max(distances) if distances else None
    best = min(distances) if distances else None
    spread = (worst - best) if (worst is not None and worst > best) else None

    by_repo = {}
    for hit in hits:
        repo = hit.get("repo") or "sem repo"
        by_repo.setdefault(repo, []).append(hit)

    for repo, group in by_repo.items():
        repo_id = f"srepo:{repo}"
        nodes.append(_node(repo_id, repo, "repo", count=len(group), expandable=False))
        edges.append({"id": f"query->{repo_id}", "source": "query", "target": repo_id})
        for hit in group:
            node_id = f"doc:{hit.get('id')}"
            distance = hit.get("distance")
            if distance is None or spread is None:
                score = 0.5
            else:
                score = 1 - (distance - best) / spread
            nodes.append(_node(
                node_id, hit.get("title") or hit.get("id") or "(sem titulo)", "doc",
                expandable=False, repo=repo, doc_type=hit.get("type"),
                state=hit.get("state"), url=hit.get("url"),
                preview=hit.get("preview"), distance=distance,
                score=round(score, 3),
            ))
            edges.append({"id": f"{repo_id}->{node_id}", "source": repo_id,
                          "target": node_id, "score": round(score, 3)})
    return {"query": query_text, "nodes": nodes, "edges": edges, "count": len(hits)}


def search(query_text, limit=12):
    """Busca semantica. Levanta RuntimeError com motivo legivel."""
    if not query_text:
        return []
    tbl = _open_table()
    model = _get_embed_model()
    raw = next(iter(model.embed([query_text[:4000]])))
    # o fastembed devolve ndarray, mas nem toda versao/backend devolve - aceitar
    # os dois evita um AttributeError no meio da busca
    vector = raw.tolist() if hasattr(raw, "tolist") else list(raw)
    df = tbl.search(vector).limit(limit).to_pandas()
    return _records(df, preview=400)


def search_result(query_text, limit=12):
    try:
        hits = search(query_text, limit)
        return {"query": query_text, "hits": hits,
                "graph": build_search_graph(query_text, hits)}
    except Exception as e:
        return {"query": query_text, "hits": [], "graph": None,
                "error": _describe_failure(e)}
