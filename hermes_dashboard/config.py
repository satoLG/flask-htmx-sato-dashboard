"""Caminhos e leitura do config.yaml do Hermes.

Os caminhos saem de variaveis de ambiente quando definidas, pra quem tem o
Hermes fora do lugar padrao nao precisar editar codigo. Os outros modulos leem
via `config.DB_PATH` (nao `from .config import DB_PATH`), pra dar pra apontar
tudo pra outro lugar em teste.
"""
import os
from pathlib import Path


def _path(env, default):
    value = os.environ.get(env)
    return Path(value).expanduser() if value else default


HOME = Path.home()
HERMES_HOME = _path("HERMES_HOME", HOME / ".hermes")
DB_PATH = _path("HERMES_DB_PATH", HOME / "hermes-observability" / "events.db")
RAG_PATH = _path("HERMES_RAG_PATH", HOME / "rag-db")
CONFIG_PATH = _path("HERMES_CONFIG_PATH", HERMES_HOME / "config.yaml")
CRON_DIR = _path("HERMES_CRON_DIR", HERMES_HOME / "cron")
LOG_PATH = _path("HERMES_LOG_PATH", None) if os.environ.get("HERMES_LOG_PATH") else None

# $/Mtok (entrada, saida). Usado so para exibir custo de fallback.
PRICING = {
    "deepseek-v4-flash": (0.14, 0.42),
    "minimax-m3": (0.30, 0.50),
    "gpt-5.6-luna": (0.30, 0.50),
    "muse-spark-1.2-contributor": (0.10, 0.20),
    "minimax/minimax-m3:free": (0, 0),
    "deepseek/deepseek-v4-flash:free": (0, 0),
    "nvidia/nemotron-3-super-120b-a12b:free": (0, 0),
}


def load_config():
    """Le o config.yaml. Devolve (dict, erro) - nunca levanta, e o dict e sempre
    um dict: um YAML valido pode ser lista, numero ou string, e quem chama faz
    .get() em cima."""
    try:
        import yaml
    except ImportError:
        return {}, "pyyaml nao instalado (pip install pyyaml)"
    if not CONFIG_PATH.exists():
        return {}, f"config nao encontrado em {CONFIG_PATH}"
    try:
        with open(CONFIG_PATH) as f:
            data = yaml.safe_load(f)
    except Exception as e:
        return {}, f"{CONFIG_PATH}: {e}"
    if data is None:
        return {}, None
    if not isinstance(data, dict):
        return {}, f"{CONFIG_PATH} nao contem um mapa no topo (achei {type(data).__name__})"
    return data, None


def as_dict(value):
    """`value` se for mapa, senao {}. YAML aceita string/lista/numero em qualquer
    chave, e um .get() em cima disso e AttributeError na cara do usuario."""
    return value if isinstance(value, dict) else {}


def as_list(value):
    """`value` se for lista, [item] se for mapa, senao []."""
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def find_log_file():
    """Primeiro log em texto que existir, ou None."""
    if LOG_PATH:
        return LOG_PATH if LOG_PATH.exists() else None
    candidates = [
        HERMES_HOME / "logs" / "hermes.log",
        HERMES_HOME / "hermes.log",
        DB_PATH.parent / "hermes.log",
    ]
    for path in candidates:
        try:
            if path.exists():
                return path
        except OSError:
            continue
    logs_dir = HERMES_HOME / "logs"
    try:
        if logs_dir.is_dir():
            logs = sorted(logs_dir.glob("*.log"),
                          key=lambda p: p.stat().st_mtime, reverse=True)
            if logs:
                return logs[0]
    except OSError:
        pass
    return None
