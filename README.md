# FLAXY

Edição e geração de vídeos em massa com templates. FFmpeg + FastAPI + React.

Você monta um **template** (fundo fixo + área onde o vídeo entra), joga até
**100 vídeos** de uma vez na fila e o FLAXY devolve todos compostos — com a
opção de ajustar o recorte de cada vídeo individualmente.

## Dependências necessárias

| Dependência | Versão mínima | Link |
|---|---|---|
| Python | 3.11+ | https://python.org |
| Node.js | 18+ | https://nodejs.org |
| FFmpeg | 6+ | https://www.gyan.dev/ffmpeg/builds/ |

> FFmpeg deve estar no PATH do sistema. Após baixar, extraia e adicione a pasta `bin/` nas variáveis de ambiente do Windows.
> O `start.bat` consulta `/health` e avisa antes de você descobrir na hora de processar.

## Estrutura

| Onde roda | O quê |
|---|---|
| `frontend/` | SPA em React + Vite. Vai para a **Vercel**. |
| `backend/` | API FastAPI + FFmpeg. Vai para o **Render**, em Docker. |
| `db/` | Schema PostgreSQL do modelo multiusuário. |

Deploy e o caminho para contas de usuário: **[DEPLOY.md](DEPLOY.md)**.

## Instalação e execução

```bat
install.bat
```

```bat
start.bat
```

- Frontend: http://localhost:5173
- Backend: http://localhost:8000
- Docs da API: http://localhost:8000/docs

Para apontar o frontend a outro host, copie `frontend/.env.example` para
`frontend/.env.local` e ajuste `VITE_API_URL`. O WebSocket de progresso é
derivado desse valor — não há host escrito no código.

## Identidade visual

- **Paleta**: roxo `#7c5cfc` sobre cinzas (`#141417` → `#2c2c34`) e branco `#f4f4f7`
- **Tipografia**: Poppins (Google Fonts, com fallback de sistema)
- **Layout**: painel arredondado flutuando sobre fundo cinza, trilho de ícones à
  esquerda, barra de busca no topo

Os tokens ficam todos no `:root` de `frontend/src/App.css`. Mudar a marca inteira
é editar aquele bloco.

## O fluxo

1. **Início** — visão geral: itens por status, produção dos últimos 7 dias,
   lotes recentes, espaço em disco. Todos os números vêm da API.
2. **Templates** — envie o fundo (vídeo ou imagem), escolha a proporção
   (9:16, 1:1, 4:5, 16:9) e arraste a caixa que marca onde o vídeo bruto entra.
3. **Processar** — arraste até 100 vídeos, ajuste o recorte de cada um se
   precisar e dispare o lote. O progresso chega por WebSocket, vídeo a vídeo, e
   dá para cancelar a fila no meio.
4. **Resultados** — pré-visualize, baixe individualmente ou leve tudo num ZIP.

## Recorte individual

O template define **um** enquadramento para o lote inteiro. Isso resolve o caso
comum e quebra quando os vídeos vêm de fontes diferentes: um gravado deitado e
outro em pé, encaixados na mesma janela 9:16 com `cover`, saem com cortes
centralizados que decapitam metade das pessoas.

O botão **Recortar** de cada card abre um editor que mostra o quadro inteiro com
o descartado escurecido e uma moldura de 8 alças por cima.

- **Cada lado corta sozinho**: puxar a alça esquerda muda só `x` e `w`; a de
  baixo, só `h`. Dá para tirar uma faixa lateral sem mexer no resto.
- **Aproximação** por slider ou roda do mouse, escalando pela âncora central.
- **Proporção travada** mantém a proporção do template ao redimensionar;
  **Proporção do template** reencaixa a moldura.
- Quando o recorte foge da proporção da área, você escolhe entre *preencher
  (corta)* e *caber (bordas)* — em vez de o sistema decidir e desfazer em
  silêncio o recorte que você acabou de fazer.
- O recorte é gravado como fração `0..1` da fonte, então vale igual para um
  arquivo 720p ou 4K.
- Cards com recorte próprio ganham um contorno roxo e a etiqueta *recorte*.
- **Aplicar aos selecionados** replica o mesmo recorte no resto do lote.
- O enquadramento geral continua no painel da direita e é salvo no template.

No FFmpeg isso vira um `crop` com expressões relativas antes do `scale`:

```
[1:v]crop=iw*0.500000:ih*0.422535:iw*0.316667:ih*0.316901,scale=890:1162:...
```

## Estrutura de pastas

