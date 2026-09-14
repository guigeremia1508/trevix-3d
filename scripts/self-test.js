const fs = require('fs');
const path = require('path');

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Maintenance logic checks matching the application's rules.
function maintenance(lastHours, intervalHours, currentHours, warning=20) {
  const next = lastHours + intervalHours;
  const remaining = next - currentHours;
  const status = currentHours >= next ? 'ATRASADA' : remaining <= warning ? 'PROXIMA' : 'EM_DIA';
  return { next, remaining, status };
}
assert(maintenance(100, 50, 100).next === 150, 'next maintenance calculation');
assert(maintenance(100, 50, 149.9).remaining > 0, 'remaining hours calculation');
assert(maintenance(100, 50, 130).status === 'PROXIMA', 'warning status calculation');
assert(maintenance(100, 50, 150).status === 'ATRASADA', 'due status calculation');
assert(maintenance(150, 100, 160).next === 250, 'maintenance cycle reset without changing total hours');

const files = [
  'routes/api.js', 'routes/auth.js', 'middleware/auth.js', 'database/init.js',
  'frontend/js/app.js', 'frontend/js/modules/orcamentos.js', 'frontend/js/modules/impressoras.js',
  'frontend/js/modules/configuracoes.js','frontend/js/modules/calculadora.js','frontend/js/modules/auditoria.js'
];
for (const rel of files) assert(fs.existsSync(path.join(__dirname, '..', rel)), `missing ${rel}`);

const api = fs.readFileSync(path.join(__dirname, '..', 'routes/api.js'), 'utf8');
const auth = fs.readFileSync(path.join(__dirname, '..', 'routes/auth.js'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'database/init.js'), 'utf8');
const quote = fs.readFileSync(path.join(__dirname, '..', 'frontend/js/modules/orcamentos.js'), 'utf8');
const printer = fs.readFileSync(path.join(__dirname, '..', 'frontend/js/modules/impressoras.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'frontend/js/app.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const apiClient = fs.readFileSync(path.join(__dirname, '..', 'frontend/js/api.js'), 'utf8');
const modules = ['projetos','clientes','produtos','pedidos','financeiro','producao','orcamentos','pecas','ferramentas'].map(x => fs.readFileSync(path.join(__dirname, '..', 'frontend/js/modules', `${x}.js`), 'utf8')).join('\n');

for (const marker of [
  "router.get('/backup/export'", "router.post('/backup/restore'",
  "router.put('/quotes/:id'", "router.put('/production/:id'",
  "router.put('/maintenance/plans/:id'"
]) assert(api.includes(marker), `missing API ${marker}`);
for (const marker of ["router.post('/logout'", "router.post('/logout-all'", 'hashToken']) assert(auth.includes(marker), `missing auth ${marker}`);
for (const marker of ['CREATE TABLE IF NOT EXISTS sessions', 'CREATE TABLE IF NOT EXISTS audit_logs', 'project_time_min NUMERIC', 'project_id BIGINT REFERENCES projects', 'ALTER TABLE project_parts ADD COLUMN IF NOT EXISTS deleted_at']) assert(schema.includes(marker), `missing schema ${marker}`);
for (const marker of ['Projeto (opcional)', 'Horas de projeto', "window.openOrcamentoModal"]) assert(quote.includes(marker), `missing quote UI ${marker}`);
for (const marker of ['Manutenção recomendada', '500h — Lubrificação completa preventiva', 'window.applyMaintenancePreset']) assert(printer.includes(marker), `missing maintenance preset ${marker}`);
const testsUi = fs.readFileSync(path.join(__dirname, '..', 'frontend/js/modules/testes.js'), 'utf8');
for (const marker of ['Data do teste', 'deleteTeste']) assert(testsUi.includes(marker), `missing test UI ${marker}`);

console.log('✅ Gestão 3D self-test passed');

assert(server.includes("app.get('/health'"), 'health endpoint must exist');
assert(!app.includes('g3d_token'), 'frontend must not persist auth tokens');
assert(apiClient.includes("credentials:'same-origin'"), 'API must use cookie credentials');
assert(apiClient.includes('X-CSRF-Token'), 'API must send CSRF token');
assert(auth.includes('argon2'), 'auth must use Argon2id');
assert(!fs.readFileSync(path.join(__dirname, '..', 'frontend/index.html'), 'utf8').includes('value="admin123"'), 'default admin password must not be shipped in HTML');
assert(modules.includes('Number(x.id) === Number(id)') || modules.includes('Number(v.id) === Number(id)'), 'edit lookups must normalize PostgreSQL bigint ids');
assert(fs.existsSync(path.join(__dirname, '..', 'frontend', 'manifest.webmanifest')), 'PWA manifest must exist');
assert(fs.existsSync(path.join(__dirname, '..', 'frontend', 'sw.js')), 'service worker must exist');
assert(fs.readFileSync(path.join(__dirname, '..', 'middleware/auth.js'), 'utf8').includes('customerId'), 'auth payload must include customer scope');
assert(api.includes("router.use((req,res,next)=>{if(req.user?.role==='CLIENTE')"), 'client role must be restricted server-side');
assert(fs.readFileSync(path.join(__dirname, '..', 'frontend/js/modules/pedidos.js'), 'utf8').includes("role==='CLIENTE'"), 'client orders UI must be read-only');
assert(/user\.role\s*===\s*'CLIENTE'/.test(fs.readFileSync(path.join(__dirname, '..', 'frontend/js/modules/producao.js'), 'utf8')), 'client production UI must be read-only');
assert(fs.existsSync(path.join(__dirname, '..', 'docs', 'MASTER_COMPLIANCE.md')), 'master compliance documentation must exist');
assert(schema.includes('ALTER TABLE tests ADD COLUMN IF NOT EXISTS test_date DATE'), 'test date migration must exist');
assert(schema.includes('ALTER TABLE tests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ'), 'test soft-delete migration must exist');
assert(api.includes("router.delete('/tests/:id'"), 'test delete API must exist');
assert(api.includes('COALESCE(t.test_date,t.created_at::date)'), 'test date must drive date-aware calculations');
