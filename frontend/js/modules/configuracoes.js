pageRenderers.configuracoes = async function () {
  const cfg = await API.get('/settings');
  const currentUser=JSON.parse(localStorage.getItem('g3d_user')||'{}');
  const backupBlock=currentUser.role==='ADMIN'?'<div class="table-wrap" style="padding:1.5rem;margin-top:1rem"><h3 style="margin-bottom:.5rem;font-size:.95rem">💾 Backup do sistema</h3><p style="color:var(--text2);font-size:.85rem;margin-bottom:1rem">Baixe uma cópia lógica do banco para guardar seus dados fora do Railway. A restauração substitui os dados atuais e deve ser usada somente com um arquivo confiável.</p><button class="btn btn-secondary" onclick="downloadBackup()">⬇️ Baixar backup</button><label class="btn btn-secondary" style="margin-left:.5rem;cursor:pointer">♻️ Restaurar backup<input id="backup-file" type="file" accept="application/json,.json" style="display:none" onchange="restoreBackup(this.files[0])"></label></div>':'<'+'div></div>';
  R('content').innerHTML = `
    <div style="max-width:700px">
      <div class="table-wrap" style="padding:1.5rem;margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;font-size:.95rem">🏢 Empresa</h3>
        <div class="form-grid">
          <div class="form-group span2"><label>Nome da Empresa</label><input id="cfg-company_name" value="${cfg.company_name||''}"></div>
        </div>
      </div>
      <div class="table-wrap" style="padding:1.5rem;margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;font-size:.95rem">💰 Custos Globais</h3>
        <div class="form-grid">
          <div class="form-group"><label>Mão de Obra (R$/h)</label><input type="number" id="cfg-labor_cost_hour" value="${cfg.labor_cost_hour||15}" step="0.01"></div>
          <div class="form-group"><label>Energia Elétrica (R$/kWh)</label><input type="number" id="cfg-energy_cost_kwh" value="${cfg.energy_cost_kwh||0.75}" step="0.01"></div>
          <div class="form-group"><label>Custo da Máquina (R$/h)</label><input type="number" id="cfg-machine_cost_hour" value="${cfg.machine_cost_hour||2.50}" step="0.01"></div>
          <div class="form-group"><label>Manutenção (R$/h)</label><input type="number" id="cfg-maintenance_cost_hour" value="${cfg.maintenance_cost_hour||0.50}" step="0.01"></div><div class="form-group"><label>Tempo padrão de desenvolvimento (min)</label><input type="number" id="cfg-default_development_time_min" value="${cfg.default_development_time_min||0}" step="1"></div><div class="form-group"><label>Markup padrão (%)</label><input type="number" id="cfg-default_markup_percent" value="${cfg.default_markup_percent||100}" step="1"></div><div class="form-group"><label>Embalagem padrão (R$)</label><input type="number" id="cfg-default_packaging_cost" value="${cfg.default_packaging_cost||0}" step="0.01"></div><div class="form-group"><label>Acabamento padrão (R$)</label><input type="number" id="cfg-default_finishing_cost" value="${cfg.default_finishing_cost||0}" step="0.01"></div>
        </div>
      </div>
      <div class="table-wrap" style="padding:1.5rem;margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;font-size:.95rem">🖨️ Impressora — ROI</h3>
        <div class="form-grid">
          <div class="form-group"><label>Investimento Total na Impressora (R$)</label><input type="number" id="cfg-printer_investment" value="${cfg.printer_investment||0}" step="0.01"></div>
          <div class="form-group"><label>Estoque Mínimo Padrão (g)</label><input type="number" id="cfg-default_min_stock_g" value="${cfg.default_min_stock_g||50}"></div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="saveConfigs()">💾 Salvar Configurações</button>
      <div class="table-wrap" style="padding:1.5rem;margin-top:1rem"><h3 style="margin-bottom:.8rem;font-size:.95rem">🔐 Segurança da conta</h3><div class="form-grid"><div class="form-group"><label>Senha atual</label><input id="pw-current" type="password" autocomplete="current-password"></div><div></div><div class="form-group"><label>Nova senha</label><input id="pw-new" type="password" minlength="8" autocomplete="new-password"></div><div class="form-group"><label>Confirmar nova senha</label><input id="pw-confirm" type="password" minlength="8" autocomplete="new-password"></div></div><button class="btn btn-secondary" onclick="changePassword()">Alterar senha</button><button class="btn btn-secondary" style="margin-left:.5rem" onclick="openSessionsModal()">📱 Minhas sessões</button></div>
      <button class="btn btn-secondary" style="margin-left:.5rem" onclick="openUsuariosModal()">👥 Gerenciar Usuários</button>
    ${backupBlock}</div>`;
};

