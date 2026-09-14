# Revisão e atualização — Gestão 3D

## Implementado

- Pedido → Financeiro: a transição do pedido para `CONFIRMADO` representa a confirmação financeira existente no fluxo atual (`AGUARDANDO_PAGAMENTO` → `CONFIRMADO`). Nesse momento é criada uma única `RECEITA` vinculada ao pedido, marcada como paga.
- Idempotência: a operação usa transação PostgreSQL e bloqueio `FOR UPDATE` do pedido. Repetir a atualização do pedido não cria outra receita.
- Edição após pagamento: a receita automática vinculada é atualizada para refletir o novo total, sem criar uma segunda receita.
- Cancelamento após pagamento: o lançamento original é preservado e é criado um lançamento de `Estorno` negativo, também vinculado ao pedido.
- Dashboard: continua usando `transactions` como fonte de receita; não foi criado um segundo cálculo de receita.
- Frete: `orders.freight` é opcional. O total passa a considerar subtotal - desconto + frete, preservando pedidos antigos com `NULL`.
- Envios: nova tabela `shipments` com FK para `orders` e `customers`, endereço, meio de envio, frete, datas, status, rastreio e observações.
- Regra de envio: existe índice único parcial para impedir mais de um envio ativo para o mesmo pedido.
- Integração Cliente → Pedido → Envio: a lista de pedidos disponíveis é filtrada pelo cliente selecionado e o backend valida a correspondência.
- Pedidos: a listagem mostra o status do envio quando existir e o formulário permite informar frete.
- Backup: `shipments` foi incluída na exportação; restaurações de backups antigos continuam aceitas, tratando `shipments` como tabela opcional do formato anterior.

## Arquivos modificados

- `database/init.js`
- `routes/api.js`
- `utils/business.js`
- `frontend/js/modules/pedidos.js`
- `frontend/js/modules/envios.js` (novo)
- `frontend/index.html`
- `frontend/js/app.js`
- `tests/quality.test.js`

## Validação executada

- Sintaxe Node.js dos arquivos alterados: OK.
- `node --test tests/quality.test.js`: 25/25 testes passaram.
- `node scripts/self-test.js`: OK.
- `node scripts/predeploy-check.js`: OK.
- Teste direto de cálculo: sem frete, com frete e com desconto + frete: OK.

## Observação de deploy

A alteração foi preparada para o fluxo atual de inicialização do PostgreSQL, usando `CREATE TABLE IF NOT EXISTS` e `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Nenhum reset de banco ou comando destrutivo foi incluído.
