"""Catalogo de memoria, skills e contextos - com leitura do conteudo.

O endpoint de conteudo recebe caminho vindo do browser, entao todo caminho passa
por resolve() e so e servido se cair dentro de uma das raizes permitidas: sem
isso, um ../../etc/passwd viraria download.
"""
import re
from pathlib import Path

from .config import HERMES_HOME, CONFIG_PATH

MAX_BYTES = 400_000
# Chaves cujo valor nunca vai pro browser. O config.yaml guarda credencial de
# provider ao lado de coisa inofensiva como o nome do modelo, entao o arquivo e
# servido redigido em vez de escondido.
SECRET_RE = re.compile(
    r"^(\s*[-\s]*['\"]?[\w.-]*"
    r"(key|token|secret|password|passwd|credential|api[_-]?key|auth)"
    r"[\w.-]*['\"]?\s*:\s*)(.+)$",
    re.I,
)
TEXT_SUFFIXES = {".md", ".txt", ".yaml", ".yml", ".json", ".toml", ".cfg", ".ini", ""}


def _roots():
    """Diretorios de onde e permitido ler, ja resolvidos."""
    roots = [HERMES_HOME / "memories", HERMES_HOME / "skills",
             HERMES_HOME / "contexts", HERMES_HOME]
    roots.append(Path.cwd())
    out = []
    for r in roots:
        try:
            out.append(r.resolve())
        except OSError:
            continue
    return out


def _inside_roots(path):
    try:
        resolved = path.resolve()
    except OSError:
        return None
    for root in _roots():
        if resolved == root or root in resolved.parents:
            return resolved
    return None


def _entry(path, category, extra=None):
    try:
        stat = path.stat()
    except OSError:
        return None
    item = {
        "name": path.name,
        "path": str(path),
        "category": category,
        "size": stat.st_size,
        "modified": stat.st_mtime,
        "suffix": path.suffix,
    }
    if extra:
        item.update(extra)
    return item


def catalog():
    """Lista documentos de memoria, skills e contextos (sem carregar conteudo)."""
    docs = []
    skills = []

    for folder, category in [(HERMES_HOME / "memories", "memoria"),
                             (HERMES_HOME / "contexts", "contexto")]:
        if folder.is_dir():
            for f in sorted(folder.rglob("*")):
                if f.is_file() and f.suffix in TEXT_SUFFIXES:
                    entry = _entry(f, category)
                    if entry:
                        docs.append(entry)

    skills_dir = HERMES_HOME / "skills"
    if skills_dir.is_dir():
        for skill_md in sorted(skills_dir.rglob("SKILL.md")):
            rel = skill_md.parent.relative_to(skills_dir).parts
            entry = _entry(skill_md, "skill", {
                "name": skill_md.parent.name,
                "group": rel[0] if len(rel) > 1 else "",
            })
            if entry:
                skills.append(entry)

    for fname in ["AGENTS.md", ".hermes.md", "CLAUDE.md", "README.md"]:
        f = Path.cwd() / fname
        if f.is_file():
            entry = _entry(f, "projeto")
            if entry:
                docs.append(entry)

    if CONFIG_PATH.is_file():
        entry = _entry(CONFIG_PATH, "config")
        if entry:
            docs.append(entry)

    total = sum(d["size"] for d in docs) + sum(s["size"] for s in skills)
    by_category = {}
    for d in docs + skills:
        by_category[d["category"]] = by_category.get(d["category"], 0) + 1
    return {
        "documents": docs,
        "skills": skills,
        "total_bytes": total,
        "by_category": by_category,
        "count": len(docs) + len(skills),
        "hermes_home": str(HERMES_HOME),
        "exists": HERMES_HOME.exists(),
    }


def read_document(raw_path):
    """Conteudo de um documento do catalogo. Levanta ValueError se sair da raiz."""
    path = Path(raw_path)
    resolved = _inside_roots(path)
    if resolved is None:
        raise ValueError("caminho fora dos diretorios permitidos")
    if not resolved.is_file():
        raise ValueError("arquivo nao encontrado")
    if resolved.suffix not in TEXT_SUFFIXES:
        raise ValueError(f"tipo nao suportado: {resolved.suffix}")
    data = resolved.read_bytes()[:MAX_BYTES]
    text = data.decode("utf-8", errors="replace")
    redacted = resolved == CONFIG_PATH.resolve()
    if redacted:
        text = redact_secrets(text)
    stat = resolved.stat()
    return {
        "path": str(resolved),
        "name": resolved.name,
        "size": stat.st_size,
        "modified": stat.st_mtime,
        "truncated": stat.st_size > MAX_BYTES,
        "redacted": redacted,
        "content": text,
        "lines": text.count("\n") + 1,
    }


def redact_secrets(text):
    """Troca o valor de chaves sensiveis por um marcador, linha a linha."""
    out = []
    for line in text.splitlines():
        match = SECRET_RE.match(line)
        out.append(f"{match.group(1)}[REDIGIDO]" if match else line)
    return "\n".join(out)
