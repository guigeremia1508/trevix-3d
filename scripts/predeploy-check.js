const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const forbidden = ['.env', '.env.local', '.env.production', 'node_modules'];
for (const name of forbidden) {
  if (fs.existsSync(path.join(root, name))) {
    console.log(`⚠️ Ignorado no pacote: ${name}`);
  }
}
for (const required of ['server.js','database/init.js','routes/api.js','routes/auth.js','frontend/index.html','frontend/sw.js','package.json']) {
  if (!fs.existsSync(path.join(root, required))) throw new Error(`Arquivo obrigatório ausente: ${required}`);
}
console.log('✅ Predeploy check passed');
