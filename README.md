# Flask + HTMX Dashboard for Sato Agents

Dashboard de observabilidade do agente Hermes: uma pagina publica com os numeros
do mes e um dashboard interno em abas.

## Rodando

```bash
pip install flask pyyaml       # lancedb e fastembed so para a aba de RAG
python3 app.py                 # http://127.0.0.1:8080
```

Abra `/dashboard`.

## Laboratório 3D

Abra `/lab` pelo link **Laboratório 3D** no dashboard ou na página inicial.
É uma segunda visualização do mesmo host e das mesmas fontes do Hermes: não
precisa de outro serviço, Node.js em produção ou conexão com CDN. Three.js
0.180.0 e sua licença MIT estão em `static/vendor/`; o cenário e os personagens
são modelos procedurais originais, sem arquivos extraídos dos jogos de referência.

- Setores: núcleo Hermes (agentes, subagentes e tools), providers, MCP, RAG,
  memória/skills, cron e infraestrutura. As linhas do piso representam a
  arquitetura conceitual, não tráfego de rede capturado.
- WASD/setas ou clique no piso para andar; E perto de um robô para conversar.
  Arraste para girar, use a roda/+/- para zoom. No celular há controles de toque.
  A lista de setores e de robôs também funciona sem WebGL 2.
- Guias explicam cada setor. Robôs individuais representam processos detectados,
  registros em `agent_runs`/`subagent_runs`, servidores MCP e jobs. O laboratório
  lê até 48 registros por tabela de agentes. Mostra até oito robôs por setor no
  3D; selecionar um robô na lista o traz para a cena. A lista contém todos os
  robôs incluídos no snapshot.
- Dados ausentes aparecem como **sem telemetria**, nunca como uma execução
  fictícia. **Atividade recente** significa um evento nos últimos 180 segundos;
  **processo detectado** não confirma trabalho. Registros `running` sem um
  timestamp recente aparecem como **último estado sem confirmação**. Identidade
  e parentesco vêm de `id`/`run_id`/`agent_id` e `parent_id`/`parent_run_id`.
- A conversa responde em português sobre função, tarefa registrada, dados e
  falhas, com fonte e horário. É um intérprete local de perguntas de telemetria,
  **não uma sessão com o LLM/Hermes**. Não envia prompts aos providers, executa
  comandos, altera jobs ou acessa chaves. Perguntas fora desse escopo recebem
  uma explicação da limitação. Conversas ficam apenas na memória da página.
- `/api/lab/state` atualiza a cada 5 segundos; os catálogos têm cache de 30
  segundos por processo Flask. `/api/lab/chat` aceita JSON com `robot_id` e
  `question` (até 500 caracteres). Falhas isoladas de coleta não derrubam os
  demais setores. Polling e animação param quando a página fica oculta.

### Atualizar a VM

Após integrar o PR, atualize o checkout da aplicação e reinicie o serviço Flask
ou Gunicorn com o procedimento já usado nessa VM. A nova rota será
`https://<endereço-atual>/lab`. Não é necessário instalar dependências Python
adicionais. As variáveis `HERMES_*` continuam sendo as mesmas documentadas abaixo.
O processo precisa ler os arquivos reais do Hermes para mostrar atividade real;
rodar em outra máquina mostra os recursos dessa outra máquina.

### Validar o laboratório

```bash
python -m pytest tests/ -q
python tools/check_html.py
# Em outro terminal, mantenha python app.py rodando.
npm ci                       # ferramentas de desenvolvimento, não de produção
npx playwright install chromium
npm run test:browser
```

`LAB_TEST_URL` pode apontar os testes de navegador para outro endereço local.
Os testes cobrem dados ausentes, eventos Unix/ISO, subagentes e parentesco,
estados antigos, isolamento de coletores, validação da conversa, renderização
WebGL, movimentação, texto não confiável, reconexão, mobile e fallback sem GPU.
Em Windows sem privilégio de symlink, o teste preexistente
`test_symlink_quebrado_na_memoria` precisa ser executado em Linux ou excluído
localmente com `-k 'not symlink_quebrado'`.

Para reconstruir a dependência 3D: `npm ci && npm run build:three`. O arquivo
gerado é versionado; preserve `static/vendor/THREE-LICENSE.txt` nas atualizações.

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
