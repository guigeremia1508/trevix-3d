let _producao = [], _impressorasProd = [], _rollsProd = [];

pageRenderers.producao = async function () {
  const user = JSON.parse(localStorage.getItem('g3d_user') || '{}');
  if (user.role === 'CLIENTE') {
    _producao = await API.get('/production');
    _impressorasProd = [];
    _rollsProd = [];
  } else {
    [_producao, _impressorasProd, _rollsProd] = await Promise.all([API.get('/production'), API.get('/printers'), API.get('/rolls')]);
  }
  renderProducao();
};

const prodStatuses = ['AGUARDANDO','PREPARANDO','IMPRIMINDO','ACABAMENTO','PRONTO','ENTREGUE','CANCELADO'];

function renderProducao() {
  R('content').innerHTML = `
    <div class="table-wrap">
      <div class="table-header">
        <span style="font-size:.85rem;color:var(--text2)">${_producao.length} ordem(ns)</span>
      </div>
      <table>
        <thead><tr><th>#</th><th>Pedido</th><th>Produto</th><th>Cliente</th><th>Impressora</th><th>Peso Real</th><th>Tempo Real</th><th>Resultado</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${_producao.length ? _producao.map(j => `
            <tr>
              <td>#${j.id}</td>
              <td>${j.order_id ? `#${j.order_id}` : '—'}</td>
              <td>${j.product_name || '—'}</td>
              <td>${j.customer_name || '—'}</td>
              <td>${j.printer_name || '—'}</td>
              <td>${num(j.real_weight_g,1)}g</td>
              <td>${num(j.real_time_min,0)}min</td>
              <td>${badge(j.result || '—')}</td>
              <td>${badge(j.status)}</td>
              <td>${JSON.parse(localStorage.getItem('g3d_user') || '{}').role !== 'CLIENTE' ? `<button class="btn btn-secondary btn-sm" onclick="openProdJobModal(${j.id})">✏️ Atualizar</button>` : '<span style="color:var(--text2)">Visualização</span>'}</td>
            </tr>`).join('') : '<tr><td colspan="10" style="text-align:center;color:var(--text2);padding:2rem">Nenhuma ordem de produção</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function openProdJobModal(id) {
  const j = _producao.find(x => Number(x.id) === Number(id)) || {};
  openModal(`Ordem de Produção #${id}`, `
    <div class="form-grid">
      <div class="form-group"><label>Impressora</label>
        <select id="pj-printer_id">
          <option value="">—</option>
          ${_impressorasProd.map(p => `<option value="${p.id}" ${j.printer_id==p.id?'selected':''}>${p.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Rolo de Filamento</label>
        <select id="pj-roll_id">
          <option value="">—</option>
          ${_rollsProd.map(r => `<option value="${r.id}" ${j.roll_id==r.id?'selected':''}>${r.type} ${r.color||''} — ${num(r.current_weight_g,0)}g</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Peso Estimado (g)</label><input type="number" id="pj-est_weight_g" value="${j.est_weight_g||0}" step="0.1"></div>
      <div class="form-group"><label>Peso Real (g)</label><input type="number" id="pj-real_weight_g" value="${j.real_weight_g||0}" step="0.1"></div>
      <div class="form-group"><label>Tempo Estimado (min)</label><input type="number" id="pj-est_time_min" value="${j.est_time_min||0}"></div>
      <div class="form-group"><label>Tempo Real (min)</label><input type="number" id="pj-real_time_min" value="${j.real_time_min||0}"></div>
      <div class="form-group"><label>Desperdício (g)</label><input type="number" id="pj-waste_g" value="${j.waste_g||0}" step="0.1"></div>
      <div class="form-group"><label>Status</label>
        <select id="pj-status">${prodStatuses.map(s => `<option value="${s}" ${j.status===s?'selected':''}>${s.replace(/_/g,' ')}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Resultado</label>
        <select id="pj-result">
          <option value="">—</option>
          <option value="SUCESSO" ${j.result==='SUCESSO'?'selected':''}>Sucesso</option>
          <option value="FALHA" ${j.result==='FALHA'?'selected':''}>Falha</option>
          <option value="CANCELADO" ${j.result==='CANCELADO'?'selected':''}>Cancelado</option>
        </select>
      </div>
      <div class="form-group"><label>Início</label><input type="datetime-local" id="pj-started_at" value="${j.started_at ? j.started_at.slice(0,16) : ''}"></div>
      <div class="form-group"><label>Fim</label><input type="datetime-local" id="pj-finished_at" value="${j.finished_at ? j.finished_at.slice(0,16) : ''}"></div>
      <div class="form-group"><label>Tipo de Falha</label><input id="pj-failure_type" value="${j.failure_type||''}"></div>
      <div class="form-group span2"><label>Causa da Falha</label><textarea id="pj-failure_cause">${j.failure_cause||''}</textarea></div>
      <div class="form-group span2"><label>Observações</label><textarea id="pj-notes">${j.notes||''}</textarea></div>
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
     <button class="btn btn-primary" onclick="saveProdJob(${id})">Salvar</button>`, true);
}

async function saveProdJob(id) {
  const body = {
    printer_id: R('pj-printer_id').value||null, roll_id: R('pj-roll_id').value||null,
    est_weight_g: R('pj-est_weight_g').value, real_weight_g: R('pj-real_weight_g').value,
    est_time_min: R('pj-est_time_min').value, real_time_min: R('pj-real_time_min').value,
    waste_g: R('pj-waste_g').value, status: R('pj-status').value, result: R('pj-result').value||null,
    started_at: R('pj-started_at').value||null, finished_at: R('pj-finished_at').value||null,
    failure_type: R('pj-failure_type').value, failure_cause: R('pj-failure_cause').value,
    notes: R('pj-notes').value
  };
  try {
    await API.put(`/production/${id}`, body);
    closeModal(); toast('Produção atualizada!'); pageRenderers.producao();
  } catch (e) { toast(e.message, 'err'); }
}

window.openProdJobModal=openProdJobModal;window.saveProdJob=saveProdJob;
