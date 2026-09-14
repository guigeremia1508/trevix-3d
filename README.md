# Gestão 3D 3.2

Sistema web profissional para pequena operação de impressão 3D e fabricação digital, mantido em uma única aplicação pública Railway com PostgreSQL separado.

## Stack atual
- Node.js + Express
- PostgreSQL
- Frontend web leve em HTML/CSS/JavaScript modular
- Sessões por cookie HttpOnly + CSRF
- Argon2id para senhas novas
- Cloudinary para imagens e arquivos 3D quando configurado
- PWA/offline shell

A especificação master original descreve uma futura arquitetura React + TypeScript + Prisma. Esta versão prioriza estabilidade e evolução incremental da aplicação que já está funcionando em produção, sem reescrever o sistema inteiro.

## Rodar localmente
```bash
npm install
npm run check
npm start
```

## Railway
Mantenha um único serviço público `gestao3d` para o site. O PostgreSQL permanece como serviço privado do projeto; Railway fornece `DATABASE_URL` para os demais serviços. Railway suporta jobs cron separados para tarefas agendadas como backups.

Variáveis principais do serviço web:
- `NODE_ENV=production`
- `DATABASE_URL`
- `INVITE_CODE`
- `JWT_SECRET` é opcional no fluxo atual por sessão e serve apenas para compatibilidade legada
- `INITIAL_ADMIN_EMAIL` e `INITIAL_ADMIN_PASSWORD` apenas no primeiro bootstrap de um banco sem ADMIN
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` se quiser armazenamento de imagens/arquivos 3D

Não coloque credenciais no frontend ou no Git.

## Backup
O painel administrativo mantém backup/restauração lógica e o projeto continua compatível com um serviço Cron privado separado para backup diário. Railway executa Cron Jobs em UTC e o processo deve terminar depois de concluir a tarefa.

## Novidades desta versão 3.1
- Auditoria visual no painel
- Busca global
- Central de notificações
- Calculadora independente de custos/preço
- PWA e cache do shell da aplicação
- Arquivos 3D por versão de projeto via Cloudinary raw/authenticated
- Gerenciamento básico de sessões do usuário
- Perfil CLIENTE com escopo de pedidos/produção por cliente
- Índices adicionais e health check

## Docker

Para desenvolvimento local com PostgreSQL via containers:
```bash
docker compose up --build
```
Troque a senha de desenvolvimento do compose antes de qualquer uso fora da máquina local.

## Testes
```bash
npm run check
```
Depois do deploy, faça um teste real no Railway de login, edição, produção, estoque, upload, backup e restauração.

### Primeiro acesso ADMIN

A aplicação cria automaticamente o primeiro ADMIN somente quando o banco ainda não possui nenhum ADMIN. Para produção, defina `INITIAL_ADMIN_EMAIL` e `INITIAL_ADMIN_PASSWORD` nas Variables do serviço `gestao3d` no Railway. As credenciais não ficam gravadas no código nem no Git. Depois de criado o ADMIN, essas variáveis não alteram usuários existentes.


## Versão
3.3.2

Inclui cadastro inteligente de produtos com impressora/filamento/componentes, seleção de rolo nos pedidos, comprovante copiável para impressora térmica, unidades líquidas nos consumíveis e consumo automático de componentes na finalização da produção.
