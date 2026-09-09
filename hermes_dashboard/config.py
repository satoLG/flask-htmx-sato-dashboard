"""Caminhos e leitura do config.yaml do Hermes."""
from pathlib import Path

HOME = Path.home()
DB_PATH = HOME / "hermes-observability" / "events.db"
RAG_PATH = HOME / "rag-db"
HERMES_HOME = HOME / ".hermes"
CONFIG_PATH = HERMES_HOME / "config.yaml"
CRON_DIR = HERMES_HOME / "cron"

# Onde procuramos log em texto do agente, na ordem. O primeiro que existir vence.
LOG_CANDIDATES = [
    HERMES_HOME / "logs" / "hermes.log",
    HERMES_HOME / "hermes.log",
    HOME / "hermes-observability" / "hermes.log",
]

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
    """Le o config.yaml. Devolve ({}, erro) se nao der - nunca levanta."""
    try:
        import yaml
    except ImportError:
        return {}, "pyyaml nao instalado"
    if not CONFIG_PATH.exists():
        return {}, f"config nao encontrado em {CONFIG_PATH}"
    try:
        with open(CONFIG_PATH) as f:
            return (yaml.safe_load(f) or {}), None
    except Exception as e:
        return {}, str(e)


def find_log_file():
    for path in LOG_CANDIDATES:
        if path.exists():
            return path
    logs_dir = HERMES_HOME / "logs"
    if logs_dir.is_dir():
        logs = sorted(logs_dir.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
        if logs:
            return logs[0]
    return None
