let _produtos = [], _projetosP = [], _printersP = [], _rollsP = [], _partsP = [], _consumablesP = [], _productComponents = [];

pageRenderers.produtos = async function () {
  [_produtos, _projetosP, _printersP, _rollsP, _partsP, _consumablesP] = await Promise.all([
    API.get('/products'), API.get('/projects'), API.get('/printers'), API.get('/rolls'), API.get('/parts'), API.get('/consumables')
  ]);
  renderProdutos();
};

function renderProdutos(filter = '') {
  const list = filter ? _produtos.filter(p => (p.name+' '+(p.code||'')).toLowerCase().includes(filter)) : _produtos;
  R('content').innerHTML = `
    <div class="table-wrap">
      <div class="table-header">
        <input class="search-input" placeholder="🔍 Buscar produto..." oninput="renderProdutos(this.value.toLowerCase())">
        <button class="btn btn-primary" onclick="openProdutoModal()">+ Novo Produto</button>
      </div>
      <div class="table-scroll"><table>
        <thead><tr><th>Código</th><th>Nome</th><th>Projeto</th><th>Impressora</th><th>Filamento</th><th>Peso</th><th>Tempo</th><th>Componentes</th><th>Custo Total</th><th>Preço</th><th>Margem</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.length ? list.map(p => `<tr>
          <td>${g3dEscape(p.code||'—')}</td><td><strong>${g3dEscape(p.name)}</strong></td><td>${g3dEscape(p.project_name||'—')}</td>
          <td>${g3dEscape(p.printer_name||'—')}</td><td>${g3dEscape([p.roll_material_type,p.roll_brand,p.roll_code].filter(Boolean).join(' ')||'—')}</td>
          <td>${num(p.weight_g,1)}g</td><td>${num(p.print_time_min,0)}min</td><td>${money(p.component_cost||0)}</td>
          <td>${money(p.cost_total)}</td><td>${money(p.price)}</td><td>${num(p.margin,1)}%</td>
          <td>${p.active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>'}</td>
          <td><div class="actions"><button class="btn btn-secondary btn-sm" onclick="openProdutoModal(${p.id})">✏️</button><button class="btn btn-danger btn-sm" onclick="deleteProduto(${p.id})">🗑️</button></div></td>
        </tr>`).join('') : '<tr><td colspan="13" style="text-align:center;color:var(--text2);padding:2rem">Nenhum produto cadastrado</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

async function openProdutoModal(id) {
  const p = id ? (_produtos.find(x => Number(x.id) === Number(id)) || {}) : {};
  _productComponents = id ? await API.get(`/products/${id}/components`) : [];
  const cfg = await API.get('/settings');
  window._productCfg = cfg;
  const markupDefault = p.markup ?? cfg.default_markup_percent ?? 100;
  openModal(id ? 'Editar Produto' : 'Novo Produto', `
    <div class="form-grid">
      <div class="form-group"><label>Código</label><input id="prod-code" value="${g3dEscape(p.code||'')}"></div>
      <div class="form-group"><label>Nome *</label><input id="prod-name" value="${g3dEscape(p.name||'')}"></div>
      <div class="form-group"><label>Projeto</label><select id="prod-project_id"><option value="">—</option>${_projetosP.map(pr=>`<option value="${pr.id}" ${Number(p.project_id)===Number(pr.id)?'selected':''}>${g3dEscape(pr.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Impressora</label><select id="prod-printer_id" onchange="calcProduto()"><option value="">Selecione...</option>${_printersP.map(pr=>`<option value="${pr.id}" data-power="${pr.power_watts||0}" ${Number(p.printer_id)===Number(pr.id)?'selected':''}>${g3dEscape(pr.name)} — ${num(pr.power_watts,0)}W</option>`).join('')}</select></div>
      <div class="form-group span2"><label>Filamento / Rolo</label><select id="prod-material_roll_id" onchange="calcProduto()"><option value="">Selecione um rolo...</option>${_rollsP.map(r=>`<option value="${r.id}" data-cpg="${r.cost_per_gram||0}" data-material="${g3dEscape([r.type,r.brand,r.color,r.code].filter(Boolean).join(' '))}" ${Number(p.material_roll_id)===Number(r.id)?'selected':''}>${g3dEscape([r.type,r.brand,r.color,r.code].filter(Boolean).join(' '))} — ${num(r.current_weight_g,0)}g — R$ ${num(r.cost_per_gram,4)}/g</option>`).join('')}</select></div>
      <div class="form-group"><label>Peso (g)</label><input type="number" id="prod-weight_g" value="${p.weight_g||0}" step="0.1" min="0" oninput="calcProduto()"></div>
      <div class="form-group"><label>Tempo de Impressão (min)</label><input type="number" id="prod-print_time_min" value="${p.print_time_min||0}" step="1" min="0" oninput="calcProduto()"></div>
      <div class="form-group"><label>Tempo de desenvolvimento (min)</label><input type="number" id="prod-development_time_min" value="${p.development_time_min ?? cfg.default_development_time_min ?? 0}" step="1" min="0" oninput="calcProduto()"></div>
      <div class="form-group"><label>Markup (%)</label><input type="number" id="prod-markup" value="${markupDefault}" step="0.1" min="0" oninput="calcProduto()"></div>
    </div>
    <div class="table-wrap" style="padding:1rem;margin:.75rem 0">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem"><strong>🔩 Componentes do produto</strong><button class="btn btn-secondary btn-sm" onclick="addProductComponentRow()">+ Adicionar peça/consumível</button></div>
      <div id="product-components-list" style="margin-top:.75rem"></div>
      <small style="color:var(--text2)">O custo é calculado com o preço cadastrado da peça/consumível. O estoque será baixado quando a produção do produto for finalizada.</small>
    </div>
    <h4 style="margin:.75rem 0 .5rem;font-size:.9rem">💰 Custos calculados</h4>
    <div class="form-grid cols3">
      ${[['material','Material'],['energy','Energia'],['machine','Máquina'],['maintenance','Manutenção'],['labor','Mão de Obra'],['packaging','Embalagem'],['finishing','Acabamento']].map(([k,l])=>`<div class="form-group"><label>${l} (R$)</label><input type="number" id="prod-cost_${k}" value="${p['cost_'+k]||0}" step="0.01" oninput="calcProduto()" class="prod-cost-input"></div>`).join('')}
    </div>
    <label class="form-check" style="display:flex;align-items:center;gap:.5rem;margin:.5rem 0"><input type="checkbox" id="prod-costs_manual" ${p.costs_manual?'checked':''} onchange="toggleManualProductCosts()"> Personalizar custos manualmente</label>
    <div class="form-grid" style="margin-top:.5rem"><div class="form-group"><label>Preço de Venda (R$)</label><input type="number" id="prod-price" data-manual="${p.price>0?'1':'0'}" value="${p.price||0}" step="0.01" min="0" oninput="calcProduto('manual-price')"></div></div>
    <div class="calc-box" id="calc-result"><div class="calc-row"><span>Custo Total</span><span id="cr-custo">R$ 0,00</span></div><div class="calc-row"><span>Lucro</span><span id="cr-lucro">R$ 0,00</span></div><div class="calc-row"><span>Margem</span><span id="cr-margem">0%</span></div><div class="calc-row"><span>Markup</span><span id="cr-markup">0%</span></div></div>
    <div class="form-group" style="margin-top:.75rem"><label>Observações</label><textarea id="prod-notes">${g3dEscape(p.notes||'')}</textarea></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveProduto(${id||0})">Salvar</button>`, true);
  renderProductComponentRows(); toggleManualProductCosts(); calcProduto();
}

function componentOptions(kind, selected='') {
  const arr=kind==='part'?_partsP:_consumablesP;
  return `<option value="">Selecione...</option>`+arr.map(x=>`<option value="${x.id}" ${Number(selected)===Number(x.id)?'selected':''}>${g3dEscape(x.name)}${kind==='part'&&x.size?' — '+g3dEscape(x.size):''} — R$ ${num(x.unit_cost,4)}/${g3dEscape(kind==='part'?'un':(x.unit||'un'))}</option>`).join('');
}
function renderProductComponentRows(){const box=R('product-components-list');if(!box)return;box.innerHTML=_productComponents.map((c,i)=>`<div class="component-row" data-i="${i}" style="display:grid;grid-template-columns:130px 1fr 110px 40px;gap:.5rem;margin-bottom:.5rem"><select onchange="componentKindChanged(${i})" id="pc-kind-${i}"><option value="part" ${c.kind==='part'?'selected':''}>Peça</option><option value="consumable" ${c.kind==='consumable'?'selected':''}>Consumível</option></select><select id="pc-item-${i}">${componentOptions(c.kind,c.part_id||c.consumable_id)}</select><input type="number" id="pc-qty-${i}" value="${c.quantity||1}" min="0.001" step="0.001"><button class="btn btn-danger btn-sm" onclick="removeProductComponentRow(${i})">×</button></div>`).join('')||'<div style="color:var(--text2);font-size:.82rem">Nenhum componente.</div>';}
function addProductComponentRow(){_productComponents.push({kind:'part',quantity:1});renderProductComponentRows();calcProduto();}
function removeProductComponentRow(i){_productComponents.splice(i,1);renderProductComponentRows();calcProduto();}
function componentKindChanged(i){const kind=R(`pc-kind-${i}`).value;_productComponents[i]={..._productComponents[i],kind,item_id:null,part_id:null,consumable_id:null};renderProductComponentRows();calcProduto();}
function readProductComponents(){return _productComponents.map((c,i)=>{const kind=R(`pc-kind-${i}`)?.value||c.kind;const item=R(`pc-item-${i}`)?.value||'';const qty=Number(R(`pc-qty-${i}`)?.value||0);return {kind,item_id:item,quantity:qty};}).filter(c=>c.item_id&&c.quantity>0);}
function toggleManualProductCosts(){const manual=R('prod-costs_manual')?.checked;document.querySelectorAll('.prod-cost-input').forEach(x=>x.readOnly=!manual);if(!manual)calcProduto();}
function calcProduto(priceOrigin){const weight=Number(R('prod-weight_g')?.value)||0,time=Number(R('prod-print_time_min')?.value)||0,dev=Number(R('prod-development_time_min')?.value)||0;const printer=_printersP.find(x=>Number(x.id)===Number(R('prod-printer_id')?.value));const roll=_rollsP.find(x=>Number(x.id)===Number(R('prod-material_roll_id')?.value));const cfgCache=window._productCfg||{};const energyKwh=Number(cfgCache.energy_cost_kwh||0);const machineRate=Number(cfgCache.machine_cost_hour||0);const maintenanceRate=Number(cfgCache.maintenance_cost_hour||0);const laborRate=Number(cfgCache.labor_cost_hour||0);const material=weight*(Number(roll?.cost_per_gram)||0),hours=time/60,energy=printer?(Number(printer.power_watts||0)/1000)*hours*energyKwh:0,machine=hours*machineRate,maintenance=hours*maintenanceRate,labor=dev/60*laborRate;let parts=0;readProductComponents().forEach(c=>{const arr=c.kind==='part'?_partsP:_consumablesP,item=arr.find(x=>Number(x.id)===Number(c.item_id));parts+=Number(c.quantity)*Number(item?.unit_cost||0)});const manual=!!R('prod-costs_manual')?.checked;let total;if(manual){total=['material','energy','machine','maintenance','labor','packaging','finishing'].reduce((a,k)=>a+(Number(R('prod-cost_'+k)?.value)||0),0)+parts}else{R('prod-cost_material').value=material.toFixed(2);R('prod-cost_energy').value=energy.toFixed(2);R('prod-cost_machine').value=machine.toFixed(2);R('prod-cost_maintenance').value=maintenance.toFixed(2);R('prod-cost_labor').value=labor.toFixed(2);if(!R('prod-cost_packaging').value)R('prod-cost_packaging').value=Number(cfgCache.default_packaging_cost||0).toFixed(2);if(!R('prod-cost_finishing').value)R('prod-cost_finishing').value=Number(cfgCache.default_finishing_cost||0).toFixed(2);total=material+energy+machine+maintenance+labor+(Number(R('prod-cost_packaging')?.value)||0)+(Number(R('prod-cost_finishing')?.value)||0)+parts}const priceEl=R('prod-price');if(priceEl&&priceOrigin==='manual-price')priceEl.dataset.manual='1';const autoMarkup=Number(R('prod-markup')?.value||cfgCache.default_markup_percent||100);if(priceEl&&!priceEl.dataset.manual&&total>=0)priceEl.value=(total*(1+autoMarkup/100)).toFixed(2);R('cr-custo').textContent=money(total);const price=Number(priceEl?.value)||0;const lucro=price-total;const margem=price>0?lucro/price*100:0;const markup=total>0?lucro/total*100:0;R('cr-lucro').textContent=money(lucro);R('cr-margem').textContent=num(margem,1)+'%';R('cr-markup').textContent=num(markup,1)+'%';}
async function saveProduto(id){const cfg=await API.get('/settings');window._productCfg=cfg;const price=Number(R('prod-price').value)||0, body={code:R('prod-code').value,name:R('prod-name').value,project_id:R('prod-project_id').value||null,printer_id:R('prod-printer_id').value||null,material_roll_id:R('prod-material_roll_id').value||null,material_type:'',weight_g:R('prod-weight_g').value,print_time_min:R('prod-print_time_min').value,development_time_min:R('prod-development_time_min').value,cost_material:R('prod-cost_material').value,cost_energy:R('prod-cost_energy').value,cost_machine:R('prod-cost_machine').value,cost_labor:R('prod-cost_labor').value,cost_packaging:R('prod-cost_packaging').value,cost_finishing:R('prod-cost_finishing').value,cost_maintenance:R('prod-cost_maintenance').value,costs_manual:R('prod-costs_manual').checked,price,notes:R('prod-notes').value,active:true,components:readProductComponents(),markup_percent:R('prod-markup').value};if(!body.name)return toast('Nome é obrigatório','err');try{if(id)await API.put(`/products/${id}`,body);else await API.post('/products',body);closeModal();toast('Produto salvo!');pageRenderers.produtos()}catch(e){toast(e.message,'err')}}
async function deleteProduto(id){if(!confirmAction('Excluir este produto?'))return;try{await API.del(`/products/${id}`);toast('Excluído!');pageRenderers.produtos()}catch(e){toast(e.message,'err')}}
window.openProdutoModal=openProdutoModal;window.saveProduto=saveProduto;window.deleteProduto=deleteProduto;window.calcProduto=calcProduto;window.addProductComponentRow=addProductComponentRow;window.removeProductComponentRow=removeProductComponentRow;window.componentKindChanged=componentKindChanged;