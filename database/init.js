const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const argon2 = require('argon2');

let pool;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não configurada. No Railway, adicione o PostgreSQL ao projeto e exponha DATABASE_URL.');
  }
  pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' || process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
  });
  pool.on('error', err => console.error('PostgreSQL pool error:', err));
  return pool;
}

async function dbAll(sql, params = []) {
  const r = await getPool().query(sql, params);
  return r.rows;
}

async function dbGet(sql, params = []) {
  const r = await getPool().query(sql, params);
  return r.rows[0];
}

async function dbRun(sql, params = []) {
  const r = await getPool().query(sql, params);
  return { rowCount: r.rowCount, rows: r.rows, lastInsertRowid: r.rows[0]?.id ?? null };
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const tx = {
      query: (sql, params = []) => client.query(sql, params),
      all: async (sql, params = []) => (await client.query(sql, params)).rows,
      get: async (sql, params = []) => (await client.query(sql, params)).rows[0],
      run: async (sql, params = []) => {
        const r = await client.query(sql, params);
        return { rowCount: r.rowCount, rows: r.rows, lastInsertRowid: r.rows[0]?.id ?? null };
      },
    };
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'OPERADOR', active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, city TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS printers (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, brand TEXT, model TEXT, serial TEXT, purchase_date DATE,
  purchase_price NUMERIC(14,2) DEFAULT 0, location TEXT, power_watts NUMERIC(10,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DISPONIVEL', total_hours NUMERIC(14,2) DEFAULT 0, total_prints INTEGER DEFAULT 0,
  total_failures INTEGER DEFAULT 0, filament_used_g NUMERIC(14,2) DEFAULT 0, notes TEXT,
  photo_url TEXT, cloudinary_public_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS maintenance_plans (
  id BIGSERIAL PRIMARY KEY, printer_id BIGINT NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  task TEXT NOT NULL, interval_hours NUMERIC(14,2), interval_days INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE, last_completed_at DATE, last_completed_hours NUMERIC(14,2) DEFAULT 0,
  next_due_date DATE, next_due_hours NUMERIC(14,2), notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS printer_maintenance (
  id BIGSERIAL PRIMARY KEY, printer_id BIGINT NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  plan_id BIGINT REFERENCES maintenance_plans(id) ON DELETE SET NULL, task TEXT NOT NULL,
  scheduled_at DATE, done_at DATE, hours_at NUMERIC(14,2), cost NUMERIC(14,2) DEFAULT 0,
  parts_used TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS materials (
  id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL, brand TEXT, color TEXT, color_code TEXT,
  diameter NUMERIC(5,2) DEFAULT 1.75, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS material_rolls (
  id BIGSERIAL PRIMARY KEY, material_id BIGINT NOT NULL REFERENCES materials(id), code TEXT,
  initial_weight_g NUMERIC(14,2) NOT NULL, current_weight_g NUMERIC(14,2) NOT NULL,
  purchase_price NUMERIC(14,2) DEFAULT 0, cost_per_gram NUMERIC(14,6) DEFAULT 0, supplier TEXT,
  purchase_date DATE, status TEXT DEFAULT 'DISPONIVEL', min_stock_g NUMERIC(14,2) DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGSERIAL PRIMARY KEY, roll_id BIGINT REFERENCES material_rolls(id) ON DELETE SET NULL,
  type TEXT NOT NULL, reason TEXT NOT NULL, quantity_g NUMERIC(14,2) NOT NULL,
  reference_id BIGINT, reference_type TEXT, notes TEXT, created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS tool_consumables (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT, unit TEXT NOT NULL DEFAULT 'un',
  current_qty NUMERIC(14,3) NOT NULL DEFAULT 0, min_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0, supplier TEXT, notes TEXT,
  photo_url TEXT, cloudinary_public_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS small_parts (
  id BIGSERIAL PRIMARY KEY, category TEXT, name TEXT NOT NULL, type TEXT, size TEXT, material TEXT,
  current_qty NUMERIC(14,3) NOT NULL DEFAULT 0, min_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0, supplier TEXT, notes TEXT,
  photo_url TEXT, cloudinary_public_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS consumable_movements (
  id BIGSERIAL PRIMARY KEY, consumable_id BIGINT NOT NULL REFERENCES tool_consumables(id) ON DELETE CASCADE,
  type TEXT NOT NULL, quantity NUMERIC(14,3) NOT NULL, reason TEXT NOT NULL,
  reference_id BIGINT, reference_type TEXT, notes TEXT, created_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS part_movements (
  id BIGSERIAL PRIMARY KEY, part_id BIGINT NOT NULL REFERENCES small_parts(id) ON DELETE CASCADE,
  type TEXT NOT NULL, quantity NUMERIC(14,3) NOT NULL, reason TEXT NOT NULL,
  reference_id BIGINT, reference_type TEXT, notes TEXT, created_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS projects (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, type TEXT NOT NULL DEFAULT 'COMERCIAL',
  status TEXT NOT NULL DEFAULT 'EM_DESENVOLVIMENTO', responsible TEXT, customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS project_versions (
  id BIGSERIAL PRIMARY KEY, project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version TEXT NOT NULL, filename TEXT, changes TEXT, reason TEXT, result TEXT, author TEXT,
  file_storage_key TEXT, file_size BIGINT, file_mime TEXT, file_hash TEXT, file_storage_provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_parts (
  id BIGSERIAL PRIMARY KEY, project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ,
  part_id BIGINT NOT NULL REFERENCES small_parts(id), quantity NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0, total_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, entity TEXT NOT NULL, entity_id BIGINT, ip INET,
  result TEXT NOT NULL DEFAULT 'SUCCESS', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE TABLE IF NOT EXISTS tests (
  id BIGSERIAL PRIMARY KEY, project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL, customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  name TEXT, source_key TEXT, version_id BIGINT REFERENCES project_versions(id),
  printer_id BIGINT REFERENCES printers(id), roll_id BIGINT REFERENCES material_rolls(id), est_time_min NUMERIC(14,2), real_time_min NUMERIC(14,2),
  est_weight_g NUMERIC(14,2), real_weight_g NUMERIC(14,2), waste_g NUMERIC(14,2) DEFAULT 0, temp_nozzle NUMERIC(8,2), temp_bed NUMERIC(8,2),
  layer_height NUMERIC(8,3), infill INTEGER, walls INTEGER, speed NUMERIC(8,2), supports BOOLEAN DEFAULT FALSE,
  result TEXT, failure_type TEXT, failure_cause TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  version_id BIGINT REFERENCES project_versions(id) ON DELETE SET NULL, material_type TEXT, weight_g NUMERIC(14,2) DEFAULT 0,
  print_time_min NUMERIC(14,2) DEFAULT 0, cost_material NUMERIC(14,2) DEFAULT 0, cost_energy NUMERIC(14,2) DEFAULT 0,
  cost_machine NUMERIC(14,2) DEFAULT 0, cost_labor NUMERIC(14,2) DEFAULT 0, cost_packaging NUMERIC(14,2) DEFAULT 0,
  cost_finishing NUMERIC(14,2) DEFAULT 0, cost_parts NUMERIC(14,2) DEFAULT 0, cost_project_parts NUMERIC(14,2) DEFAULT 0, cost_maintenance NUMERIC(14,2) DEFAULT 0, cost_total NUMERIC(14,2) DEFAULT 0,
  price NUMERIC(14,2) DEFAULT 0, markup NUMERIC(14,2) DEFAULT 0, margin NUMERIC(14,2) DEFAULT 0,
  printer_id BIGINT REFERENCES printers(id) ON DELETE SET NULL, material_roll_id BIGINT REFERENCES material_rolls(id) ON DELETE SET NULL,
  development_time_min NUMERIC(14,2) DEFAULT 0, costs_manual BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS product_components (
  id BIGSERIAL PRIMARY KEY, product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  part_id BIGINT REFERENCES small_parts(id) ON DELETE RESTRICT, consumable_id BIGINT REFERENCES tool_consumables(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL, unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0, total_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_component_one_source CHECK (((part_id IS NOT NULL)::int + (consumable_id IS NOT NULL)::int) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_components_product_part ON product_components(product_id,part_id) WHERE part_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_components_product_consumable ON product_components(product_id,consumable_id) WHERE consumable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_components_product ON product_components(product_id);
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY, customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL, product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  quantity INTEGER DEFAULT 1, material TEXT, roll_id BIGINT REFERENCES material_rolls(id) ON DELETE SET NULL, unit_price NUMERIC(14,2) DEFAULT 0, discount NUMERIC(14,2) DEFAULT 0, freight NUMERIC(14,2), total NUMERIC(14,2) DEFAULT 0,
  payment_method TEXT, due_date DATE, notes TEXT, status TEXT NOT NULL DEFAULT 'ORCAMENTO', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS shipments (
  id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT, customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  street TEXT, number TEXT, complement TEXT, neighborhood TEXT, city TEXT, state TEXT, postal_code TEXT,
  shipping_method TEXT NOT NULL DEFAULT 'Outro', freight NUMERIC(14,2), estimated_delivery DATE, delivered_at DATE, status TEXT NOT NULL DEFAULT 'PENDENTE',
  tracking_code TEXT, tracking_url TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS production_jobs (
  id BIGSERIAL PRIMARY KEY, order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL, project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  version_id BIGINT REFERENCES project_versions(id) ON DELETE SET NULL, product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  printer_id BIGINT REFERENCES printers(id) ON DELETE SET NULL, roll_id BIGINT REFERENCES material_rolls(id) ON DELETE SET NULL,
  est_weight_g NUMERIC(14,2) DEFAULT 0, real_weight_g NUMERIC(14,2) DEFAULT 0, est_time_min NUMERIC(14,2) DEFAULT 0, real_time_min NUMERIC(14,2) DEFAULT 0,
  waste_g NUMERIC(14,2) DEFAULT 0, started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, result TEXT, failure_type TEXT, failure_cause TEXT,
  status TEXT NOT NULL DEFAULT 'AGUARDANDO', notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS production_component_usages (
  id BIGSERIAL PRIMARY KEY, production_id BIGINT NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  product_component_id BIGINT REFERENCES product_components(id) ON DELETE SET NULL,
  component_kind TEXT NOT NULL, component_id BIGINT NOT NULL, quantity NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0, total_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(production_id,product_component_id)
);
CREATE INDEX IF NOT EXISTS idx_production_component_usages_production ON production_component_usages(production_id);
CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL, category TEXT, description TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL, date DATE NOT NULL,
  reference_id BIGINT, reference_type TEXT, paid BOOLEAN DEFAULT FALSE, due_date DATE, paid_at TIMESTAMPTZ, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS quotes (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  printer_id BIGINT REFERENCES printers(id) ON DELETE SET NULL,
  roll_id BIGINT REFERENCES material_rolls(id) ON DELETE SET NULL,
  product_description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  project_time_min NUMERIC(14,2) NOT NULL DEFAULT 0,
  weight_g NUMERIC(14,2) NOT NULL DEFAULT 0,
  print_time_min NUMERIC(14,2) NOT NULL DEFAULT 0,
  labor_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_costs NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_material NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_energy NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_machine NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_maintenance NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  markup_percent NUMERIC(10,2) NOT NULL DEFAULT 0,
  profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  price_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  real_margin_percent NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ORCAMENTO',
  notes TEXT, price_mode TEXT NOT NULL DEFAULT 'markup',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes(created_at);
CREATE INDEX IF NOT EXISTS idx_rolls_material ON material_rolls(material_id);
CREATE INDEX IF NOT EXISTS idx_stock_roll ON stock_movements(roll_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_plan_printer ON maintenance_plans(printer_id);
CREATE INDEX IF NOT EXISTS idx_project_parts_project ON project_parts(project_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
`;

async function initDb() {
  const p = getPool();
  await p.query(schema);
  // Safe schema upgrades for installations created with the first PostgreSQL release.
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id BIGINT`);
  await p.query(`DO $$ BEGIN ALTER TABLE users ADD CONSTRAINT users_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await p.query(`ALTER TABLE printers ADD COLUMN IF NOT EXISTS photo_url TEXT`);
  await p.query(`ALTER TABLE printers ADD COLUMN IF NOT EXISTS cloudinary_public_id TEXT`);
  await p.query(`CREATE TABLE IF NOT EXISTS production_component_usages (
    id BIGSERIAL PRIMARY KEY, production_id BIGINT NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
    product_component_id BIGINT REFERENCES product_components(id) ON DELETE SET NULL,
    component_kind TEXT NOT NULL, component_id BIGINT NOT NULL, quantity NUMERIC(14,3) NOT NULL,
    unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0, total_cost NUMERIC(14,4) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(production_id,product_component_id)
  )`);
  await p.query(`ALTER TABLE production_component_usages ALTER COLUMN product_component_id DROP NOT NULL`);
  await p.query(`DO $$ DECLARE c text; BEGIN
    SELECT conname INTO c FROM pg_constraint WHERE conrelid='production_component_usages'::regclass AND contype='f' AND pg_get_constraintdef(oid) LIKE '%product_components%';
    IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE production_component_usages DROP CONSTRAINT %I', c); END IF;
    ALTER TABLE production_component_usages ADD CONSTRAINT production_component_usages_component_fk FOREIGN KEY (product_component_id) REFERENCES product_components(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_production_component_usages_production ON production_component_usages(production_id)`);
  // Compatibility upgrades for product tables created by older releases.
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS code TEXT`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS version_id BIGINT REFERENCES project_versions(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS material_type TEXT`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_g NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_time_min NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_material NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_energy NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_machine NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_labor NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_packaging NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_finishing NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_parts NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_project_parts NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_maintenance NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_total NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS markup NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS margin NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS printer_id BIGINT REFERENCES printers(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS material_roll_id BIGINT REFERENCES material_rolls(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS development_time_min NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS costs_manual BOOLEAN NOT NULL DEFAULT FALSE`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS notes TEXT`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await p.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await p.query(`ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS task TEXT`);
  await p.query(`ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS interval_hours NUMERIC(14,2)`);
  await p.query(`ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS interval_days INTEGER`);
  await p.query(`ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`);
  await p.query(`ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS last_completed_at DATE`);
  await p.query(`ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS last_completed_hours NUMERIC(14,2) DEFAULT 0`);
  await p.query(`ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS next_due_date DATE`);
  await p.query(`ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS next_due_hours NUMERIC(14,2)`);
  await p.query(`ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS notes TEXT`);
  await p.query(`ALTER TABLE tests ADD COLUMN IF NOT EXISTS test_date DATE`);
  await p.query(`ALTER TABLE tests ALTER COLUMN project_id DROP NOT NULL`);
  await p.query(`ALTER TABLE tests ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE tests ADD COLUMN IF NOT EXISTS name TEXT`);
  await p.query(`ALTER TABLE tests ADD COLUMN IF NOT EXISTS source_key TEXT`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tests_source_key ON tests(source_key) WHERE source_key IS NOT NULL`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_tests_customer ON tests(customer_id)`);
  await p.query(`UPDATE maintenance_plans SET active=TRUE WHERE active IS NULL`);
  await p.query(`UPDATE maintenance_plans SET interval_hours=NULL WHERE interval_hours IS NOT NULL AND interval_hours<=0`);
  await p.query(`UPDATE maintenance_plans SET interval_days=NULL WHERE interval_days IS NOT NULL AND interval_days<=0`);
  await p.query(`ALTER TABLE tests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await p.query(`UPDATE tests SET test_date=created_at::date WHERE test_date IS NULL`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_tests_active_date ON tests(test_date) WHERE deleted_at IS NULL`);
  await p.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS freight NUMERIC(14,2)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id) WHERE deleted_at IS NULL`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference_type,reference_id) WHERE deleted_at IS NULL`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id) WHERE deleted_at IS NULL`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_one_active_order ON shipments(order_id) WHERE deleted_at IS NULL AND status <> 'CANCELADO'`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status) WHERE deleted_at IS NULL`);
  await p.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS roll_id BIGINT REFERENCES material_rolls(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE printer_maintenance ADD COLUMN IF NOT EXISTS plan_id BIGINT REFERENCES maintenance_plans(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE printer_maintenance ADD COLUMN IF NOT EXISTS hours_at NUMERIC(14,2)`);
  await p.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS project_time_min NUMERIC(14,2) NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS price_mode TEXT NOT NULL DEFAULT 'markup'`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_transactions_due_paid ON transactions(due_date,paid) WHERE deleted_at IS NULL`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`);
  const defs = {
    company_name: 'Minha Impressora 3D', labor_cost_hour: '15.00', energy_cost_kwh: '0.75',
    machine_cost_hour: '2.50', maintenance_cost_hour: '0.50', default_min_stock_g: '50', printer_investment: '0',
    default_development_time_min: '0', default_markup_percent: '100', default_packaging_cost: '0', default_finishing_cost: '0',
  };
  for (const [k, v] of Object.entries(defs)) {
    await p.query(`INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, [k, v]);
  }
  await p.query(`CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL,
    entity TEXT NOT NULL, entity_id BIGINT, ip INET, result TEXT NOT NULL DEFAULT 'SUCCESS', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await p.query('ALTER TABLE project_parts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
  await p.query('ALTER TABLE project_versions ADD COLUMN IF NOT EXISTS file_storage_key TEXT');
  await p.query('ALTER TABLE project_versions ADD COLUMN IF NOT EXISTS file_size BIGINT');
  await p.query('ALTER TABLE project_versions ADD COLUMN IF NOT EXISTS file_mime TEXT');
  await p.query('ALTER TABLE project_versions ADD COLUMN IF NOT EXISTS file_hash TEXT');
  await p.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)');
  await p.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id)');

  const admin = await dbGet("SELECT id FROM users WHERE role='ADMIN' AND deleted_at IS NULL LIMIT 1");
  if (!admin) {
    const email = process.env.INITIAL_ADMIN_EMAIL;
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    if (process.env.NODE_ENV === 'production' && (!email || !password)) {
      throw new Error('Banco sem ADMIN. Defina INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD no ambiente antes do primeiro deploy.');
    }
    if (email && password) {
      await dbRun('INSERT INTO users (name,email,password,role) VALUES ($1,$2,$3,$4)', ['Administrador', String(email).trim().toLowerCase(), await argon2.hash(String(password), {type:argon2.argon2id}), 'ADMIN']);
    }
  }
  // Historical test data provided for the current project version. Idempotent and stock-neutral.
  const historicalTests = [
    ['Benchy (Primeira Impressão)', '2026-09-05', 14, 12.0, 'historico-2026-09-05-01'],
    ['Espátula Creality', '2026-09-05', 30, 17.4, 'historico-2026-09-05-02'],
    ['Mini Jacaré', '2026-09-05', 11, 1.5, 'historico-2026-09-05-03'],
    ['Limpador de Filamento', '2026-09-07', 28, 3.0, 'historico-2026-09-07-01'],
    ['Mini Picles', '2026-09-07', 24, 1.2, 'historico-2026-09-07-02'],
    ['Avião v1', '2026-09-08', 17, 4.2, 'historico-2026-09-08-01'],
    ['Mini Jacaré (Cópia)', '2026-09-09', 11, 1.5, 'historico-2026-09-09-01'],
    ['Avião v1 (Cópia)', '2026-09-09', 17, 4.2, 'historico-2026-09-09-02'],
    ['Limpador de Filamento (Cópia)', '2026-09-10', 28, 3.0, 'historico-2026-09-10-01'],
    ['Avião v2', '2026-09-12', 24, 8.4, 'historico-2026-09-12-01'],
    ['Parador de Porta', '2026-09-13', 36, 19.8, 'historico-2026-09-13-01'],
    ['6 Palhetas Juntas', '2026-09-13', 6, 3.9, 'historico-2026-09-13-02'],
    ['Avião v3', '2026-09-13', 28, 12.6, 'historico-2026-09-13-03'],
  ];
  const printerName = 'Creality Ender-3 V3 Plus';
  let historicalPrinter = await dbGet(`SELECT id, deleted_at FROM printers WHERE name=$1 ORDER BY deleted_at NULLS FIRST, id LIMIT 1`, [printerName]);
  if (!historicalPrinter) {
    const created = await dbGet(`INSERT INTO printers(name,status) VALUES($1,'DISPONIVEL') RETURNING id`, [printerName]);
    historicalPrinter = created;
  } else if (historicalPrinter.deleted_at) {
    await dbRun(`UPDATE printers SET deleted_at=NULL WHERE id=$1`, [historicalPrinter.id]);
  }
  for (const [name, date, minutes, grams, sourceKey] of historicalTests) {
    await dbRun(`INSERT INTO tests(name,source_key,printer_id,real_time_min,real_weight_g,waste_g,result,test_date,notes)
      VALUES($1,$2,$3,$4,$5,0,'APROVADO',$6,$7)
      ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`,
      [name,sourceKey,historicalPrinter.id,minutes,grams,date,'Importado como histórico oficial; sem movimentação de estoque.']);
  }
  await dbRun(`UPDATE printers p SET
      total_hours = COALESCE(t.test_hours,0) + COALESCE(pj.prod_hours,0),
      total_prints = COALESCE(t.test_prints,0) + COALESCE(pj.prod_prints,0),
      filament_used_g = COALESCE(t.test_filament,0) + COALESCE(pj.prod_filament,0),
      total_failures = COALESCE(t.test_failures,0) + COALESCE(pj.prod_failures,0)
    FROM (
      SELECT printer_id,
        COALESCE(SUM(CASE WHEN real_time_min>0 AND result<>'CANCELADO' THEN real_time_min ELSE 0 END),0)/60 test_hours,
        COALESCE(COUNT(*) FILTER (WHERE real_time_min>0 AND result<>'CANCELADO'),0)::int test_prints,
        COALESCE(SUM(CASE WHEN real_time_min>0 AND result<>'CANCELADO' THEN COALESCE(real_weight_g,0)+COALESCE(waste_g,0) ELSE 0 END),0) test_filament,
        COALESCE(COUNT(*) FILTER (WHERE result='REPROVADO'),0)::int test_failures
      FROM tests WHERE deleted_at IS NULL AND printer_id IS NOT NULL GROUP BY printer_id
    ) t
    LEFT JOIN (
      SELECT printer_id,
        COALESCE(SUM(CASE WHEN status<>'CANCELADO' THEN COALESCE(real_time_min,0) ELSE 0 END),0)/60 prod_hours,
        COALESCE(COUNT(*) FILTER (WHERE status<>'CANCELADO'),0)::int prod_prints,
        COALESCE(SUM(CASE WHEN status<>'CANCELADO' THEN COALESCE(real_weight_g,0)+COALESCE(waste_g,0) ELSE 0 END),0) prod_filament,
        COALESCE(COUNT(*) FILTER (WHERE status='FALHA'),0)::int prod_failures
      FROM production_jobs WHERE printer_id IS NOT NULL GROUP BY printer_id
    ) pj ON pj.printer_id=t.printer_id
    WHERE p.id=t.printer_id`);

  console.log('✅ PostgreSQL inicializado');
}

module.exports = { getPool, dbAll, dbGet, dbRun, withTransaction, initDb };
