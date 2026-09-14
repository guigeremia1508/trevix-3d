let dashboardRange={start:'',end:''};
pageRenderers.dashboard = async function () {
  const query=(dashboardRange.start&&dashboardRange.end)?`?start=${encodeURIComponent(dashboardRange.start)}&end=${encodeURIComponent(dashboardRange.end)}`:'';
  const d = await API.get('/dashboard'+query);
  const alerts = [];
  if (d.low_stock > 0) alerts.push(`<div class="alert warn">⚠️ ${d.low_stock} rolo(s) com estoque baixo</div>`);
  if (d.late_orders > 0) alerts.push(`<div class="alert danger">🚨 ${d.late_orders} pedido(s) em atraso</div>`);
  if (d.late_payments > 0) alerts.push(`<div class="alert danger">💳 ${d.late_payments} pagamento(s) atrasado(s)</div>`);
  if (d.maint_needed > 0) alerts.push(`<div class="alert warn">🔧 ${d.maint_needed} manutenção(ões) preventiva(s) próxima(s) ou necessária(s)</div>`);

  const env = window.g3dWeather || {};
  const envContent = env.status === 'ok'
    ? `<div class="environment-main"><span class="environment-icon">${weatherEmoji(env.code)}</span><div><strong>${Number(env.temperature).toFixed(1)}°C</strong><span>${Number(env.humidity).toFixed(0)}% de umidade</span></div></div><div class="environment-meta">Atualizado às ${new Date(env.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}<br><span>Localização do navegador</span></div>`
    : `<div class="environment-main"><span class="environment-icon">🌡️</span><div><strong>Indisponível</strong><span>Permita a localização para consultar</span></div></div><div class="environment-meta"><button class="btn btn-secondary btn-sm" onclick="updateWeather()">Atualizar clima</button></div>`;

  R('content').innerHTML = `
    <div class="table-wrap" style="margin-bottom:1rem;padding:.75rem 1rem">
      <div style="display:flex;align-items:flex-end;gap:.75rem;flex-wrap:wrap">
        <div class="form-group" style="min-width:170px"><label>Período inicial</label><input id="dash-start" type="date" value="${dashboardRange.start||''}"></div>
        <div class="form-group" style="min-width:170px"><label>Período final</label><input id="dash-end" type="date" value="${dashboardRange.end||''}"></div>
        <button class="btn btn-primary" onclick="applyDashboardRange()">Aplicar período</button>
        <button class="btn btn-secondary" onclick="clearDashboardRange()">Últimos 30 dias</button>
      </div>
    </div>
    ${alerts.length ? `<div class="alerts">${alerts.join('')}</div>` : ''}
    <div class="cards-grid">
      <div class="stat-card green"><div class="label">Receitas</div><div class="value">${money(d.revenue)}</div><div class="sub">no período</div></div>
      <div class="stat-card red"><div class="label">Despesas</div><div class="value">${money(d.expenses)}</div><div class="sub">no período</div></div>
      <div class="stat-card ${d.profit >= 0 ? 'green' : 'red'}"><div class="label">Lucro</div><div class="value">${money(d.profit)}</div><div class="sub">no período</div></div>
      <div class="stat-card blue"><div class="label">Pedidos Ativos</div><div class="value">${d.active_orders}</div><div class="sub">${d.in_production} em produção</div></div>
      <div class="stat-card yellow"><div class="label">Horas de Impressão</div><div class="value">${d.print_hours}h</div><div class="sub">${d.filament_used}g de filamento</div></div>
      <div class="stat-card purple"><div class="label">Taxa de Sucesso</div><div class="value">${d.success_rate}%</div><div class="sub">nas impressões</div></div>
      <div class="stat-card ${d.roi >= 100 ? 'green' : 'blue'}"><div class="label">ROI da Impressora</div><div class="value">${d.roi}%</div><div class="sub">${d.roi >= 100 ? '✅ Recuperado!' : 'recuperado'}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:1rem">
      <div class="table-header"><strong>🔧 Manutenções preventivas</strong><span style="color:var(--text2);font-size:.82rem">${d.maint_needed||0} alerta(s)</span></div>
      <div style="padding:1rem">
        ${d.maintenance?.length ? d.maintenance.map(m => {
          const danger=m.status==='ATRASADA', soon=m.status==='PROXIMA';
          const label=danger?'🔴 MANUTENÇÃO NECESSÁRIA':soon?'🟡 Próxima':'🟢 Em dia';
          const detail=m.hours_remaining!=null ? (danger?'Atrasada':`faltam ${num(m.hours_remaining,1)}h`) : (danger?'Data vencida':`até ${dateStr(m.next_due_date)}`);
          return `<div style="display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:.7rem 0;border-bottom:1px solid var(--border)">
            <div><strong>${m.printer_name}</strong><br><span style="color:var(--text2);font-size:.82rem">${m.task}</span></div>
            <div style="text-align:right;font-size:.82rem">${label}<br><span style="color:var(--text2)">${detail}</span></div>
          </div>`;
        }).join('') : '<div style="color:var(--text2);padding:.5rem 0">Nenhuma manutenção preventiva próxima.</div>'}
      </div>
    </div>
    <div class="row dashboard-lower">
      <div class="col">
        <div class="table-wrap environment-card">
          <div class="table-header"><strong>🌡️ Condições do ambiente</strong><button class="btn btn-secondary btn-sm" onclick="updateWeather()">↻ Atualizar</button></div>
          <div class="environment-body">${envContent}</div>
        </div>
      </div>
      <div class="col">
        <div class="table-wrap quick-card">
          <div class="table-header"><strong>💡 Boas práticas</strong></div>
          <div class="quick-list">
            <div>• Registre o peso real ao finalizar uma impressão.</div>
            <div>• Use o histórico de movimentações para conferir o estoque.</div>
            <div>• Acompanhe falhas para descobrir quais configurações funcionam melhor.</div>
            <div>• Mantenha os arquivos das versões aprovadas preservados.</div>
          </div>
        </div>
      </div>
    </div>
    <p style="color:var(--text2);font-size:.8rem;margin-top:1rem">Receitas, despesas, horas, filamento e taxa de sucesso de impressões seguem o período selecionado. Pedidos ativos e alertas representam o estado atual da operação.</p>
  `;
};

if (!window.g3dDashboardWeatherListener) {
  window.g3dDashboardWeatherListener = true;
  window.addEventListener('g3d-weather-updated', () => {
    if (currentPage === 'dashboard') pageRenderers.dashboard().catch(showPageError);
  });
}

function applyDashboardRange(){const start=R('dash-start')?.value||'',end=R('dash-end')?.value||'';if(start&&end&&start>end)return toast('O período inicial não pode ser maior que o final','err');dashboardRange={start,end};pageRenderers.dashboard().catch(showPageError)}
function clearDashboardRange(){dashboardRange={start:'',end:''};pageRenderers.dashboard().catch(showPageError)}
window.applyDashboardRange=applyDashboardRange;window.clearDashboardRange=clearDashboardRange;
