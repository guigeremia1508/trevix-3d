let _envios=[], _clientesEnvio=[], _pedidosEnvio=[];
const shipmentStatuses=['PENDENTE','PREPARANDO','ENVIADO','EM_TRANSITO','ENTREGUE','CANCELADO'];
const shippingMethods=[['CORREIOS','Correios'],['JADLOG','Jadlog'],['MELHOR_ENVIO','Melhor Envio'],['TRANSPORTADORA','Transportadora'],['RETIRADA','Retirada'],['MOTOBOY','Motoboy'],['OUTRO','Outro']];

pageRenderers.envios = async function(){
  const user=JSON.parse(localStorage.getItem('g3d_user')||'{}');
  if(user.role==='CLIENTE'){_envios=[];_clientesEnvio=[];_pedidosEnvio=[];renderEnvios();return;}
  [_envios,_clientesEnvio,_pedidosEnvio]=await Promise.all([API.get('/shipments'),API.get('/customers'),API.get('/shipments/orders-available')]);
  renderEnvios();
};
function shipmentLabel(v){return String(v||'').replace('EM_TRANSITO','Em trânsito').replace(/_/g,' ').replace(/^./,m=>m.toUpperCase());}
function customerOrders(customerId){return _pedidosEnvio.filter(o=>!customerId||Number(o.customer_id)===Number(customerId));}
function renderEnvios(filter=''){
  const list=filter?_envios.filter(s=>`${s.customer_name||''} ${s.product_name||''} ${s.city||''} ${s.status||''}`.toLowerCase().includes(filter)):_envios;
  R('content').innerHTML=`<div class="table-wrap"><div class="table-header"><input class="search-input" placeholder="🔍 Buscar..." oninput="renderEnvios(this.value.toLowerCase())"><button class="btn btn-primary" onclick="openEnvioModal()">+ Novo Envio</button></div><div class="table-scroll"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Cidade</th><th>Meio de envio</th><th>Frete</th><th>Entrega</th><th>Status</th><th>Ações</th></tr></thead><tbody>${list.length?list.map(s=>`<tr><td>#${s.order_id}</td><td><strong>${g3dEscape(s.customer_name||'—')}</strong></td><td>${g3dEscape(s.city||'—')}</td><td>${g3dEscape(shippingMethods.find(x=>x[0]===s.shipping_method)?.[1]||s.shipping_method||'—')}</td><td>${s.freight==null?'—':money(s.freight)}</td><td>${dateStr(s.estimated_delivery)}</td><td>${badge(s.status)}</td><td><div class="actions"><button class="btn btn-secondary btn-sm" onclick="openEnvioModal(${s.id})">✏️</button><button class="btn btn-secondary btn-sm" onclick="viewEnvio(${s.id})">👁️</button>${s.status!=='CANCELADO'?`<button class="btn btn-danger btn-sm" onclick="cancelEnvio(${s.id})">🗑️</button>`:''}</div></td></tr>`).join(''):'<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:2rem">Nenhum envio cadastrado</td></tr>'}</tbody></table></div></div>`;
}
async function loadShipmentOrders(customerId){
  return API.get(`/shipments/orders-available${customerId?`?customer_id=${encodeURIComponent(customerId)}`:''}`);
}
function openEnvioModal(id){
  const existing=id?_envios.find(x=>Number(x.id)===Number(id)):null;
  const customerId=existing?.customer_id||'';
  let orders=customerOrders(customerId);
  if(existing && !orders.some(o=>Number(o.id)===Number(existing.order_id))){orders=[{id:existing.order_id,customer_id:existing.customer_id,product_name:existing.product_name,total:existing.order_total,freight:existing.order_freight,city:existing.city},...orders];}
  const order=existing?orders.find(o=>Number(o.id)===Number(existing.order_id)):null;
  openModal(existing?'Editar Envio':'Novo Envio',`<div class="form-grid">
    <div class="form-group"><label>Cliente *</label><select id="env-customer_id" onchange="refreshEnvioOrders()"><option value="">Selecione...</option>${_clientesEnvio.map(c=>`<option value="${c.id}" ${Number(customerId)===Number(c.id)?'selected':''}>${g3dEscape(c.name)}</option>`).join('')}</select></div>
    <div class="form-group"><label>Pedido *</label><select id="env-order_id" onchange="fillEnvioFromOrder()"><option value="">Selecione...</option>${orders.map(o=>`<option value="${o.id}" ${Number(existing?.order_id)===Number(o.id)?'selected':''}>#${o.id} — ${g3dEscape(o.product_name||'Pedido')} — ${money(o.total)}</option>`).join('')}</select></div>
    <div class="form-group"><label>Cidade</label><input id="env-city" value="${g3dEscape(existing?.city||order?.city||'')}"></div>
    <div class="form-group"><label>Estado</label><input id="env-state" value="${g3dEscape(existing?.state||'')}" maxlength="2"></div>
    <div class="form-group span2"><label>Rua</label><input id="env-street" value="${g3dEscape(existing?.street||'')}"></div>
    <div class="form-group"><label>Número</label><input id="env-number" value="${g3dEscape(existing?.number||'')}"></div>
    <div class="form-group"><label>Complemento</label><input id="env-complement" value="${g3dEscape(existing?.complement||'')}"></div>
    <div class="form-group"><label>Bairro</label><input id="env-neighborhood" value="${g3dEscape(existing?.neighborhood||'')}"></div>
    <div class="form-group"><label>CEP</label><input id="env-postal_code" value="${g3dEscape(existing?.postal_code||'')}"></div>
    <div class="form-group"><label>Meio de envio</label><select id="env-shipping_method">${shippingMethods.map(([v,l])=>`<option value="${v}" ${existing?.shipping_method===v?'selected':''}>${l}</option>`).join('')}</select></div>
    <div class="form-group"><label>Frete cobrado (R$)</label><input type="number" min="0" step="0.01" id="env-freight" value="${existing?.freight??order?.freight??''}" placeholder="Usa o frete do pedido"></div>
    <div class="form-group"><label>Entrega prevista</label><input type="date" id="env-estimated_delivery" value="${existing?.estimated_delivery||''}"></div>
    <div class="form-group"><label>Entrega realizada</label><input type="date" id="env-delivered_at" value="${existing?.delivered_at||''}"></div>
    <div class="form-group"><label>Status</label><select id="env-status">${shipmentStatuses.map(s=>`<option value="${s}" ${existing?.status===s?'selected':''}>${shipmentLabel(s)}</option>`).join('')}</select></div>
    <div class="form-group"><label>Código de rastreio</label><input id="env-tracking_code" value="${g3dEscape(existing?.tracking_code||'')}"></div>
    <div class="form-group span2"><label>Link de rastreamento</label><input id="env-tracking_url" value="${g3dEscape(existing?.tracking_url||'')}" placeholder="https://..."></div>
    <div class="form-group span2"><label>Observações</label><textarea id="env-notes">${g3dEscape(existing?.notes||'')}</textarea></div>
  </div><div class="calc-box" style="margin-top:.5rem"><div class="calc-row"><span>Valor do pedido</span><strong id="env-order-total">${money(existing?.order_total||order?.total||0)}</strong></div><div class="calc-row"><span>Frete do pedido</span><strong id="env-order-freight">${existing?.order_freight==null&&order?.freight==null?'—':money(existing?.order_freight??order?.freight)}</strong></div></div>`, `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveEnvio(${id||0})">Salvar</button>`);
}
async function refreshEnvioOrders(){
  const customerId=R('env-customer_id')?.value||'';const sel=R('env-order_id');if(!sel)return;
  try{const orders=await loadShipmentOrders(customerId);_pedidosEnvio=orders;sel.innerHTML='<option value="">Selecione...</option>'+orders.map(o=>`<option value="${o.id}">#${o.id} — ${g3dEscape(o.product_name||'Pedido')} — ${money(o.total)}</option>`).join('');fillEnvioFromOrder();}catch(e){toast(e.message,'err')}
}
async function fillEnvioFromOrder(){
  const orderId=R('env-order_id')?.value;if(!orderId)return;try{const orders=await loadShipmentOrders(R('env-customer_id')?.value||'');const o=orders.find(x=>Number(x.id)===Number(orderId));if(!o)return;R('env-city').value=o.city||R('env-city').value||'';R('env-freight').value=o.freight??'';R('env-order-total').textContent=money(o.total||0);R('env-order-freight').textContent=o.freight==null?'—':money(o.freight);}catch(e){toast(e.message,'err')}
}
async function saveEnvio(id){
  const body={customer_id:R('env-customer_id').value,order_id:R('env-order_id').value,city:R('env-city').value,state:R('env-state').value,street:R('env-street').value,number:R('env-number').value,complement:R('env-complement').value,neighborhood:R('env-neighborhood').value,postal_code:R('env-postal_code').value,shipping_method:R('env-shipping_method').value,freight:R('env-freight').value,estimated_delivery:R('env-estimated_delivery').value,delivered_at:R('env-delivered_at').value,status:R('env-status').value,tracking_code:R('env-tracking_code').value,tracking_url:R('env-tracking_url').value,notes:R('env-notes').value};
  if(!body.customer_id||!body.order_id)return toast('Cliente e pedido são obrigatórios','err');
  try{if(id)await API.put(`/shipments/${id}`,body);else await API.post('/shipments',body);closeModal();toast('Envio salvo!');pageRenderers.envios();}catch(e){toast(e.message,'err')}
}
async function viewEnvio(id){try{const s=await API.get(`/shipments/${id}`);openModal(`🚚 Envio — Pedido #${s.order_id}`,`<div class="form-grid"><div><strong>Cliente</strong><span>${g3dEscape(s.customer_name||'—')}</span></div><div><strong>Status</strong><span>${badge(s.status)}</span></div><div><strong>Produto</strong><span>${g3dEscape(s.product_name||'—')}</span></div><div><strong>Meio de envio</strong><span>${g3dEscape(shippingMethods.find(x=>x[0]===s.shipping_method)?.[1]||s.shipping_method||'—')}</span></div><div><strong>Endereço</strong><span>${g3dEscape([s.street,s.number,s.complement,s.neighborhood,s.city,s.state,s.postal_code].filter(Boolean).join(', ')||'—')}</span></div><div><strong>Frete</strong><span>${s.freight==null?'—':money(s.freight)}</span></div><div><strong>Entrega prevista</strong><span>${dateStr(s.estimated_delivery)}</span></div><div><strong>Entrega realizada</strong><span>${dateStr(s.delivered_at)}</span></div><div><strong>Rastreio</strong><span>${g3dEscape(s.tracking_code||'—')}</span></div><div><strong>Link</strong><span>${s.tracking_url?`<a href="${g3dEscape(s.tracking_url)}" target="_blank" rel="noopener">Abrir rastreio</a>`:'—'}</span></div><div style="grid-column:1/-1"><strong>Observações</strong><span>${g3dEscape(s.notes||'—')}</span></div></div>`,`<button class="btn btn-secondary" onclick="closeModal()">Fechar</button><button class="btn btn-primary" onclick="closeModal();openEnvioModal(${s.id})">Editar</button>`)}catch(e){toast(e.message,'err')}}
async function cancelEnvio(id){if(!confirmAction('Cancelar este envio?'))return;try{await API.del(`/shipments/${id}`);toast('Envio cancelado!');pageRenderers.envios();}catch(e){toast(e.message,'err')}}
window.renderEnvios=renderEnvios;window.openEnvioModal=openEnvioModal;window.refreshEnvioOrders=refreshEnvioOrders;window.fillEnvioFromOrder=fillEnvioFromOrder;window.saveEnvio=saveEnvio;window.viewEnvio=viewEnvio;window.cancelEnvio=cancelEnvio;