```
FLAXY/
├── backend/
│   ├── main.py              # Entrada FastAPI (lifespan, CORS, /health, /ws)
│   ├── database.py          # SQLite + modelo ORM de Template
│   ├── schemas.py           # Pydantic schemas + MAX_VIDEOS_PER_JOB
│   ├── store.py             # Jobs/itens em memória + diretório temporário
│   ├── ws_manager.py        # Broadcast de progresso via WebSocket
│   ├── routers/
│   │   ├── templates.py     # CRUD de templates + upload do fundo
│   │   └── jobs.py          # Upload, lotes, cancelamento, download
│   ├── services/
│   │   ├── composer.py      # Motor FFmpeg + Settings (template + overrides)
│   │   └── worker.py        # Worker assíncrono (1 render por vez)
│   ├── settings.py          # Toda a configuração por ambiente
│   ├── auth.py              # Encaixe para contas de usuário
│   ├── migrations/          # Alembic
│   ├── Dockerfile           # Imagem com FFmpeg, usada no Render
│   └── storage/templates/   # Arquivos de fundo (persistentes)
├── db/
│   └── schema.postgres.sql  # Schema multiusuário para PostgreSQL
├── render.yaml              # Blueprint do backend no Render
├── DEPLOY.md                # Passo a passo de Vercel + Render
├── frontend/
│   ├── vercel.json          # Rewrites da SPA e cabeçalhos
│   └── src/
│       ├── App.tsx          # Trilho de ícones, barra superior, rotas
│       ├── App.css          # Sistema de design (tokens, componentes)
│       ├── api.ts           # Cliente axios + tradução de erro da API
│       ├── config.ts        # Marca, limites, API_BASE e URLs
│       ├── useJobSocket.ts  # WebSocket de progresso
│       ├── ui/              # Icon.tsx, Toast.tsx
│       ├── components/
│       │   ├── CompositionEditor.tsx  # Enquadramento geral (drag/resize)
│       │   ├── CompositionThumb.tsx   # Prévia da composição na miniatura
│       │   └── CropEditor.tsx         # Recorte individual (lados livres)
│       └── pages/
│           ├── DashboardPage.tsx
│           ├── TemplatesPage.tsx
│           ├── ProcessPage.tsx
│           └── ResultsPage.tsx
├── install.bat
├── start.bat
└── test_compose.py
```

## Como funciona a composição

1. Template (vídeo ou imagem) é a camada base (layer 0), escalado para a resolução de saída
2. Se o vídeo tiver recorte individual, a fonte é cortada primeiro
3. Vídeo bruto é redimensionado para caber na área definida (layer 1)
4. FFmpeg sobrepõe as duas camadas com o filtro `overlay` nas coordenadas x,y
5. O processo se repete para cada vídeo da fila, sem intervenção manual

Modos de encaixe:
- **cover**: escala para preencher a área, cortando o excesso (sem bordas pretas)
- **contain**: escala para caber inteiro, com bordas pretas (letterbox)

GPU Nvidia (NVENC) é usada automaticamente quando disponível. Só um render roda
por vez — dois FFmpeg simultâneos disputam o mesmo encoder e saem mais lentos que
em sequência. Para mudar, use a variável `FLAXY_MAX_CONCURRENT`.

## O que é persistente e o que não é

| Dado | Onde vive | Sobrevive a reiniciar? |
|---|---|---|
| Templates | SQLite (`backend/flaxy.db`) | sim |
| Arquivos de fundo | `backend/storage/templates/` | sim |
| Lotes e progresso | memória do processo | não |
| Uploads e vídeos prontos | diretório temporário do servidor | não |
| Lista de vídeos da aba | `sessionStorage` (só metadados) | sobrevive ao F5, não ao fechar a aba |

Baixe o que quiser guardar antes de encerrar o backend.

> Um `autoedit.db` de versões anteriores é renomeado automaticamente para
> `flaxy.db` na primeira inicialização, preservando os templates.

## Configuração

Tudo que muda entre a máquina local e o deploy passa por `backend/settings.py`;
nenhum outro módulo lê variável de ambiente. Sem configurar nada, o backend roda
em SQLite com os arquivos em `backend/storage/` e o CORS liberado para o Vite.

| Variável | Padrão | Para quê |
|---|---|---|
| `FLAXY_ENV` | `local` | `production` fecha `/docs` e liga os avisos de configuração |
| `DATABASE_URL` | SQLite local | PostgreSQL no deploy (`postgres://` é convertido) |
| `CORS_ORIGINS` | portas do Vite | Domínios que podem chamar a API |
| `FLAXY_STORAGE_DIR` | `backend/storage` | Onde ficam os fundos dos templates |
| `FLAXY_WORK_DIR` | temporário do SO | Uploads e saídas, descartáveis |
| `FLAXY_API_KEY` | vazio | Segredo interino, até existir login |
| `FLAXY_MAX_CONCURRENT` | `1` | Renders simultâneos |
| `FLAXY_MAX_UPLOAD_MB` | `0` (sem limite) | Teto por arquivo enviado |

Exemplos comentados em `backend/.env.example` e `frontend/.env.example`.

## Migrações

O schema é versionado com Alembic:

```bash
cd backend && alembic upgrade head
```

Num banco que já existe e nunca passou por migração, carimbe a baseline antes:
`alembic stamp 0001_baseline`.

## Banco de usuários

`db/schema.postgres.sql` traz o schema multiusuário completo para PostgreSQL 14+:
usuários com hash de senha, sessões (refresh token), tokens de verificação e
reset, API keys, planos com quota, auditoria, e as tabelas de domínio já com
dono (`templates`, `media_assets`, `jobs`, `job_items`).

```bash
createdb flaxy
psql -d flaxy -f db/schema.postgres.sql
```

O arquivo é idempotente e não apaga dados. Ele descreve o destino da aplicação —
o backend atual ainda roda em SQLite e sem autenticação.
