// ─── HELPERS ──────────────────────────────────────────────────────────────────
const R = (id) => document.getElementById(id);
const money = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const num = (v, d = 0) => Number(v || 0).toFixed(d);
const dateStr = (s) => s ? new Date(s).toLocaleDateString('pt-BR') : '—';
const esc = (v='') => String(v).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])).replace(/\"/g,'&quot;').replace(/'/g,'&#39;');
window.g3dEscape = esc;
const statusColors = {
  DISPONIVEL: 'green', IMPRIMINDO: 'blue', MANUTENCAO: 'yellow', OFFLINE: 'red',
  APROVADO: 'green', REPROVADO: 'red', CANCELADO: 'gray',
  EM_DESENVOLVIMENTO: 'blue', EM_TESTE: 'yellow', EM_PRODUCAO: 'purple', ARQUIVADO: 'gray',
  ORCAMENTO: 'gray', AGUARDANDO_PAGAMENTO: 'yellow', CONFIRMADO: 'blue',
  ACABAMENTO: 'purple', PRONTO: 'green', ENTREGUE: 'green',
  PENDENTE: 'yellow', PAGO: 'green', ATRASADO: 'red',
  AGUARDANDO: 'gray', PREPARANDO: 'yellow',
  SUCESSO: 'green', FALHA: 'red',
  ENTRADA: 'green', SAIDA: 'red', CONSUMO: 'yellow', DESPERDICIO: 'red', AJUSTE: 'blue', DEVOLUCAO: 'purple',
  COMERCIAL: 'blue', PESSOAL: 'purple', PROTOTIPO: 'yellow', ESCOLAR: 'green', ROBOTICA: 'purple', EXPERIMENTAL: 'gray',
};
const badge = (val) => {
  const c = statusColors[val] || 'gray';
  return `<span class="badge badge-${c}">${val?.replace(/_/g, ' ') || '—'}</span>`;
};

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:1.5rem;right:1.5rem;background:${type === 'ok' ? 'var(--green)' : 'var(--red)'};color:#fff;padding:.7rem 1.2rem;border-radius:8px;font-size:.88rem;z-index:9999;box-shadow:var(--shadow)`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function confirmAction(msg) { return window.confirm(msg); }

// ─── MODAL ────────────────────────────────────────────────────────────────────
function openModal(title, bodyHtml, footerHtml, lg = false) {
  closeModal();
  const previouslyFocused = document.activeElement;
  const el = document.createElement('div');
  el.className = 'modal-overlay';
  el.id = 'modal-overlay';
  el.innerHTML = `
    <div class="modal${lg ? ' lg' : ''}">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="btn btn-secondary btn-sm btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-footer">${footerHtml}</div>
    </div>`;
  document.body.appendChild(el);
  const focusTarget = el.querySelector('input,select,textarea,button');
  focusTarget?.focus();
  el.dataset.previousFocus = previouslyFocused && previouslyFocused.id ? previouslyFocused.id : '';
}
function closeModal() { const el=document.getElementById('modal-overlay'); if(!el)return; const prev=el.dataset.previousFocus ? document.getElementById(el.dataset.previousFocus) : null; el.remove(); prev?.focus(); }

// Login and registration are handled by frontend/js/auth.js.

async function doLogout() {
  try { if (API.csrfToken || document.cookie.includes('g3d_csrf=')) await API.post('/auth/logout'); } catch {}
  localStorage.removeItem('g3d_user'); API.csrfToken=null; closeSearch(); closeModal();
  R('app').style.display='none'; R('login-screen').style.display='flex'; window.showLogin?.();
}

document.addEventListener('keydown', e => { if(e.key==='Escape' && document.getElementById('modal-overlay')) closeModal(); });

async function refreshNotificationCount(){try{const rows=await API.get('/notifications');const b=R('notifications-count');if(!b)return;b.textContent=String(Math.min(99,rows.length));b.style.display=rows.length?'':'none';}catch{}}

function initTheme() {
  const saved = localStorage.getItem('g3d_theme');
  const theme = saved === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  updateThemeButton();
}

function updateThemeButton() {
  const light = document.documentElement.dataset.theme === 'light';
  const icon = R('theme-icon');
  const label = R('theme-label');
  if (icon) icon.textContent = light ? '🌙' : '☀️';
  if (label) label.textContent = light ? 'Escuro' : 'Claro';
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('g3d_theme', next);
  updateThemeButton();
}

function updateTopbarClock() {
  const now = new Date();
  const date = R('topbar-date');
  const time = R('topbar-time');
  if (date) date.textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (time) time.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if ([1,2,3].includes(code)) return '⛅';
  if ([45,48].includes(code)) return '🌫️';
  if ([51,53,55,56,57].includes(code)) return '🌦️';
  if ([61,63,65,66,67,80,81,82].includes(code)) return '🌧️';
  if ([71,73,75,77].includes(code)) return '❄️';
  if ([95,96,99].includes(code)) return '⛈️';
  return '🌤️';
}

window.g3dWeather = { status: 'loading', temperature: null, humidity: null, code: null, updatedAt: null, latitude: null, longitude: null };

async function updateWeather() {
  const text = R('weather-text');
  const icon = R('weather-icon');
  if (!text) return;
  try {
    window.g3dWeather.status = 'loading';
    if (!navigator.geolocation) throw new Error('Geolocalização indisponível');
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
    });
    const { latitude, longitude } = position.coords;
    window.g3dWeather.latitude = latitude;
    window.g3dWeather.longitude = longitude;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current=temperature_2m,relative_humidity_2m,weather_code&temperature_unit=celsius&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Falha na API meteorológica');
    const data = await res.json();
    const temp = data?.current?.temperature_2m;
    const humidity = data?.current?.relative_humidity_2m;
    if (temp == null || humidity == null) throw new Error('Dados meteorológicos incompletos');
    const code = data?.current?.weather_code;
    window.g3dWeather = { status: 'ok', temperature: Number(temp), humidity: Number(humidity), code, updatedAt: new Date(), latitude, longitude };
    text.textContent = `${Number(temp).toFixed(0)}°C • ${Number(humidity).toFixed(0)}% umid.`;
    if (icon) icon.textContent = weatherEmoji(code);
    window.dispatchEvent(new CustomEvent('g3d-weather-updated'));
  } catch {
    window.g3dWeather = { ...window.g3dWeather, status: 'error' };
    text.textContent = 'Clima indisponível';
    if (icon) icon.textContent = '🌡️';
    window.dispatchEvent(new CustomEvent('g3d-weather-updated'));
  }
}

