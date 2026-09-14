let _clientes = [];

pageRenderers.clientes = async function () {
  _clientes = await API.get('/customers');
  renderClientes();
};

function renderClientes(filter = '') {
  const list = filter ? _clientes.filter(c => c.name.toLowerCase().includes(filter) || (c.email||'').toLowerCase().includes(filter)) : _clientes;
  R('content').innerHTML = `
    <div class="table-wrap">
      <div class="table-header">
        <input class="search-input" placeholder="🔍 Buscar cliente..." oninput="renderClientes(this.value.toLowerCase())">
        <button class="btn btn-primary" onclick="openClienteModal()">+ Novo Cliente</button>
      </div>
      <table>
        <thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Cidade</th><th>Pedidos</th><th>Total Gasto</th><th></th></tr></thead>
        <tbody>
          ${list.length ? list.map(c => `
            <tr>
              <td><strong>${c.name}</strong></td>
              <td>${c.phone || '—'}</td>
              <td>${c.email || '—'}</td>
              <td>${c.city || '—'}</td>
              <td>${c.total_orders || 0}</td>
              <td>${money(c.total_spent)}</td>
              <td><div class="actions">
                <button class="btn btn-secondary btn-sm" onclick="openClienteModal(${c.id})">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="deleteCliente(${c.id})">🗑️</button>
              </div></td>
            </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:2rem">Nenhum cliente cadastrado</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function openClienteModal(id) {
  const c = id ? _clientes.find(x => Number(x.id) === Number(id)) : {};
  openModal(id ? 'Editar Cliente' : 'Novo Cliente', `
    <div class="form-grid">
      <div class="form-group span2"><label>Nome *</label><input id="cf-name" value="${c.name||''}"></div>
      <div class="form-group"><label>Telefone</label><input id="cf-phone" value="${c.phone||''}"></div>
      <div class="form-group"><label>E-mail</label><input id="cf-email" value="${c.email||''}"></div>
      <div class="form-group"><label>Cidade</label><input id="cf-city" value="${c.city||''}"></div>
      <div class="form-group span2"><label>Observações</label><textarea id="cf-notes">${c.notes||''}</textarea></div>
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
     <button class="btn btn-primary" onclick="saveCliente(${id||0})">Salvar</button>`);
}

async function saveCliente(id) {
  const body = { name: R('cf-name').value, phone: R('cf-phone').value, email: R('cf-email').value, city: R('cf-city').value, notes: R('cf-notes').value };
  if (!body.name) return toast('Nome é obrigatório', 'err');
  try {
    if (id) await API.put(`/customers/${id}`, body); else await API.post('/customers', body);
    closeModal(); toast('Salvo!'); pageRenderers.clientes();
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteCliente(id) {
  if (!confirmAction('Excluir este cliente?')) return;
  try { await API.del(`/customers/${id}`); toast('Excluído!'); pageRenderers.clientes(); } catch (e) { toast(e.message, 'err'); }
}

window.openClienteModal=openClienteModal;window.saveCliente=saveCliente;window.deleteCliente=deleteCliente;
