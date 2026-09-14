# Deploy do Gestão 3D no Railway

## Arquitetura recomendada

```text
gestao3d (público)
   |
   +---- PostgreSQL (privado)
   |
   +---- Cloudinary (opcional para imagens/arquivos 3D)

   gestao3d-backup (Cron privado)
          |
          +---- PostgreSQL
```

Não é necessário criar um segundo site público.

## Variáveis do serviço `gestao3d`

Obrigatórias:

- `DATABASE_URL` - fornecida/referenciada pelo serviço PostgreSQL.
- `NODE_ENV=production`

Conforme o recurso:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Somente para bootstrap de um banco que ainda não possui ADMIN:

- `INITIAL_ADMIN_EMAIL`
- `INITIAL_ADMIN_PASSWORD`

Proteção de cadastro após existir ADMIN:

- `INVITE_CODE`

Compatibilidade legada opcional:

- `JWT_SECRET` - não é necessário para o fluxo atual por cookie/sessão; mantenha apenas se alguma integração antiga ainda usar Bearer JWT.

## Pós-deploy

1. Abra `/health`.
2. Faça login.
3. Teste editar projeto, pedido e impressora.
4. Crie e atualize uma produção.
5. Verifique consumo e devolução de filamento.
6. Baixe um backup.
7. Não apague o PostgreSQL.

## Banco existente

A aplicação faz upgrades idempotentes de schema no startup. Não recrie o banco para instalar esta versão.


## Backup de produção antes de atualizar

Antes de substituir a versão em produção, faça um backup no próprio painel do Gestão 3D e, de preferência, um snapshot do volume do PostgreSQL no Railway. O Railway permite backups programados do volume e recomenda combinar essa camada com dumps lógicos para recuperação fora do projeto.

Fluxo seguro:

1. Baixar o backup JSON em **Configurações → Backup**.
2. No serviço PostgreSQL do Railway, abrir **Backups** e criar um backup manual ou conferir o agendamento.
3. Fazer deploy da nova versão no serviço `gestao3d`.
4. Conferir `/health`.
5. Testar login, edição de projeto, impressora, produção, estoque, financeiro e backup.

A versão 3.2 usa apenas alterações de schema aditivas (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` e índices). Os dados existentes não são apagados pelo startup normal.

> O backup JSON do aplicativo e o backup/snapshot do Railway têm finalidades complementares. O Railway documenta volume backups, PITR e dumps lógicos como camadas diferentes de recuperação.
