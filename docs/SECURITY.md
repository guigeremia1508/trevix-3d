# Segurança do Gestão 3D 3.0

## Sessão

O navegador usa sessão armazenada no PostgreSQL. O cookie principal é HttpOnly, SameSite=Lax e Secure em produção. O frontend não armazena token de autenticação.

## CSRF

Requisições mutáveis usam o token CSRF emitido pelo backend.

## Senhas

Novas senhas usam Argon2id. Senhas bcrypt legadas são atualizadas para Argon2id depois de um login válido.

## Autorização

A autorização é aplicada no backend. O perfil CLIENTE só pode consultar os próprios pedidos e a própria produção.

## Uploads

Imagens são enviadas para Cloudinary. Arquivos 3D são tratados como `raw` autenticados e o banco guarda metadados, hash e chave do storage.

## Dados

Valores financeiros usam NUMERIC no PostgreSQL. Operações críticas de estoque e produção usam transações e locks quando necessário.

## Logs

O sistema registra request IDs, erros internos e auditoria de ações relevantes sem gravar senhas, cookies ou tokens.
