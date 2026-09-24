"""Public, allow-listed gateway state; never return adapter configuration/secrets."""
import json
from pathlib import Path
from . import config


def snapshot():
    from . import web_chat
    entries = []
    try:
        state = json.loads((config.HERMES_HOME / "gateway_state.json").read_text())
        pid = int(state.get("pid") or 0)
        alive = pid > 0 and Path(f"/proc/{pid}").exists()
        platforms = state.get("platforms", {})
        for name, adapter in platforms.items():
            if not isinstance(adapter, dict) or adapter.get("state") != "connected" or not alive:
                continue
            entries.append({"id": str(name)[:80], "name": str(name).replace("_", " ").title()[:80],
                            "status": "process", "detail": "Adaptador conectado; processo do gateway presente.",
                            "source": "gateway_state.json · /proc"})
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    if web_chat.ENABLED:
        entries.append({"id": "web", "name": "Web / túnel", "status": "configured",
                        "detail": "Endpoint privado de prompts do dashboard habilitado. A disponibilidade externa do túnel não é monitorada aqui.",
                        "source": "dashboard · configuração do chat privado"})
    return entries