function startApp(user) {
  R('login-screen').style.display = 'none';
  R('app').style.display = 'flex';
  R('user-name').textContent = user.name;
  const notif=R('notifications-button');const gs=document.querySelector('.global-search');if(user.role==='CLIENTE'){if(notif)notif.style.display='none';if(gs)gs.style.display='none';} else {if(notif)notif.style.display='';if(gs)gs.style.display='';}
  document.querySelectorAll('.nav-item').forEach(el => {
    const adminOnlyNav = el.classList.contains('admin-nav');
    const page = el.dataset.page;
    const restricted = ['configuracoes','auditoria'].includes(page);
    const clientAllowed = ['dashboard','pedidos','producao'].includes(page);
    if (user.role === 'CLIENTE') el.style.display = clientAllowed ? '' : 'none';
    else if (adminOnlyNav || restricted) el.style.display = user.role === 'ADMIN' ? '' : 'none';
  });
  initTheme();
  updateTopbarClock();
  clearInterval(window.g3dClockTimer);
  window.g3dClockTimer = setInterval(updateTopbarClock, 1000);
  updateWeather();
  refreshNotificationCount();
  clearInterval(window.g3dWeatherTimer);
  window.g3dWeatherTimer = setInterval(updateWeather, 10 * 60 * 1000);
  clearInterval(window.g3dNotificationTimer);
  window.g3dNotificationTimer = setInterval(refreshNotificationCount, 60 * 1000);
  navigate(user.role === 'CLIENTE' ? 'pedidos' : 'dashboard');
}

