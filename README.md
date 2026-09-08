# Flask + HTMX Dashboard for Sato Agents

This is a public observability dashboard for Hermes agent with Sato agents UI.

## Features
- Public stats page
- Private dashboard (token protected)
- Model usage, cost, fallback tracking
- RAG data browsing
- System stats (VM, memory, disk)
- Cron jobs overview
- Tool availability

Built with Flask, HTMX, and SQLite.

## Validando os templates

```bash
python3 tools/check_html.py                    # valida tudo em templates/
python3 tools/check_html.py templates/x.html   # valida arquivos especificos
```

O script confere, por arquivo:

- sintaxe Jinja (`{% if %}` / `{% for %}` / `{{ }}` mal fechados), com linha do erro
- balanco de tags HTML (`<div>` sem `</div>`, fechamento sobrando), ignorando o
  conteudo de `<script>`/`<style>` e as tags de fechamento opcional do HTML5
- atributos `hx-*` escritos errado (ex: `hx-gett`)

E confere que todo `render_template("x.html")` do `app.py` aponta pra um arquivo
que existe. Sai com codigo 1 se achar problema, entao serve pra CI/pre-commit.

Depende de `jinja2` (ja vem com Flask). Sem ele o script roda mesmo assim,
apenas pulando a checagem de Jinja.
