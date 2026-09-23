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
- A cena Three.js ocupa toda a tela; mapa, telemetria e conversa são overlays.
  Clique/toque no piso para andar ou use WASD/setas. Arraste para girar e use a
  roda para zoom. **Seguir** acompanha o personagem; **Sala** enquadra o laboratório.
  Não há controles de movimento na tela. Placas físicas identificam as estações.
- A lista de estações/robôs escolhe um destino e o personagem caminha até ele,
  contornando equipamentos e robôs. **Conversar** e a tecla E só funcionam
  dentro da estação, perto do robô. Durante o diálogo, a câmera sobe e recua,
  deixando os personagens abaixo do chat translúcido; Escape encerra a conversa.
  Sem WebGL 2, o painel de telemetria e o dashboard continuam disponíveis.
- Guias explicam cada setor. Robôs individuais representam processos detectados,
  registros em `agent_runs`/`subagent_runs`, servidores MCP e jobs. O laboratório
  lê até 48 registros por tabela de agentes. Mostra até quatro robôs por setor:
  responsável e três bancadas auxiliares. Selecionar outro robô na lista reserva
  uma bancada para ele; a lista contém todos os robôs incluídos no snapshot.
  Os monitores mostram dados reais, nome e estado do trabalhador daquela bancada.
- Avatar e robôs têm hierarquias de ossos com poses procedurais: respiração,
  mudança de apoio, piscar, andar coordenado e gestos. Robôs operam seus terminais
  e se voltam para quem entra na estação; a pupila central é azul emissiva.
  Esses gestos são ambientação, não evidência de execução. O indicador e os dados
  continuam distinguindo atividade real, dados ausentes e leituras antigas.
  A cena limita a 30 fps, agrupa geometria estática, reaproveita materiais e
  atualiza sombras em cadência reduzida. Há pausa de animações no mapa e respeito
  à preferência de movimento reduzido do sistema.
- Dados ausentes aparecem como **sem telemetria**, nunca como uma execução
  fictícia. **Atividade recente** significa um evento nos últimos 180 segundos;
  **processo detectado** não confirma trabalho. Registros `running` sem um
  timestamp recente aparecem como **último estado sem confirmação**. Identidade
  e parentesco vêm de `id`/`run_id`/`agent_id` e `parent_id`/`parent_run_id`.
- Equipamentos da VM mostram CPU/RAM em barras luminosas e percentuais a cada
  snapshot (5 s). Falhas preservam a última leitura identificada; sem leitura
  anterior aparece um traço. Tubos dos providers reproduzem as chamadas da
  amostra recente, com retorno quando há tokens de saída registrados; são um
  replay visual, não uma captura de pacotes de rede.
- A oficina de skills exibe nomes do catálogo em uma lousa, livros articulados
  e mecanismos de escrita. Mudanças nos arquivos/atividades acionam os gestos.
  O mural na parede mostra o calendário real de atividades (365 dias, UTC),
  atualizado a cada 15 s. O catálogo de skills usa o cache existente de 30 s.
- Dentro de RAG, **Explorar rede RAG** aproxima a cúpula: clique nos pontos ou
  na lista para abrir repositórios/categorias/documentos. A busca usa o mesmo
  `/api/rag/search` do dashboard (LanceDB/fastembed), mostra trechos e distâncias
  reais e anima as conexões dos resultados. O layout 3D é ilustrativo: não
  representa coordenadas originais dos embeddings nem o caminho interno do
  índice. São até 180 nós e 12 resultados por busca; falhas preservam o último
  grafo. O catálogo da cúpula atualiza a cada minuto fora do explorador.
- Com `HERMES_WEB_CHAT_PASSWORD_HASH` e `HERMES_WEB_CHAT_SESSION_SECRET`
  configurados, a conversa privada enfileira perguntas para o **Hermes real**.
  A pergunta e o estado ficam em SQLite (`~/.hermes/web-chat.sqlite3`, WAL), e
  a interface consulta o resultado periodicamente sem manter uma conexão longa
  com o túnel. O worker tenta novamente até três vezes e recupera trabalhos
  interrompidos após o prazo de processamento. O histórico permanece ao fechar
  a página. Sem a configuração privada, a prévia local mantém as respostas
  determinísticas de telemetria usadas antes.
- O chat web é limitado a perguntas informativas. Rejeita pedidos diretos de
  ação antes da fila, usa apenas dados selecionados do snapshot e inicia uma
  sessão Hermes separada com `--toolsets context_engine --ignore-rules`. Antes
  de cada chamada, verifica no Hermes instalado que esse toolset resolve para
  **zero ferramentas**; se isso mudar, falha fechado. O texto da pergunta vai
  pela entrada padrão (`--query-file -`), sem shell. Assim o Hermes não recebe
  terminal, escrita de arquivos, MCP, navegador nem ferramentas de delegação.
  O bloqueio de execução é estrutural; o modelo ainda pode produzir uma resposta
  imprecisa, então estados e métricas continuam atribuídos à telemetria.
- O acesso ao chat exige senha própria, sessão assinada em cookie HttpOnly,
  Secure e SameSite Strict, token CSRF, origem coincidente e limite de tentativas
  de login. Isso protege o chat; as outras rotas do dashboard permanecem com a
  política de acesso anterior.
- `/api/lab/state` atualiza a cada 5 segundos; os catálogos têm cache de 30
  segundos por processo Flask. `/api/lab/chat` aceita JSON com `robot_id` e
  `question` (até 500 caracteres). Falhas isoladas de coleta não derrubam os
  demais setores. Polling e animação param quando a página fica oculta.

Para habilitar o chat privado na VM, defina no ambiente do serviço Flask
`HERMES_WEB_CHAT_PASSWORD_HASH` (hash gerado por
`werkzeug.security.generate_password_hash`) e
`HERMES_WEB_CHAT_SESSION_SECRET` (segredo aleatório longo). Mantenha ambos fora
do Git e preserve os valores entre reinícios. O processo Flask único da VM
executa o worker em segundo plano. O Hermes instalado deve estar em
`~/.hermes/hermes-agent`; o worker usa a configuração de provider desse Hermes.
Quando o provider falha, a pergunta continua no banco para nova tentativa.

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
npm run test:navigation
npm run test:browser
```

`LAB_TEST_URL` pode apontar os testes de navegador para outro endereço local.
Os testes cobrem dados ausentes, eventos Unix/ISO, subagentes e parentesco,
estados antigos, isolamento de coletores, validação da conversa, renderização
WebGL em tela cheia, colisão e caminhos, acesso aos sete setores, proximidade
para conversar, subagentes, texto não confiável, reconexão, mobile e fallback sem GPU.
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
