"""Acesso ao events.db.

O banco e escrito pelo agente, entao o dashboard so le - e le defensivamente:
o schema na VM pode ter mais (ou menos) tabelas do que aqui. Nada de assumir
que uma tabela existe; quem chama pergunta antes com table_exists().
"""
import sqlite3
from . import config


class DatabaseUnavailable(Exception):
    """O events.db nao existe ainda, ou nao tem a tabela pedida."""


def connect():
    if not config.DB_PATH.exists():
        raise DatabaseUnavailable(f"banco nao encontrado em {config.DB_PATH}")
    try:
        return sqlite3.connect(f"file:{config.DB_PATH}?mode=ro", uri=True)
    except sqlite3.OperationalError as e:
        raise DatabaseUnavailable(f"nao consegui abrir {config.DB_PATH}: {e}") from e


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


def time_sql(table, column):
    """Expressao SQL que devolve o timestamp como texto ISO, seja qual for o
    formato guardado.

    Nem toda instalacao grava ISO: inteiro unix (segundos ou milissegundos) e
    igualmente comum. Com epoch, `date(coluna)` devolve NULL e o dashboard
    inteiro aparece zerado - sem erro nenhum, o que e pior que quebrar.
    """
    ident = _ident(table)
    col = _ident(column)
    try:
        rows = query(f"SELECT {col} AS v FROM {ident} "
                     f"WHERE {col} IS NOT NULL LIMIT 1")
    except DatabaseUnavailable:
        return col
    if not rows:
        return col
    value = rows[0]["v"]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        # ~1e12 ja e ano 33658 em segundos; nessa faixa so pode ser ms
        unit = f"{col} / 1000" if value > 1e12 else col
        return f"datetime({unit}, 'unixepoch')"
    return col


def select_list(table, wanted, required=()):
    """SELECT com so as colunas que existem.

    O events.db da VM pode nao ter `error` ou `cost_usd`; pedir uma coluna
    ausente e OperationalError, e ai a aba inteira some. Melhor trazer o que
    existe e deixar o resto None.
    """
    cols = columns(table)
    chosen = [c for c in wanted if c in cols]
    for name in required:
        if name not in cols:
            return None
    return chosen or None


def pick_column(table, candidates):
    """Primeira coluna de `candidates` que existe em `table`, ou None."""
    cols = columns(table)
    for name in candidates:
        if name in cols:
            return name
    return None
