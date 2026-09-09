"""Acesso ao events.db.

O banco e escrito pelo agente, entao o dashboard so le - e le defensivamente:
o schema na VM pode ter mais (ou menos) tabelas do que aqui. Nada de assumir
que uma tabela existe; quem chama pergunta antes com table_exists().
"""
import sqlite3
from .config import DB_PATH


class DatabaseUnavailable(Exception):
    """O events.db nao existe ainda, ou nao tem a tabela pedida."""


def connect():
    if not DB_PATH.exists():
        raise DatabaseUnavailable(f"banco nao encontrado em {DB_PATH}")
    try:
        return sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    except sqlite3.OperationalError as e:
        raise DatabaseUnavailable(f"nao consegui abrir {DB_PATH}: {e}") from e


def query(sql, params=()):
    conn = connect()
    try:
        c = conn.cursor()
        c.execute(sql, params)
        cols = [d[0] for d in c.description] if c.description else []
        return [dict(zip(cols, row)) for row in c.fetchall()]
    except sqlite3.OperationalError as e:
        raise DatabaseUnavailable(str(e)) from e
    finally:
        conn.close()


def tables():
    """Nomes das tabelas do banco. [] se o banco nao existe."""
    try:
        rows = query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    except DatabaseUnavailable:
        return []
    return [r["name"] for r in rows]


def table_exists(name):
    return name in tables()


def columns(table):
    """Colunas de uma tabela, como set. Vazio se a tabela nao existe."""
    try:
        rows = query(f"PRAGMA table_info({_ident(table)})")
    except DatabaseUnavailable:
        return set()
    return {r["name"] for r in rows}


def _ident(name):
    """Sanitiza um nome de tabela para interpolar em PRAGMA/FROM.

    PRAGMA e FROM nao aceitam placeholder, entao o nome entra por formatacao -
    e por isso so deixamos passar nome que veio do proprio sqlite_master.
    """
    if not name.replace("_", "").isalnum():
        raise ValueError(f"nome de tabela invalido: {name!r}")
    return name


def pick_column(table, candidates):
    """Primeira coluna de `candidates` que existe em `table`, ou None."""
    cols = columns(table)
    for name in candidates:
        if name in cols:
            return name
    return None
