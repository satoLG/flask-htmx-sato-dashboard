#!/usr/bin/env python3
"""Diagnostico do dashboard: roda na VM e diz exatamente o que esta faltando.

    python3 tools/selfcheck.py

Imprime ambiente, caminhos, schema do banco, formato do config, estado do RAG e
o resultado de TODA rota chamada em processo - com o traceback de quem falhar.
Sai com codigo 1 se alguma rota der 5xx.
"""
import json
import os
import platform
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

ROUTES = [
    "/", "/dashboard", "/api/stats",
    "/api/activity/heatmap?days=365", "/api/activity/day/2026-01-01",
    "/api/live", "/fragments/live",
    "/api/vmstats", "/api/tools", "/api/mcps", "/api/memory",
    "/api/rag/graph", "/api/rag/list", "/api/rag/search?q=teste",
    "/api/cronjobs", "/api/models", "/api/status", "/api/recent",
]


def secao(titulo):
    print(f"\n{'=' * 62}\n{titulo}\n{'=' * 62}")


def ambiente():
    secao("AMBIENTE")
    print(f"python      {platform.python_version()} ({sys.executable})")
    print(f"sistema     {platform.platform()}")
    print(f"cwd         {os.getcwd()}")
    print(f"app         {ROOT}")
    for mod in ["flask", "yaml", "lancedb", "pandas", "fastembed"]:
        try:
            m = __import__(mod)
            print(f"  {mod:12s} {getattr(m, '__version__', 'instalado')}")
        except Exception as e:
            print(f"  {mod:12s} AUSENTE ({type(e).__name__})")


def caminhos():
    from hermes_dashboard import config
    secao("CAMINHOS")
    itens = [("events.db", config.DB_PATH), ("config.yaml", config.CONFIG_PATH),
             ("~/.hermes", config.HERMES_HOME), ("rag-db", config.RAG_PATH),
             ("cron", config.CRON_DIR)]
    for nome, caminho in itens:
        existe = "OK  " if caminho.exists() else "NAO "
        legivel = ""
        if caminho.exists():
            legivel = " (sem permissao de leitura)" if not os.access(caminho, os.R_OK) else ""
        print(f"  [{existe}] {nome:12s} {caminho}{legivel}")
    log = config.find_log_file()
    print(f"  [{'OK  ' if log else 'NAO '}] log          {log or '(nenhum encontrado)'}")
    print("\n  Para apontar pra outro lugar, defina: HERMES_DB_PATH, HERMES_HOME,")
    print("  HERMES_RAG_PATH, HERMES_CONFIG_PATH, HERMES_CRON_DIR, HERMES_LOG_PATH")


def banco():
    from hermes_dashboard import db, activity
    secao("EVENTS.DB")
    tabelas = db.tables()
    if not tabelas:
        print("  nenhuma tabela (banco ausente ou vazio)")
        return
    for t in tabelas:
        cols = sorted(db.columns(t))
        try:
            n = db.query(f"SELECT COUNT(*) AS n FROM {db._ident(t)}")[0]["n"]
        except Exception as e:
            n = f"? ({e})"
        print(f"  {t}: {n} linhas")
        print(f"    colunas: {', '.join(cols)}")
        ts = db.pick_column(t, activity.TS_CANDIDATES)
        if ts:
            print(f"    tempo:   {ts} -> {db.time_sql(t, ts)}")
    print(f"\n  series reconhecidas: {[k[0] for k in activity.available_kinds()] or 'nenhuma'}")


def configuracao():
    from hermes_dashboard import config, stats, mcp
    secao("CONFIG.YAML")
    data, erro = config.load_config()
    print(f"  leitura: {erro or 'ok'}")
    if data:
        print(f"  chaves no topo: {', '.join(sorted(data))}")
    print(f"  modelo: {stats.models_config()}")
    servidores = mcp.servers()
    print(f"  mcp: {len(servidores['servers'])} servidor(es); "
          f"config_error={servidores['config_error']}")


def rag():
    from hermes_dashboard import rag as rag_mod
    secao("RAG")
    g = rag_mod.graph()
    if g.get("error"):
        print(f"  indisponivel: {g['error']}")
    else:
        print(f"  ok: {len(g['nodes'])} nos no primeiro nivel")


def rotas():
    secao("ROTAS")
    import app as app_module
    app_module.app.config.update(TESTING=False)
    client = app_module.app.test_client()
    falhas = []
    for rota in ROUTES:
        try:
            res = client.get(rota)
            codigo = res.status_code
            extra = ""
            if res.mimetype == "application/json":
                try:
                    payload = res.get_json()
                    if isinstance(payload, dict) and payload.get("error"):
                        extra = f"  <- {str(payload['error'])[:110]}"
                except Exception:
                    pass
            marca = "OK " if codigo < 400 else ("ATENCAO" if codigo < 500 else "FALHOU")
            print(f"  [{marca:7s}] {codigo}  {rota}{extra}")
            if codigo >= 500:
                falhas.append((rota, res.get_data(as_text=True)[:1500]))
        except Exception:
            print(f"  [FALHOU ] EXC  {rota}")
            falhas.append((rota, traceback.format_exc()))
    if falhas:
        secao("DETALHE DAS FALHAS")
        for rota, corpo in falhas:
            print(f"\n--- {rota} ---\n{corpo}")
    return falhas


def main():
    print("Diagnostico do dashboard Hermes")
    ambiente()
    caminhos()
    try:
        banco()
        configuracao()
        rag()
    except Exception:
        secao("ERRO NA COLETA")
        traceback.print_exc()
    falhas = rotas()
    secao("RESULTADO")
    if falhas:
        print(f"  {len(falhas)} rota(s) com erro 5xx - copie a secao acima.")
        return 1
    print("  nenhuma rota com erro. Se a tela ainda parecer vazia, veja em")
    print("  CAMINHOS/EVENTS.DB se o dashboard esta olhando pro lugar certo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