async function saveConfigs() {
  const keys = ['company_name','labor_cost_hour','energy_cost_kwh','machine_cost_hour','maintenance_cost_hour','printer_investment','default_min_stock_g','default_development_time_min','default_markup_percent','default_packaging_cost','default_finishing_cost'];
  const body = {};
  keys.forEach(k => { const el = R(`cfg-${k}`); if (el) body[k] = el.value; });
  try { await API.post('/settings', body); toast('Configurações salvas!'); } catch (e) { toast(e.message, 'err'); }
}

// ─── USUÁRIOS ─────────────────────────────────────────
async function openUsuariosModal() {
  const [users, customers] = await Promise.all([API.get('/auth/users'), API.get('/customers')]);
  openModal('👥 Gerenciar Usuários', `
    <div class="form-grid" style="margin-bottom:1.5rem">
      <div class="form-group span2"><label>Nome *</label><input id="uf-name"></div>
      <div class="form-group"><label>E-mail *</label><input id="uf-email" type="email"></div>
      <div class="form-group"><label>Senha *</label><input id="uf-pass" type="password"></div>
      <div class="form-group"><label>Perfil</label><select id="uf-role" onchange="toggleCustomerSelect()"><option value="OPERADOR">Operador</option><option value="ADMIN">Admin</option><option value="CLIENTE">Cliente</option></select></div>
      <div class="form-group" id="uf-customer-wrap" style="display:none"><label>Cliente vinculado</label><select id="uf-customer_id"><option value="">Selecione...</option>${customers.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
    </div>
    <table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Cliente</th><th>Status</th><th></th></tr></thead>
    <tbody>${users.map(u => `<tr>
      <td>${u.name}</td><td>${u.email}</td>
      <td>${badge(u.role)}</td><td>${u.customer_name||'—'}</td>
      <td>${u.active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-gray">Inativo</span>'}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="editUser(${u.id})">✏️</button> <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">🗑️</button></td>
    </tr>`).join('')}</tbody></table>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Fechar</button>
     <button class="btn btn-primary" onclick="createUser()">+ Criar Usuário</button>`, true);
}

async function createUser() {
  const body = { name: R('uf-name').value, email: R('uf-email').value, password: R('uf-pass').value, role: R('uf-role').value, customer_id: R('uf-customer_id')?.value||null };
  if (!body.name || !body.email || !body.password) return toast('Preencha todos os campos', 'err');
  try { await API.post('/auth/users', body); toast('Usuário criado!'); openUsuariosModal(); } catch(e) { toast(e.message, 'err'); }
}

async function deleteUser(id) {
  if (!confirmAction('Desativar este usuário?')) return;
  try { await API.del(`/auth/users/${id}`); toast('Usuário removido!'); openUsuariosModal(); } catch(e) { toast(e.message, 'err'); }
}

async function editUser(id){const [users,customers]=await Promise.all([API.get('/auth/users'),API.get('/customers')]),u=users.find(x=>Number(x.id)===Number(id));if(!u)return toast('Usuário não encontrado','err');openModal('✏️ Editar usuário',`<div class="form-grid"><div class="form-group span2"><label>Nome</label><input id="eu-name" value="${u.name||''}"></div><div class="form-group span2"><label>E-mail</label><input id="eu-email" type="email" value="${u.email||''}"></div><div class="form-group"><label>Perfil</label><select id="eu-role"><option value="OPERADOR" ${u.role==='OPERADOR'?'selected':''}>Operador</option><option value="ADMIN" ${u.role==='ADMIN'?'selected':''}>Admin</option><option value="CLIENTE" ${u.role==='CLIENTE'?'selected':''}>Cliente</option></select></div><div class="form-group"><label>Cliente vinculado</label><select id="eu-customer_id"><option value="">—</option>${customers.map(c=>`<option value="${c.id}" ${Number(u.customer_id)===Number(c.id)?'selected':''}>${c.name}</option>`).join('')}</select></div><div class="form-group"><label>Ativo</label><select id="eu-active"><option value="1" ${u.active?'selected':''}>Sim</option><option value="0" ${!u.active?'selected':''}>Não</option></select></div></div>`,`<button class="btn btn-secondary" onclick="openUsuariosModal()">Cancelar</button><button class="btn btn-primary" onclick="updateUser(${id})">Salvar</button>`)}
async function updateUser(id){const body={name:R('eu-name').value,email:R('eu-email').value,role:R('eu-role').value,active:R('eu-active').value==='1',customer_id:R('eu-customer_id')?.value||null};try{await API.put(`/auth/users/${id}`,body);toast('Usuário atualizado!');openUsuariosModal()}catch(e){toast(e.message,'err')}}
async function downloadBackup(){try{const res=await fetch('/api/backup/export',{credentials:'same-origin'});if(res.status===401){doLogout();return;}if(!res.ok){const j=await res.json().catch(()=>({}));throw new Error(j.error||'Falha ao gerar backup')}const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`gestao3d-backup-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);toast('Backup baixado!')}catch(e){toast(e.message,'err')}}
async function restoreBackup(file){if(!file)return;if(!confirmAction('Atenção: restaurar este backup vai substituir os dados atuais. Continuar?')){R('backup-file').value='';return;}try{const fd=new FormData();fd.append('backup',file);const res=await fetch('/api/backup/restore',{method:'POST',headers:{'X-CSRF-Token':await API.ensureCsrf()},credentials:'same-origin',body:fd});if(res.status===401){doLogout();return;}const j=await res.json().catch(()=>({}));if(!res.ok)throw new Error(j.error||'Falha ao restaurar backup');toast('Backup restaurado. A página será recarregada.');setTimeout(()=>location.reload(),700)}catch(e){toast(e.message,'err');R('backup-file').value=''}}
window.downloadBackup=downloadBackup;window.restoreBackup=restoreBackup;window.editUser=editUser;window.updateUser=updateUser;
function toggleCustomerSelect(){const w=R('uf-customer-wrap');if(w)w.style.display=R('uf-role').value==='CLIENTE'?'':'none';}

async function changePassword(){const current=R('pw-current')?.value,newPass=R('pw-new')?.value,confirm=R('pw-confirm')?.value;if(!current||!newPass)return toast('Preencha a senha atual e a nova senha','err');if(newPass!==confirm)return toast('As novas senhas não coincidem','err');if(newPass.length<8)return toast('A nova senha precisa ter pelo menos 8 caracteres','err');try{await API.put('/auth/password',{current,newPass});toast('Senha alterada. Faça login novamente.');setTimeout(()=>doLogout(),700)}catch(e){toast(e.message,'err')}}
async function openSessionsModal(){try{const sessions=await API.get('/auth/sessions');openModal('📱 Minhas sessões',`<p style="color:var(--text2);font-size:.82rem;margin-bottom:1rem">Sessões armazenadas para sua conta. Revogue qualquer uma que não reconheça.</p><table><thead><tr><th>Criada</th><th>Expira</th><th>Status</th><th></th></tr></thead><tbody>${sessions.map(x=>`<tr><td>${dateStr(x.created_at)}</td><td>${dateStr(x.expires_at)}</td><td>${x.revoked_at?badge('CANCELADO'):badge('DISPONIVEL')}</td><td>${x.revoked_at?'':`<button class="btn btn-danger btn-sm" onclick="revokeSession(${x.id})">Revogar</button>`}</td></tr>`).join('')}</tbody></table>`,`<button class="btn btn-secondary" onclick="closeModal()">Fechar</button>`,true)}catch(e){toast(e.message,'err')}}
async function revokeSession(id){try{await API.del(`/auth/sessions/${id}`);toast('Sessão revogada.');openSessionsModal()}catch(e){toast(e.message,'err')}}
window.changePassword=changePassword;window.openSessionsModal=openSessionsModal;window.revokeSession=revokeSession;
