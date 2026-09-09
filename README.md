# Flask + HTMX Dashboard for Sato Agents

Dashboard de observabilidade do agente Hermes: uma pagina publica com os numeros
do mes e um dashboard interno em abas.

## Rodando

```bash
pip install flask pyyaml       # lancedb e fastembed so para a aba de RAG
python3 app.py                 # http://127.0.0.1:8080
```

Abra `/dashboard`.

> **Sem autenticacao.** O dashboard e as rotas `/api/*` estao abertos a quem
> alcancar a porta, e expoem processos, disco, memoria e o config (redigido) da
> VM. Rode atras de tunel SSH, firewall ou basic auth do nginx enquanto a auth
> de verdade nao existe.

### Se algo nao aparecer ou der erro

```bash
python3 tools/selfcheck.py
```

Imprime versoes, caminhos, o schema do `events.db`, o formato do `config.yaml`,
o estado do RAG e o codigo de resposta de toda rota, com traceback de quem
falhar. Sai com 1 se alguma rota der 5xx.

### Caminhos

O dashboard procura tudo em `~`. Se o seu Hermes estiver noutro lugar:

| Variavel | Padrao |
|----------|--------|
| `HERMES_DB_PATH` | `~/hermes-observability/events.db` |
| `HERMES_HOME` | `~/.hermes` |
| `HERMES_RAG_PATH` | `~/rag-db` |
| `HERMES_CONFIG_PATH` | `~/.hermes/config.yaml` |
| `HERMES_CRON_DIR` | `~/.hermes/cron` |
| `HERMES_LOG_PATH` | autodetectado em `~/.hermes/logs/` |

## Abas

| Aba | O que mostra | De onde vem |
|-----|--------------|-------------|
| Atividade | Painel do que roda agora + calendario tipo GitHub; clicar num dia abre os eventos daquele dia | `events.db`, `ps`, `~/.hermes/logs/` |
| VM | CPU (total e por core), memoria, swap, discos e o que ocupa cada espaco | `/proc`, `df`, `du` |
| Tools | Catalogo de tools e estatisticas de tool calling | `events.db` (`tool_calls`) |
| MCPs | Servidores MCP, acoes e uso | `config.yaml` + `tool_calls` com nome `mcp__servidor__acao` |
| Memoria | Memorias, skills e contextos, com leitura do conteudo | `~/.hermes/{memories,skills,contexts}` |
| RAG | Mapa mental navegavel, lista e busca semantica | lancedb em `~/rag-db` |
| Cron | Jobs e historico de execucao | `~/.hermes/cron/`, `crontab -l`, `systemctl list-timers` |

O painel "processando agora" usa HTMX (`hx-trigger="every 3s"`), com filtro que
segura o polling enquanto a aba nao esta visivel. O resto das abas busca JSON dos
`/api/*` e monta o DOM no cliente.

## Estrutura

```
app.py                     rotas Flask (e so isso)
hermes_dashboard/
  config.py                caminhos, config.yaml, precos
  db.py                    acesso read-only ao events.db + descoberta de schema
  stats.py                 numeros do mes (pagina publica)
  activity.py              heatmap, detalhe do dia, snapshot ao vivo
  vm.py                    CPU/memoria/disco
  tools.py                 catalogo e estatisticas de tools
  mcp.py                   servidores MCP
  memory.py                catalogo de documentos + leitura com guarda de path
  rag.py                   lancedb, montagem do grafo e busca
  cron.py                  jobs e execucoes
static/
  css/app.css              design system (mobile-first, paleta validada)
  js/                      um modulo ES por aba + core/charts compartilhados
  vendor/                  htmx e cytoscape servidos localmente, sem CDN
templates/
  base.html                shell; dashboard.html; public.html; login.html
  fragments/live.html      fragmento trocado pelo HTMX
```

### Notas de implementacao

- **Schema flexivel**: `activity.py` descobre em runtime quais tabelas de evento
  existem (`prompts`, `model_usage`, `tool_calls`, `agent_runs`, `subagent_runs`).
  Se o seu `events.db` tiver uma tabela a mais, ela vira uma serie no heatmap
  sozinha; se tiver a menos, nada quebra. Colunas ausentes (`cost_usd`, `error`,
  `success`) sao simplesmente omitidas da consulta em vez de derrubar a aba.
- **Timestamp em qualquer formato**: ISO, epoch em segundos ou em milissegundos.
  O formato e detectado por amostragem e normalizado em SQL - com epoch e
  `date(coluna)`, o dashboard inteiro aparecia zerado sem erro nenhum.
- **Sem banco nao quebra**: `query()` levanta `DatabaseUnavailable` e a tela
  mostra "sem dados" em vez de 500. Um `@app.errorhandler(Exception)` global
  garante que nem uma excecao inesperada vira tela branca: a rota `/api/*`
  devolve o erro em JSON e a pagina mostra a mensagem com o traceback.
- **Segredos**: a leitura de documentos so serve caminhos dentro de
  `~/.hermes` e do diretorio da app, e o `config.yaml` sai redigido (valores de
  chaves com `key`/`token`/`secret`/`password` viram `[REDIGIDO]`).
- **Sem CDN**: htmx e cytoscape estao em `static/vendor/`, entao a VM nao
  precisa de saida pra internet pro dashboard funcionar.

## Validando os templates

```bash
python3 tools/check_html.py                    # valida templates/ (inclusive fragments/)
python3 tools/check_html.py templates/x.html   # valida arquivos especificos
```

O script confere, por arquivo:

- sintaxe Jinja (`{% if %}` / `{% for %}` / `{{ }}` mal fechados), com linha do erro
- balanco de tags HTML (`<div>` sem `</div>`, fechamento sobrando), ignorando o
  conteudo de `<script>`/`<style>` e as tags de fechamento opcional do HTML5
- atributos `hx-*` escritos errado (ex: `hx-gett`)

E confere que todo `render_template("x.html")` do `app.py` aponta pra um arquivo
que existe. Sai com codigo 1 se achar problema, entao serve pra CI/pre-commit.

## Testes

```bash
pip install pytest
python3 -m pytest tests/ -q
```

`tests/test_routes.py` monta VMs falsas (schema minimo, colunas com outro nome,
timestamp em epoch, valores nulos, nove formatos de `config.yaml`, seis de
`jobs.json`, diretorio sem permissao, symlink quebrado, RAG levantando seis
excecoes diferentes) e exige que **nenhuma rota responda 5xx** em nenhum deles.
`tests/test_rag_real.py` roda contra um lancedb de verdade, inclusive com tabela
sem colunas opcionais, sem `content`, vazia e com outro nome.
