let _projetos = [], _clientesP = [];

pageRenderers.projetos = async function () {
  [_projetos, _clientesP] = await Promise.all([API.get('/projects'), API.get('/customers')]);
  renderProjetos();
};

function renderProjetos(filter = '') {
  const list = filter ? _projetos.filter(p => p.name.toLowerCase().includes(filter)) : _projetos;
  R('content').innerHTML = `
    <div class="table-wrap">
      <div class="table-header">
        <input class="search-input" placeholder="🔍 Buscar projeto..." oninput="renderProjetos(this.value.toLowerCase())">
        <button class="btn btn-primary" onclick="openProjetoModal()">+ Novo Projeto</button>
      </div>
      <table>
        <thead><tr><th>Nome</th><th>Tipo</th><th>Status</th><th>Cliente</th><th>Versões</th><th>Testes</th><th>Responsável</th><th></th></tr></thead>
        <tbody>
          ${list.length ? list.map(p => `
            <tr>
              <td><strong>${p.name}</strong>${p.description ? `<br><span style="font-size:.78rem;color:var(--text2)">${p.description.slice(0,60)}</span>` : ''}</td>
              <td>${badge(p.type)}</td>
              <td>${badge(p.status)}</td>
              <td>${p.customer_name || '—'}</td>
              <td>${p.versions_count || 0}</td>
              <td>${p.tests_count || 0}</td>
              <td>${p.responsible || '—'}</td>
              <td><div class="actions">
                <button class="btn btn-secondary btn-sm" onclick="openVersoesModal(${p.id},'${p.name}')">📋 Versões</button><button class="btn btn-secondary btn-sm" onclick="openProjetoPecasModal(${p.id},'${p.name}')">🔩 Peças</button>
                <button class="btn btn-secondary btn-sm" onclick="openProjetoModal(${p.id})">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="deleteProjeto(${p.id})">🗑️</button>
              </div></td>
            </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:2rem">Nenhum projeto cadastrado</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function openProjetoModal(id) {
  const p = id ? _projetos.find(x => Number(x.id) === Number(id)) : {};
  const tipos = ['COMERCIAL','PESSOAL','PROTOTIPO','ESCOLAR','ROBOTICA','EXPERIMENTAL'];
  const statuses = ['EM_DESENVOLVIMENTO','EM_TESTE','APROVADO','EM_PRODUCAO','ARQUIVADO'];
  openModal(id ? 'Editar Projeto' : 'Novo Projeto', `
    <div class="form-grid">
      <div class="form-group span2"><label>Nome *</label><input id="pj-name" value="${p.name||''}"></div>
      <div class="form-group"><label>Tipo</label>
        <select id="pj-type">${tipos.map(t => `<option value="${t}" ${p.type===t?'selected':''}>${t.replace('_',' ')}</option>`).join('')}</select>
      </div>
      ${id ? `<div class="form-group"><label>Status</label>
        <select id="pj-status">${statuses.map(s => `<option value="${s}" ${p.status===s?'selected':''}>${s.replace(/_/g,' ')}</option>`).join('')}</select>
      </div>` : '<div></div>'}
      <div class="form-group"><label>Responsável</label><input id="pj-responsible" value="${p.responsible||''}"></div>
      <div class="form-group"><label>Cliente</label>
        <select id="pj-customer_id">
          <option value="">Sem cliente</option>
          ${_clientesP.map(c => `<option value="${c.id}" ${p.customer_id==c.id?'selected':''}>${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group span2"><label>Descrição</label><textarea id="pj-description">${p.description||''}</textarea></div>
      <div class="form-group span2"><label>Observações</label><textarea id="pj-notes">${p.notes||''}</textarea></div>
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
     <button class="btn btn-primary" onclick="saveProjeto(${id||0})">Salvar</button>`);
}

async function saveProjeto(id) {
  const body = { name: R('pj-name').value, type: R('pj-type').value, responsible: R('pj-responsible').value, customer_id: R('pj-customer_id').value||null, description: R('pj-description').value, notes: R('pj-notes').value };
  if (id) body.status = R('pj-status').value;
  if (!body.name) return toast('Nome é obrigatório', 'err');
  try {
    if (id) await API.put(`/projects/${id}`, body); else await API.post('/projects', body);
    closeModal(); toast('Salvo!'); pageRenderers.projetos();
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteProjeto(id) {
  if (!confirmAction('Arquivar este projeto?')) return;
  try { await API.del(`/projects/${id}`); toast('Excluído!'); pageRenderers.projetos(); } catch (e) { toast(e.message, 'err'); }
}

async function openVersoesModal(pid, pname) {
  const vers = await API.get(`/projects/${pid}/versions`);
  openModal(`📋 Versões — ${pname}`, `
    <div class="form-grid" style="margin-bottom:1.5rem">
      <div class="form-group"><label>Versão * (ex: V1, V2)</label><input id="vf-version"></div>
      <div class="form-group"><label>Arquivo</label><input id="vf-filename" placeholder="Nome do arquivo se ainda estiver local"></div>
      <div class="form-group"><label>Arquivo 3D (opcional)</label><input id="vf-file" type="file" accept=".stl,.3mf,.step,.stp,.gcode,.obj"></div>
      <div class="form-group"><label>Autor</label><input id="vf-author"></div>
      <div class="form-group"><label>Resultado</label>
        <select id="vf-result"><option value="">—</option><option value="APROVADO">Aprovado</option><option value="REPROVADO">Reprovado</option></select>
      </div>
      <div class="form-group span2"><label>O que mudou</label><textarea id="vf-changes"></textarea></div>
      <div class="form-group span2"><label>Por que mudou</label><textarea id="vf-reason"></textarea></div>
    </div>
    <h4 style="margin-bottom:.75rem;font-size:.9rem">Histórico de Versões</h4>
    <table><thead><tr><th>Versão</th><th>Autor</th><th>Data</th><th>Resultado</th><th>O que mudou</th></tr></thead>
    <tbody>${vers.length ? vers.map(v => `<tr><td>${v.version}</td><td>${v.author||'—'}</td><td>${dateStr(v.created_at)}</td><td>${badge(v.result||'—')}</td><td>${v.changes||'—'}${v.file_storage_key?`<br><button class="btn btn-secondary btn-sm" onclick="downloadVersionFile(${pid},${v.id})">📎 ${v.filename||'Arquivo'}</button>`:'<br><small style="color:var(--text2)">Sem arquivo 3D</small>'}</td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text2)">Sem versões</td></tr>'}</tbody></table>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Fechar</button>
     <button class="btn btn-primary" onclick="saveVersao(${pid})">Adicionar Versão</button>`, true);
}

async function saveVersao(pid) {
  const pname=(document.querySelector('#modal-overlay .modal-header h3')?.textContent||'').replace('📋 Versões — ','').trim(); const body = { version: R('vf-version').value, filename: R('vf-filename').value, author: R('vf-author').value, result: R('vf-result').value, changes: R('vf-changes').value, reason: R('vf-reason').value };
  if (!body.version) return toast('Versão é obrigatória', 'err');
  try { const created=await API.post(`/projects/${pid}/versions`, body); const file=R('vf-file')?.files?.[0]; if(file) await API.uploadProjectFile(pid,created.id,file); toast(file?'Versão e arquivo adicionados!':'Versão adicionada!'); openVersoesModal(pid, pname); } catch (e) { toast(e.message, 'err'); }
}

async function openProjetoPecasModal(pid,pname){
 const [parts,current]=await Promise.all([API.get('/parts'),API.get(`/projects/${pid}/parts`)]);
 openModal(`🔩 Peças do projeto — ${pname}`,`
  <div class="form-grid" style="margin-bottom:1rem"><div class="form-group"><label>Peça *</label><select id="pp-part"><option value="">Selecione...</option>${parts.map(x=>`<option value="${x.id}">${x.name}${x.type?' — '+x.type:''}${x.size?' — '+x.size:''} (estoque ${num(x.current_qty,2)})</option>`).join('')}</select></div><div class="form-group"><label>Quantidade *</label><input type="number" id="pp-qty" value="1" min="0.01" step="0.01"></div></div>
  <div class="alert warn" style="margin-bottom:1rem">Ao adicionar, a quantidade é baixada do estoque imediatamente e o custo da peça fica registrado no projeto.</div>
  <table><thead><tr><th>Peça</th><th>Qtd.</th><th>Custo/un</th><th>Total</th><th></th></tr></thead><tbody>${current.length?current.map(x=>`<tr><td>${x.name}<br><small>${x.type||''} ${x.size||''}</small></td><td>${num(x.quantity,2)}</td><td>${money(x.unit_cost)}</td><td>${money(x.total_cost)}</td><td><button class="btn btn-danger btn-sm" onclick="removeProjetoPeca(${pid},${x.id},'${pname.replaceAll("'","\\'")}')">↩️</button></td></tr>`).join(''):'<tr><td colspan="5" style="color:var(--text2);text-align:center">Nenhuma peça vinculada.</td></tr>'}</tbody></table>`,
 `<button class="btn btn-secondary" onclick="closeModal()">Fechar</button><button class="btn btn-primary" onclick="addProjetoPeca(${pid},'${pname.replaceAll("'","\\'")}')">+ Adicionar</button>`,true)
}
async function addProjetoPeca(pid,pname){const b={part_id:R('pp-part').value,quantity:R('pp-qty').value};if(!b.part_id)return toast('Selecione uma peça','err');try{await API.post(`/projects/${pid}/parts`,b);toast('Peça adicionada e estoque baixado!');openProjetoPecasModal(pid,pname); }catch(e){toast(e.message,'err')}}
async function removeProjetoPeca(pid,id,pname){if(!confirmAction('Remover a peça e devolver ao estoque?'))return;try{await API.del(`/projects/${pid}/parts/${id}`);toast('Peça devolvida ao estoque');openProjetoPecasModal(pid,pname)}catch(e){toast(e.message,'err')}}

async function downloadVersionFile(pid,vid){try{window.open(`/api/projects/${pid}/versions/${vid}/file`,'_blank','noopener');}catch(e){toast(e.message,'err')}}
window.downloadVersionFile=downloadVersionFile;
window.openProjetoModal=openProjetoModal;window.saveProjeto=saveProjeto;window.deleteProjeto=deleteProjeto;window.openVersoesModal=openVersoesModal;window.saveVersao=saveVersao;window.openProjetoPecasModal=openProjetoPecasModal;window.addProjetoPeca=addProjetoPeca;window.removeProjetoPeca=removeProjetoPeca;