// Expose the entry point explicitly for the authentication module.
window.startApp = startApp;

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
const pageRenderers = window.pageRenderers || (window.pageRenderers = {});
let currentPage = '';

function showPageError(error) {
  const message = error?.message || 'Não foi possível carregar esta página.';
  R('content').innerHTML = `
    <div class="alert danger" style="margin:1rem 0">
      ⚠️ <strong>Erro ao carregar a página</strong><br>
      <span style="display:block;margin-top:.35rem">${message}</span>
      <button class="btn btn-secondary btn-sm" style="margin-top:.75rem" onclick="navigate(currentPage)">Tentar novamente</button>
    </div>`;
}

function navigate(page) {
  const storedUser = JSON.parse(localStorage.getItem('g3d_user') || '{}');
  if (storedUser.role === 'CLIENTE' && !['dashboard','pedidos','producao'].includes(page)) {
    page = 'pedidos';
  }
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  const titles = {
    dashboard: 'Dashboard', projetos: 'Projetos', testes: 'Testes de Impressão',
    produtos: 'Produtos', pedidos: 'Pedidos', orcamentos: 'Orçamentos', producao: 'Produção',
    impressoras: 'Impressoras', estoque: 'Filamentos', ferramentas: 'Ferramentas & Consumíveis', pecas: 'Parafusos & Peças', clientes: 'Clientes',
    financeiro: 'Financeiro', envios: 'Envios', relatorios: 'Relatórios', calculadora: 'Calculadora de Custos', auditoria: 'Auditoria', configuracoes: 'Configurações'
  };
  R('page-title').textContent = titles[page] || page;
  R('content').innerHTML = `<div style="color:var(--text2);padding:2rem;text-align:center">Carregando...</div>`;
  if (pageRenderers[page]) {
    Promise.resolve(pageRenderers[page]()).catch(showPageError);
  } else {
    showPageError(new Error(`Módulo "${esc(page)}" não foi carregado.`));
  }
  closeSidebar();
}

function toggleSidebar() {
  R('sidebar').classList.toggle('open');
  R('mobile-overlay').classList.toggle('open');
}
function closeSidebar() {
  R('sidebar').classList.remove('open');
  R('mobile-overlay').classList.remove('open');
}

let globalSearchTimer=null;
function closeSearch(){const box=R('global-search-results');if(box)box.innerHTML='';}
async function globalSearch(q){clearTimeout(globalSearchTimer);const box=R('global-search-results');if(!box)return;if(String(q||'').trim().length<2){box.innerHTML='';return;}globalSearchTimer=setTimeout(async()=>{try{const rows=await API.get('/search?q='+encodeURIComponent(q.trim()));box.innerHTML=rows.length?rows.map(x=>`<button class=\"search-result\" onclick=\"navigate('\${esc(x.route)}\');closeSearch();R('global-search').value=''\"><strong>${esc(x.kind)} · ${esc(x.title)}</strong><span>${esc(x.subtitle||'')}</span></button>`).join(''):'<div class=\"search-empty\">Nenhum resultado.</div>';}catch(e){box.innerHTML=`<div class=\"search-empty\">${esc(e.message)}</div>`}},180);}
async function openNotifications(){try{const rows=await API.get('/notifications');refreshNotificationCount();openModal('🔔 Notificações',rows.length?`<div class=\"alerts\">${rows.map(x=>`<div class=\"alert ${x.type.includes('ATRASADO')||x.type.includes('FALHOU')?'danger':'warn'}\"><strong>${esc(x.title)}</strong><span>${esc(x.detail||'')}</span></div>`).join('')}</div>`:'<div style=\"padding:1rem;color:var(--text2)\">Tudo em ordem. Milagre estatístico.</div>',`<button class=\"btn btn-secondary\" onclick=\"closeModal()\">Fechar</button>`,true);}catch(e){toast(e.message,'err')}}
window.globalSearch=globalSearch;window.closeSearch=closeSearch;window.openNotifications=openNotifications;
// Application boot is handled by frontend/js/bootstrap.js after all modules are loaded.

// Theme is also initialized before login so the preference is preserved.
initTheme();
updateTopbarClock();
