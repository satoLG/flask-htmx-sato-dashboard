#!/usr/bin/env python3
"""Valida os templates Jinja/HTML do dashboard.

Roda tres checagens em cada arquivo de templates/:
  1. parse Jinja  -> pega {% if %}/{% for %}/{{ }} mal fechados
  2. balanco de tags HTML -> pega <div> sem </div>, </p> sobrando, etc
  3. atributos htmx -> pega hx-* escritos errado

E confere se todo render_template() do app.py aponta pra um arquivo que existe.

Uso:
    python3 tools/check_html.py                 # valida templates/
    python3 tools/check_html.py caminho/x.html  # valida arquivos especificos

Sai com codigo 1 se achar qualquer erro, entao da pra usar em CI.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Tags que nao tem fechamento em HTML.
VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}
# Tags cujo fechamento e opcional no HTML5 - nao reclamamos delas.
OPTIONAL_CLOSE = {"li", "p", "tr", "td", "th", "thead", "tbody", "tfoot", "option", "dt", "dd"}
# Conteudo desses blocos nao e HTML: `a < b` em JS nao pode virar "tag".
RAW_TEXT = {"script", "style"}

HX_ATTRS = {
    "hx-get", "hx-post", "hx-put", "hx-patch", "hx-delete", "hx-target",
    "hx-swap", "hx-trigger", "hx-vals", "hx-headers", "hx-indicator",
    "hx-select", "hx-select-oob", "hx-swap-oob", "hx-push-url", "hx-confirm",
    "hx-include", "hx-params", "hx-encoding", "hx-ext", "hx-disable",
    "hx-boost", "hx-sync", "hx-preserve", "hx-history", "hx-on",
    "hx-replace-url", "hx-request", "hx-validate", "hx-disinherit",
}

TAG_RE = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>\"']|\"[^\"]*\"|'[^']*')*?)(/?)>", re.S)
ATTR_RE = re.compile(r"([a-zA-Z_:@][a-zA-Z0-9_:.-]*)")


def line_of(text, pos):
    return text.count("\n", 0, pos) + 1


def strip_jinja(text):
    """Troca blocos Jinja por espacos, preservando offsets e quebras de linha."""
    def blank(m):
        return "".join(ch if ch == "\n" else " " for ch in m.group(0))
    text = re.sub(r"\{#.*?#\}", blank, text, flags=re.S)
    text = re.sub(r"\{%.*?%\}", blank, text, flags=re.S)
    text = re.sub(r"\{\{.*?\}\}", blank, text, flags=re.S)
    return text


def strip_raw_text(text):
    """Esvazia o corpo de <script>/<style> pelo mesmo motivo."""
    def blank(m):
        body = "".join(ch if ch == "\n" else " " for ch in m.group(2))
        return m.group(1) + body + m.group(3)
    for tag in RAW_TEXT:
        text = re.sub(
            rf"(<{tag}\b[^>]*>)(.*?)(</{tag}\s*>)", blank, text,
            flags=re.S | re.I,
        )
    return text


def check_jinja(path, source, errors):
    try:
        from jinja2 import Environment, TemplateSyntaxError
    except ImportError:
        print("  aviso: jinja2 nao instalado, pulando checagem de Jinja")
        return
    try:
        Environment().parse(source, name=path.name, filename=str(path))
    except TemplateSyntaxError as e:
        errors.append(f"{path}:{e.lineno}: erro de sintaxe Jinja: {e.message}")


def check_tags(path, source, errors):
    text = strip_raw_text(strip_jinja(source))
    stack = []
    for m in TAG_RE.finditer(text):
        closing, name, attrs, self_closing = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        line = line_of(text, m.start())
        if closing:
            if name in VOID:
                errors.append(f"{path}:{line}: </{name}> nao existe, <{name}> e uma void tag")
                continue
            if name not in [open_name for open_name, _ in stack]:
                if name not in OPTIONAL_CLOSE:
                    errors.append(f"{path}:{line}: </{name}> fecha uma tag que nunca foi aberta")
                continue
            # Desempilha ate achar o par, reclamando do que ficou aberto no meio.
            while stack:
                open_name, open_line = stack.pop()
                if open_name == name:
                    break
                if open_name not in OPTIONAL_CLOSE:
                    errors.append(
                        f"{path}:{open_line}: <{open_name}> nunca foi fechada "
                        f"(o proximo fechamento na linha {line} e </{name}>)"
                    )
        else:
            check_attrs(path, line, attrs, errors)
            if name in VOID or self_closing:
                continue
            stack.append((name, line))
    for open_name, open_line in stack:
        if open_name not in OPTIONAL_CLOSE:
            errors.append(f"{path}:{open_line}: <{open_name}> nunca foi fechada")


def check_attrs(path, line, attrs, errors):
    for name in ATTR_RE.findall(attrs):
        low = name.lower()
        if not low.startswith("hx-"):
            continue
        if low in HX_ATTRS or low.startswith("hx-on:") or low.startswith("hx-on-"):
            continue
        errors.append(f"{path}:{line}: atributo htmx desconhecido: {name}")


def check_unclosed_brace(path, source, errors):
    """Pega {{ var } ou {% if %  - o Jinja as vezes engole isso como texto."""
    for i, raw in enumerate(source.splitlines(), 1):
        for opener, closer in (("{{", "}}"), ("{%", "%}")):
            if raw.count(opener) > raw.count(closer):
                errors.append(f"{path}:{i}: '{opener}' aberto sem '{closer}' na mesma linha")


def check_file(path):
    source = path.read_text(encoding="utf-8")
    errors = []
    check_jinja(path, source, errors)
    check_unclosed_brace(path, source, errors)
    check_tags(path, source, errors)
    return errors


RENDER_RE = re.compile(r"""render_template\(\s*["']([^"']+)["']""")


def check_referenced_templates():
    """Todo render_template("x.html") do app.py precisa existir em templates/."""
    app_py = ROOT / "app.py"
    if not app_py.exists():
        return []
    source = app_py.read_text(encoding="utf-8")
    missing = []
    for m in RENDER_RE.finditer(source):
        name = m.group(1)
        if not (ROOT / "templates" / name).exists():
            line = line_of(source, m.start())
            missing.append(f"app.py:{line}: render_template(\"{name}\") mas templates/{name} nao existe")
    return missing


def main(argv):
    if argv:
        targets = [Path(a) for a in argv]
    else:
        targets = sorted((ROOT / "templates").glob("*.html"))
    if not targets:
        print("nenhum template encontrado em templates/")
        return 1

    total = 0
    if not argv:
        missing = check_referenced_templates()
        if missing:
            total += len(missing)
            print("FALHOU    app.py (templates referenciados)")
            for e in missing:
                print(f"          {e}")
        else:
            print("OK        app.py (templates referenciados)")
    for path in targets:
        if not path.exists():
            print(f"FALTANDO  {path}")
            total += 1
            continue
        errors = check_file(path)
        if errors:
            total += len(errors)
            print(f"FALHOU    {path}")
            for e in errors:
                print(f"          {e}")
        else:
            print(f"OK        {path}")

    print()
    if total:
        print(f"{total} problema(s) encontrado(s)")
        return 1
    print("nenhum problema encontrado")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
