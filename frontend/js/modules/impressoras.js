let _impressoras = [];

pageRenderers.impressoras = async function () {
  [_impressoras] = await Promise.all([API.get('/printers')]);
  renderImpressoras();
};

function renderImpressoras() {
  R('content').innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:1rem">
      <button class="btn btn-primary" onclick="openImpressoraModal()">+ Nova Impressora</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem">
      ${_impressoras.length ? _impressoras.map(p => `
        <div class="table-wrap" style="padding:1.25rem">
          ${p.photo_url ? `<img src="${p.photo_url}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;float:right;margin-left:.5rem">` : ''}<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.75rem">
            <div><strong>${p.name}</strong><br><span style="font-size:.8rem;color:var(--text2)">${p.brand||''} ${p.model||''}</span></div>
            ${badge(p.status)}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;font-size:.82rem;color:var(--text2);margin-bottom:1rem">
            <span>🕐 ${num(Number(p.total_hours||0)+Number(p.test_hours||0),1)}h totais</span>
            <span>🖨️ ${Number(p.total_prints||0)+Number(p.test_prints||0)} impressões</span>
            <span>❌ ${Number(p.total_failures||0)+Number(p.test_failures||0)} falhas</span>
            <span>🔴 ${num(Number(p.filament_used_g||0)+Number(p.test_filament||0),0)}g filamento</span>
          </div>
          <div style="display:flex;gap:.5rem">
            <button class="btn btn-secondary btn-sm" onclick="openImpressoraModal(${p.id})">✏️ Editar</button>
            <button class="btn btn-secondary btn-sm" onclick="openManutencaoModal(${p.id},'${p.name}')">🔧 Manutenção</button>
            <button class="btn btn-danger btn-sm" onclick="deleteImpressora(${p.id})">🗑️</button>
          </div>
        </div>`).join('') : '<p style="color:var(--text2)">Nenhuma impressora cadastrada.</p>'}
    </div>`;
}

function openImpressoraModal(id) {
  id = id ? Number(id) : 0;
  const p = id ? (_impressoras.find(x => Number(x.id) === id) || {}) : {};
  openModal(id ? 'Editar Impressora' : 'Nova Impressora', `
    <div class="form-grid">
      <div class="form-group span2"><label>Nome *</label><input id="pf-name" value="${p.name||''}"></div>
      <div class="form-group"><label>Fabricante</label><input id="pf-brand" value="${p.brand||''}"></div>
      <div class="form-group"><label>Modelo</label><input id="pf-model" value="${p.model||''}"></div>
      <div class="form-group"><label>Nº de Série</label><input id="pf-serial" value="${p.serial||''}"></div>
      <div class="form-group"><label>Localização</label><input id="pf-location" value="${p.location||''}"></div>
      <div class="form-group"><label>Data de Compra</label><input type="date" id="pf-purchase_date" value="${p.purchase_date||''}"></div>
      <div class="form-group"><label>Preço de Compra (R$)</label><input type="number" id="pf-purchase_price" value="${p.purchase_price||0}"></div>
      <div class="form-group"><label>Potência (W)</label><input type="number" id="pf-power_watts" value="${p.power_watts||0}"></div>
      ${id ? `<div class="form-group"><label>Status</label><select id="pf-status"><option value="DISPONIVEL" ${p.status==='DISPONIVEL'?'selected':''}>Disponível</option><option value="IMPRIMINDO" ${p.status==='IMPRIMINDO'?'selected':''}>Imprimindo</option><option value="MANUTENCAO" ${p.status==='MANUTENCAO'?'selected':''}>Manutenção</option><option value="OFFLINE" ${p.status==='OFFLINE'?'selected':''}>Offline</option></select></div>` : ''}
      <div class="form-group span2"><label>Foto da impressora</label><input type="file" id="pf-photo" accept="image/*"><small style="color:var(--text2)">PNG/JPG/WebP até 8 MB.</small></div><div class="form-group span2"><label>Observações</label><textarea id="pf-notes">${p.notes||''}</textarea></div>${p.photo_url?`<div class="form-group span2"><img src="${p.photo_url}" style="width:100%;max-height:180px;object-fit:contain;border-radius:8px"></div>`:''}
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
     <button class="btn btn-primary" onclick="saveImpressora(${id||0})">Salvar</button>`);
}

async function saveImpressora(id) {
  const body = {
    name: R('pf-name').value, brand: R('pf-brand').value, model: R('pf-model').value,
    serial: R('pf-serial').value, location: R('pf-location').value,
    purchase_date: R('pf-purchase_date').value, purchase_price: R('pf-purchase_price').value,
    power_watts: R('pf-power_watts').value, notes: R('pf-notes').value,
    status: id ? R('pf-status').value : 'DISPONIVEL'
  };
  if (!body.name) return toast('Nome é obrigatório', 'err');
  try {
    let result; if (id) result = await API.put(`/printers/${id}`, body); else result = await API.post('/printers', body);
    const photo = R('pf-photo')?.files?.[0]; if(photo) await API.upload(`/uploads/printers/${id || result.id}`, photo);
    closeModal(); toast('Salvo!'); pageRenderers.impressoras();
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteImpressora(id) {
  if (!confirmAction('Excluir esta impressora?')) return;
  try { await API.del(`/printers/${id}`); toast('Excluída!'); pageRenderers.impressoras(); } catch (e) { toast(e.message, 'err'); }
}

async function openManutencaoModal(pid,pname,planId=0){
  const [list,tools,parts,plans] = await Promise.all([
    API.get(`/printers/${pid}/maintenance`),API.get('/consumables'),API.get('/parts'),API.get('/maintenance/plans')
  ]);
  const mine=plans.filter(p=>Number(p.printer_id)===Number(pid));
  const selectedPlan=mine.find(p=>Number(p.id)===Number(planId));
  const planOptions=mine.map(p=>`<option value="${p.id}" data-task="${String(p.task).replace(/"/g,'&quot;')}" ${selectedPlan&&Number(selectedPlan.id)===Number(p.id)?'selected':''}>${p.task} — ${p.status==='ATRASADA'?'ATRASADA':p.hours_remaining!=null?'faltam '+num(p.hours_remaining,1)+'h':p.status}</option>`).join('');
  openModal(`🔧 Manutenção — ${pname}`, `
    <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-bottom:1rem">
      <button class="btn btn-secondary btn-sm" onclick="openPlanModal(${pid},'${pname.replaceAll("'","\\'")}')">📅 Planos preventivos</button>
    </div>
    <div class="form-grid">
      <div class="form-group span2"><label>Manutenção programada</label><select id="mf-plan_id" onchange="syncMaintenancePlanTask()"><option value="">Manutenção manual / sem plano</option>${planOptions}</select></div>
      <div class="form-group span2"><label>Tarefa *</label><input id="mf-task" value="${selectedPlan?selectedPlan.task:''}" placeholder="Ex.: Lubrificar eixos"></div>
      <div class="form-group"><label>Agendado para</label><input type="date" id="mf-scheduled_at"></div>
      <div class="form-group"><label>Realizado em</label><input type="date" id="mf-done_at" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="form-group"><label>Horas da impressora</label><input type="number" id="mf-hours_at" step="0.1" placeholder="Automático: uso atual"></div>
      <div class="form-group"><label>Custo direto (R$)</label><input type="number" id="mf-cost" value="0" step="0.01"></div>
      <div class="form-group span2"><label>Consumível usado</label><select id="mf-tool"><option value="">Nenhum</option>${tools.map(x=>`<option value="${x.id}">${x.name} — estoque ${num(x.current_qty,2)} ${x.unit}</option>`).join('')}</select></div>
      <div class="form-group"><label>Qtd. consumível</label><input type="number" id="mf-tool-qty" value="1" step="0.01"></div>
      <div class="form-group span2"><label>Peça usada</label><select id="mf-part"><option value="">Nenhuma</option>${parts.map(x=>`<option value="${x.id}">${x.name}${x.type?' — '+x.type:''}${x.size?' — '+x.size:''} — estoque ${num(x.current_qty,2)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Qtd. peça</label><input type="number" id="mf-part-qty" value="1" step="0.01"></div>
      <div class="form-group span2"><label>Texto livre / peças adicionais</label><input id="mf-parts_used" placeholder="Ex.: 2 parafusos M3 que não estão no cadastro"></div>
      <div class="form-group span2"><label>Observações</label><textarea id="mf-notes"></textarea></div>
    </div>
    <div class="alert warn" style="margin-top:1rem">Ao registrar uma manutenção programada como concluída, o próximo ciclo é calculado a partir das horas atuais. O contador total da impressora nunca é zerado.</div>
    <h4 style="margin:1.25rem 0 .75rem;font-size:.9rem">Histórico</h4>
    <table><thead><tr><th>Tarefa</th><th>Data</th><th>Horas</th><th>Custo</th></tr></thead>
    <tbody>${list.length ? list.map(m=>`<tr><td>${m.task}${m.plan_task?` <span style="color:var(--text2)">• programada</span>`:''}</td><td>${dateStr(m.done_at||m.scheduled_at)}</td><td>${m.hours_at!=null?num(m.hours_at,1)+'h':'—'}</td><td>${money(m.cost)}</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text2)">Sem registros</td></tr>'}</tbody></table>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Fechar</button><button class="btn btn-primary" onclick="saveManutencao(${pid})">✓ Registrar manutenção</button>`, true);
}
function syncMaintenancePlanTask(){
 const sel=R('mf-plan_id'),opt=sel?.selectedOptions?.[0];
 if(sel&&R('mf-task')&&sel.value) R('mf-task').value=opt?.dataset?.task||'';
}
async function saveManutencao(pid){
 const toolId=R('mf-tool').value,partId=R('mf-part').value,planId=R('mf-plan_id').value;
 const body={plan_id:planId?Number(planId):null,task:R('mf-task').value.trim(),scheduled_at:R('mf-scheduled_at').value,done_at:R('mf-done_at').value,hours_at:R('mf-hours_at').value,cost:R('mf-cost').value,parts_used:R('mf-parts_used').value,notes:R('mf-notes').value,consumables:toolId?[{id:Number(toolId),quantity:Number(R('mf-tool-qty').value||0)}]:[],parts:partId?[{id:Number(partId),quantity:Number(R('mf-part-qty').value||0)}]:[]};
 if(!body.task)return toast('Tarefa é obrigatória','err');
 try{await API.post(`/printers/${pid}/maintenance`,body);closeModal();toast(planId?'Manutenção registrada e próximo ciclo atualizado!':'Manutenção registrada e estoque atualizado!');pageRenderers.impressoras()}catch(e){toast(e.message,'err')}
}
async function openPlanModal(pid,pname){
  const plans=await API.get('/maintenance/plans');
  const mine=plans.filter(p=>Number(p.printer_id)===Number(pid));
  openModal(`📅 Plano Preventivo — ${pname}`,`
    <div class="form-grid" style="margin-bottom:1rem">
      <div class="form-group span2"><label>Manutenção recomendada</label><select id="mp-preset" onchange="applyMaintenancePreset()"><option value="">Personalizada</option><option value="100-inspecao">100h — Inspeção e limpeza básica</option><option value="100-eixos">100h — Verificar eixos, ruídos e movimento</option><option value="250-detalhada">250h — Inspeção detalhada</option><option value="500-lubrificacao">500h — Lubrificação completa preventiva</option><option value="1000-revisao">1000h — Revisão geral profunda</option><option value="2000-completa">2000h — Revisão completa e itens de desgaste</option></select></div><div class="form-group span2"><label>Tarefa *</label><input id="mp-task" placeholder="Ex.: Lubrificar eixos"></div>
      <div class="form-group"><label>A cada horas</label><input type="number" id="mp-hours" placeholder="100" min="0.1" step="0.1"></div>
      <div class="form-group"><label>A cada dias (opcional)</label><input type="number" id="mp-days" placeholder="Ex.: 30" min="1" step="1"></div>
      <div class="form-group"><label>Próxima data (opcional)</label><input type="date" id="mp-nextdate"></div>
      <div class="form-group"><label>Próximas horas (opcional)</label><input type="number" id="mp-nexthours" placeholder="Automático" min="0" step="0.1"></div>
      <div class="form-group span2"><label>Descrição / observações</label><textarea id="mp-notes" placeholder="O que deve ser verificado ou feito?"></textarea></div>
    </div>
    <div class="alert" style="margin-bottom:1rem">Aviso de proximidade: <strong>20h</strong> antes da manutenção. Ao atingir a meta, o status fica vermelho.</div>
    <h4 style="margin:.5rem 0 .75rem">Planos cadastrados</h4>
    <table><thead><tr><th>Tarefa</th><th>Intervalo</th><th>Próximo</th><th>Status</th><th>Ações</th></tr></thead><tbody>${mine.length?mine.map(p=>`<tr>
      <td>${p.task}</td>
      <td>${p.interval_hours?num(p.interval_hours,0)+'h':''}${p.interval_hours&&p.interval_days?' / ':''}${p.interval_days?num(p.interval_days,0)+' dias':''}</td>
      <td>${p.next_due_hours!=null?num(p.next_due_hours,0)+'h':''}${p.next_due_hours!=null&&p.next_due_date?' / ':''}${p.next_due_date?dateStr(p.next_due_date):''}</td>
      <td>${p.status==='ATRASADA'?'🔴 Manutenção necessária':p.status==='PROXIMA'?'🟡 Próxima':'🟢 Em dia'}${p.hours_remaining!=null&&p.status!=='ATRASADA'?`<br><small>faltam ${num(p.hours_remaining,1)}h</small>`:''}</td>
      <td style="white-space:nowrap"><button class="btn btn-primary btn-sm" onclick="openManutencaoModal(${pid},'${pname.replaceAll("'","\\'")}',${p.id})">✓ Registrar</button> <button class="btn btn-secondary btn-sm" onclick="editPlan(${p.id},${pid},'${pname.replaceAll("'","\\'")}')">✏️</button> <button class="btn btn-danger btn-sm" onclick="deletePlan(${p.id},${pid},'${pname.replaceAll("'","\\'")}')">🗑️</button></td>
    </tr>`).join(''):'<tr><td colspan="5" style="color:var(--text2);text-align:center">Nenhum plano.</td></tr>'}</tbody></table>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Fechar</button><button class="btn btn-primary" onclick="savePlan(${pid},'${pname.replaceAll("'","\\'")}')">+ Criar plano</button>`,true);
}
function applyMaintenancePreset(){const v=R('mp-preset')?.value;const presets={
 '100-inspecao':['Inspeção e limpeza básica',100,'Limpar mesa, remover resíduos, verificar ruídos e aperto geral.'],
 '100-eixos':['Verificar eixos, ruídos e movimento',100,'Verificar folgas, ruídos, movimento dos eixos e aperto das fixações.'],
 '250-detalhada':['Inspeção detalhada',250,'Inspecionar correias, roldanas, parafusos, mesa, cabos e conectores.'],
 '500-lubrificacao':['Lubrificação completa preventiva',500,'Lubrificar eixos e pontos recomendados pelo fabricante; revisar movimento.'],
 '1000-revisao':['Revisão geral profunda',1000,'Revisão completa, desgaste, cabos, ventoinhas, correias, eixos e elementos de fixação.'],
 '2000-completa':['Revisão completa e itens de desgaste',2000,'Revisão completa e substituição preventiva de componentes de desgaste quando necessário.']};const p=presets[v];if(!p)return;if(R('mp-task'))R('mp-task').value=p[0];if(R('mp-hours'))R('mp-hours').value=p[1];if(R('mp-notes'))R('mp-notes').value=p[2];}
async function savePlan(pid,pname){
 const b={printer_id:pid,task:R('mp-task').value.trim(),interval_hours:R('mp-hours').value,interval_days:R('mp-days').value,next_due_date:R('mp-nextdate').value,next_due_hours:R('mp-nexthours').value,notes:R('mp-notes').value};
 if(!b.task)return toast('Informe a tarefa','err');
 const hours=Number(b.interval_hours),days=Number(b.interval_days),dueHours=Number(b.next_due_hours);
 if(!b.interval_hours&&!b.interval_days)return toast('Informe o intervalo em horas ou dias','err');
 if(b.interval_hours&&(!Number.isFinite(hours)||hours<=0))return toast('A cada horas deve ser maior que zero','err');
 if(b.interval_days&&(!Number.isFinite(days)||days<=0))return toast('A cada dias deve ser maior que zero','err');
 if(b.next_due_hours&&(!Number.isFinite(dueHours)||dueHours<0))return toast('Próximas horas inválidas','err');
 try{await API.post('/maintenance/plans',b);toast('Plano criado!');openPlanModal(pid,pname);}catch(e){toast(e.message,'err')}
}
async function editPlan(id,pid,pname){
 const plans=await API.get('/maintenance/plans'),p=plans.find(x=>Number(x.id)===Number(id));if(!p)return toast('Plano não encontrado','err');
 openModal(`✏️ Editar plano — ${p.task}`,`
   <div class="form-grid">
    <div class="form-group span2"><label>Tarefa *</label><input id="ep-task" value="${p.task||''}"></div>
    <div class="form-group"><label>Intervalo em horas</label><input type="number" id="ep-hours" value="${p.interval_hours??''}" min="0.1" step="0.1"></div>
    <div class="form-group"><label>Intervalo em dias</label><input type="number" id="ep-days" value="${p.interval_days??''}" min="1"></div>
    <div class="form-group"><label>Próxima data</label><input type="date" id="ep-date" value="${p.next_due_date||''}"></div>
    <div class="form-group"><label>Próximas horas</label><input type="number" id="ep-next" value="${p.next_due_hours??''}" min="0" step="0.1"></div>
    <div class="form-group span2"><label>Descrição / observações</label><textarea id="ep-notes">${p.notes||''}</textarea></div>
    <div class="form-group"><label>Ativo</label><select id="ep-active"><option value="true" ${p.active?'selected':''}>Sim</option><option value="false" ${!p.active?'selected':''}>Não</option></select></div>
   </div>`,
   `<button class="btn btn-secondary" onclick="openPlanModal(${pid},'${pname.replaceAll("'","\\'")}')">Cancelar</button><button class="btn btn-primary" onclick="updatePlan(${id},${pid},'${pname.replaceAll("'","\\'")}')">Salvar alterações</button>`,true);
}
async function updatePlan(id,pid,pname){
 const b={task:R('ep-task').value.trim(),interval_hours:R('ep-hours').value,interval_days:R('ep-days').value,next_due_date:R('ep-date').value,next_due_hours:R('ep-next').value,notes:R('ep-notes').value,active:R('ep-active').value==='true'};
 if(!b.task)return toast('Informe a tarefa','err');
 try{await API.put(`/maintenance/plans/${id}`,b);toast('Plano atualizado!');openPlanModal(pid,pname)}catch(e){toast(e.message,'err')}
}
async function deletePlan(id,pid,pname){
 if(!confirmAction('Desativar este plano preventivo?'))return;
 try{await API.del(`/maintenance/plans/${id}`);toast('Plano desativado!');openPlanModal(pid,pname)}catch(e){toast(e.message,'err')}
}

// Expor explicitamente as ações usadas pelos botões da tela.
window.openImpressoraModal = openImpressoraModal;
window.saveImpressora = saveImpressora;
window.deleteImpressora = deleteImpressora;
window.openManutencaoModal = openManutencaoModal;
window.openPlanModal = openPlanModal;
window.saveManutencao = saveManutencao;
window.savePlan = savePlan;
window.syncMaintenancePlanTask = syncMaintenancePlanTask;
window.editPlan = editPlan;
window.updatePlan = updatePlan;
window.deletePlan = deletePlan;window.applyMaintenancePreset=applyMaintenancePreset;
