# Deploy — Vercel (frontend) + Render (backend)

O FLAXY é dividido em dois serviços porque eles têm exigências opostas: o
frontend é um monte de arquivos estáticos que a Vercel entrega de graça e rápido;
o backend precisa de FFmpeg, CPU e disco, coisas que nenhuma CDN oferece.

```
Navegador ──► Vercel (estático)  ──HTTP/WS──►  Render (Docker + FFmpeg)
                                                    ├── PostgreSQL (templates)
                                                    └── Disco /data (fundos)
```

---

## Antes de começar: o que precisa ser decidido

Três coisas do desenho atual não sobrevivem a um deploy ingênuo. Vale ler antes
de gastar tempo.

### 1. O plano gratuito do Render não serve

- **Sem disco persistente.** Os arquivos de fundo dos templates ficam em disco.
  No plano free eles somem a cada deploy e a cada hibernação.
- **Hiberna com 15 min de inatividade.** Como os lotes vivem na memória do
  processo, hibernar no meio de um lote perde a fila inteira.

O `render.yaml` já vem com `plan: starter` e um disco de 5 GB por isso.

### 2. Não existe login — e a API vai ficar pública

Qualquer pessoa com a URL pode enviar vídeos, gastar sua CPU e apagar seus
arquivos. Duas contenções, ambas interinas:

- **`CORS_ORIGINS`** limitado ao domínio do frontend. Impede outro *site* de
  chamar a API pelo navegador. Não impede `curl`.
- **`FLAXY_API_KEY`** — um segredo compartilhado exigido em toda requisição.
  Impede uso casual por quem descobriu a URL.

A chave vai no bundle do frontend, então é legível por qualquer visitante. Ela
não identifica ninguém e não separa dados: é um freio, não uma fechadura. A
solução real é o login (ver a última seção).

### 3. Um lote não sobrevive a um restart

Lotes e progresso vivem na memória do processo. Um deploy no meio de um lote
perde a fila. Por isso `numInstances: 1` — com duas instâncias, cada uma teria a
própria fila, invisível para a outra, e o WebSocket entregaria progresso pela
metade.

Mover os lotes para o banco é o próximo passo estrutural; `db/schema.postgres.sql`
já traz as tabelas `jobs` e `job_items`.

---

## Backend no Render

### 1. Criar pelo Blueprint

No painel: **New → Blueprint**, apontando para este repositório. O
[`render.yaml`](render.yaml) declara o serviço web em Docker, o PostgreSQL e o
disco de 5 GB montado em `/data`.

O Dockerfile existe porque o runtime Python nativo do Render **não tem FFmpeg**.
Sem ele o serviço sobe, aceita uploads e falha em todo render — quebra silenciosa,
que só aparece no uso.

### 2. Preencher as variáveis marcadas `sync: false`

O Blueprint deixa duas em branco de propósito, porque dependem do domínio que a
Vercel só vai gerar depois:

| Variável | Valor |
|---|---|
| `CORS_ORIGINS` | `https://seu-app.vercel.app` |
| `CORS_ORIGIN_REGEX` | `^https://seu-app-.*\.vercel\.app$` (previews de branch) |

`FLAXY_API_KEY` é gerada automaticamente pelo Render. Copie o valor: ele também
vai no frontend.

### 3. Aplicar as migrações

Na primeira vez, pelo Shell do serviço:

```bash
alembic upgrade head
```

Se estiver migrando um banco que já existe e foi criado sem Alembic:

```bash
alembic stamp 0001_baseline
```

### 4. Conferir o startup

O log deve mostrar a linha de resumo e **nenhum** aviso `CONFIG:`. Cada aviso ali
descreve um problema que vai aparecer no uso:

```
FLAXY 2.1.0 pronto | {'env': 'production', 'database': 'postgres', ...}
```

Health check: `GET /health` (já configurado como `healthCheckPath`).

---

## Frontend na Vercel

### 1. Importar o projeto

**Add New → Project**, apontando para este repositório, e definir:

| Campo | Valor |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Vite (detectado) |

O resto vem do [`frontend/vercel.json`](frontend/vercel.json). O `rewrites` ali é
essencial: sem ele, abrir `/process` direto ou dar F5 devolve 404, porque o build
só tem `index.html` e quem resolve as rotas é o React Router no navegador.

### 2. Variáveis de ambiente

| Variável | Valor |
|---|---|
| `VITE_API_URL` | `https://flaxy-api.onrender.com` |
| `VITE_API_KEY` | o mesmo valor de `FLAXY_API_KEY` no Render |

São lidas em tempo de build. **Mudar qualquer uma exige um redeploy** — não basta
salvar no painel.

### 3. Fechar o círculo do CORS

Com o domínio da Vercel em mãos, volte ao Render e preencha `CORS_ORIGINS`. Até
isso, o navegador bloqueia toda requisição e o app mostra "backend fora do ar".

---

## Rodando local com o mesmo desenho

Nada disso atrapalha o desenvolvimento. Sem variáveis nenhuma:

- SQLite em `backend/flaxy.db`
- Arquivos em `backend/storage/`
- CORS liberado para as portas do Vite
- Sem chave de acesso

Para testar a configuração de produção sem subir nada:

```bash
cd backend && python -c "from settings import settings; print(settings.summary())"
```

---

## Preparado para contas de usuário

Nada de autenticação está implementado. O que existe é o encaixe, para que
adicionar contas seja uma mudança localizada e não uma varredura por todos os
endpoints — que é exatamente onde se esquece um e vaza dado de outra pessoa.

**O que já está no lugar:**

| Peça | Onde | O que faz hoje |
|---|---|---|
| `CurrentUser` + `current_user()` | `backend/auth.py` | Devolve sempre o mesmo dono local. As rotas já declaram a dependência. |
| `owner_filter()` | `backend/auth.py` | Passa direto enquanto o usuário for anônimo; já é chamado na listagem. |
| `templates.owner_id` | `backend/database.py` | Carimbado na criação e na duplicação. Nulo no acervo antigo. |
| `LOCAL_OWNER_ID` | `backend/auth.py` | UUID fixo, para atribuir o acervo existente a uma conta real com um `UPDATE`. |
| Alembic | `backend/migrations/` | Acrescenta tabelas sem recriar o banco. |
| Schema completo | `db/schema.postgres.sql` | `users`, `sessions`, `auth_tokens`, `api_keys`, `plans`, `usage_counters`, `audit_log`. |

**O que falta, em ordem:**

1. Gerar a migração das tabelas de usuários a partir de `db/schema.postgres.sql`.
2. Rotas de registro, login e refresh; hash de senha com Argon2id.
3. Trocar o corpo de `current_user()` para ler a sessão. As rotas não mudam.
4. Deixar `owner_id` obrigatório, depois de atribuir o acervo antigo:
   `UPDATE templates SET owner_id = '<id-real>' WHERE owner_id IS NULL;`
5. Remover `FLAXY_API_KEY` — a essa altura ela vira ruído.
6. Mover lotes e itens da memória para o banco, e só então permitir mais de uma
   instância no Render.
