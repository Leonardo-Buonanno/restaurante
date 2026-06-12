# MesaPro

Aplicativo full stack para operacao de restaurante em mesas, criado para garcons, cozinha, caixa e gerente.

## Estado inicial

O projeto nao inclui dados ficticios. Em uma instalacao nova, o banco nasce sem:

- mesas;
- produtos;
- pedidos;
- chamados;
- pagamentos;
- funcionarios de demonstracao.

O primeiro administrador e criado na tela de primeiro acesso. `INITIAL_ADMIN_PIN` continua disponivel apenas como bootstrap opcional para implantacoes automatizadas.

## O que existe

- Frontend React + TypeScript + Vite.
- Backend Node.
- SQLite local em `data/mesa-pro.sqlite` para desenvolvimento.
- PostgreSQL em producao via `DATABASE_URL`.
- Autenticacao por PIN no servidor.
- PINs com hash PBKDF2, nao expostos no bundle do navegador.
- Sessao por token com expiracao.
- Escopo por restaurante.
- Permissoes por cargo.
- Permissoes por acao sensivel.
- Operacoes transacionais no backend para mesas, pedidos, pagamentos, cardapio e acessos.
- Controle de versao do estado operacional e fila offline por operacao.
- Cadastro, alteracao, desativacao e reset de PIN de operadores.
- Snapshot operacional persistido no banco.
- Modo offline com fila local de sincronizacao.
- PWA instalavel com manifest e service worker.
- Auditoria basica de login, logout, alteracoes de estado e integracoes.
- Relatorio persistente via API.
- Tela de integracoes para impressora, pagamentos e KDS externo.
- Integracao fiscal externa para solicitar emissao NFC-e/SAT via provedor homologado.
- Logs estruturados em JSON.
- Healthcheck, readiness e metricas de operacao.
- HTTPS configuravel no Node ou por Caddy.
- Backup manual e automatico.
- Retencao, criptografia opcional e webhook de alerta para backup.
- Dockerfile e docker-compose com PostgreSQL + Caddy.

## Primeiro acesso

Em uma instalacao nova, abra o app e preencha a tela de primeiro acesso com:

- nome do administrador;
- PIN numerico de 4 a 12 digitos;
- confirmacao do PIN.

Depois disso, o app entra automaticamente com esse administrador.

Opcionalmente, para implantacoes automatizadas, configure as variaveis antes de iniciar a API pela primeira vez:

```text
RESTAURANT_NAME=Nome do Restaurante
RESTAURANT_SLUG=principal
VITE_RESTAURANT_SLUG=principal
INITIAL_ADMIN_NAME=Administrador
INITIAL_ADMIN_PIN=defina_um_pin_seguro
```

## Como rodar em desenvolvimento

Em um terminal:

```bash
npm run dev:api
```

Em outro terminal:

```bash
npm run dev
```

Abra:

```text
http://127.0.0.1:5173
```

## Como rodar em modo producao local

```bash
npm run build
npm start
```

Abra:

```text
http://127.0.0.1:8787
```

## Treinamento da equipe

O roteiro completo de treinamento esta em:

```text
docs/TREINAMENTO.md
```

Use esse material para treinar administrador, gerente, garcom, cozinha e caixa antes do primeiro turno real.

## Modo offline e PWA

Em producao, o app registra um service worker e pode ser instalado pelo navegador como aplicativo. Quando a internet ou a API cai durante o uso:

- as alteracoes continuam salvas no aparelho;
- o topo do app mostra o status `Offline` ou pendencias de sincronizacao;
- a fila guarda o ultimo estado operacional pendente;
- ao voltar a conexao, o app sincroniza automaticamente;
- tambem existe o botao `Sincronizar` quando houver pendencia e rede disponivel.

Para testar o PWA localmente:

```bash
npm run build
npm start
```

Depois acesse:

```text
http://127.0.0.1:8787
```

O service worker so e registrado no build de producao, nao no `npm run dev`.

## Como rodar com PostgreSQL e HTTPS via Docker

Crie um arquivo `.env` a partir de `.env.example` e ajuste:

```text
POSTGRES_PASSWORD=uma_senha_forte
APP_DOMAIN=seudominio.com
CORS_ORIGIN=https://seudominio.com
BACKUP_INTERVAL_MINUTES=1440
```

Depois rode:

```bash
docker compose up --build -d
```

O compose sobe:

- `postgres`: banco PostgreSQL persistente;
- `app`: API + frontend;
- `caddy`: proxy reverso com HTTPS automatico.

## Variaveis importantes

- `DATABASE_URL`: ativa PostgreSQL. Se nao existir, usa SQLite.
- `PGSSL=true`: usa SSL na conexao PostgreSQL.
- `HOST`: use `0.0.0.0` em container/servidor.
- `PORT`: porta da API/app.
- `CORS_ORIGIN`: origem permitida em producao.
- `HTTPS_KEY_PATH` e `HTTPS_CERT_PATH`: certificados para HTTPS direto no Node.
- `BACKUP_INTERVAL_MINUTES`: intervalo do backup automatico. `0` desativa.
- `BACKUP_DIR`: pasta dos backups.
- `RESTAURANT_NAME`: nome real do restaurante.
- `RESTAURANT_SLUG`: identificador do restaurante na API.
- `VITE_RESTAURANT_SLUG`: mesmo slug usado pelo frontend.
- `INITIAL_ADMIN_PIN`: cria o primeiro administrador quando nao houver funcionarios.

## Backup

Backup manual:

```bash
npm run backup
```

Com SQLite, o backup gera `.sqlite`. Com PostgreSQL, o backup usa `pg_dump` e gera `.dump`, por isso `pg_dump` precisa estar instalado no ambiente.

Validacao nao destrutiva de restauracao:

```bash
BACKUP_SOURCE=/caminho/mesapro-backup.sqlite npm run restore:check
```

Se `BACKUP_ENCRYPTION_KEY` estiver definido, o backup sera salvo como `.enc` com metadados em `.meta.json`, e o mesmo valor da chave deve ser usado no `restore:check`.

## Endpoints principais

- `GET /api/health`
- `GET /api/ready`
- `GET /api/metrics`
- `GET /api/bootstrap?restaurant=principal`
- `POST /api/setup/admin`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/state`
- `PUT /api/state` legado restrito a administradores com permissao de reset
- `POST /api/operations`
- `POST /api/tables`
- `POST /api/tables/:id/open`
- `POST /api/tables/:id/send-to-kitchen`
- `POST /api/tables/:id/close`
- `POST /api/orders`
- `POST /api/orders/:id/status`
- `POST /api/orders/:id/cancel`
- `POST /api/payments`
- `POST /api/staff`
- `POST /api/staff/:id`
- `POST /api/staff/:id/pin`
- `GET /api/reports/summary`
- `GET /api/integrations`
- `PUT /api/integrations`
- `POST /api/integrations/test`
- `GET /api/fiscal`
- `PUT /api/fiscal`
- `POST /api/fiscal/test`
- `GET /api/privacy/export`
- `DELETE /api/privacy/operational-data`

## Compliance comercial

O checklist fiscal/LGPD/operacional esta em:

```text
docs/COMERCIAL_COMPLIANCE.md
```

## Observacoes para venda real

SQLite continua disponivel para piloto, demonstracao comercial e instalacao local pequena. Para SaaS ou cliente comercial em nuvem, use `DATABASE_URL` com PostgreSQL, Caddy/HTTPS, backups automaticos e monitoramento em `/api/health`, `/api/ready` e `/api/metrics`.
